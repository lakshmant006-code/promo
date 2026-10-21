// Camera tracking: MediaPipe pose (33 body joints) + face (blendshapes), all running locally.
import { FilesetResolver, PoseLandmarker, FaceLandmarker } from '/vendor/tasks-vision/vision_bundle.mjs';

async function create(Task, fileset, modelAssetPath, extra) {
  // Try the GPU first, fall back to CPU on devices where WebGL inference isn't available.
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await Task.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        ...extra,
      });
    } catch (err) {
      if (delegate === 'CPU') throw err;
    }
  }
}

export async function createTracker() {
  const fileset = await FilesetResolver.forVisionTasks('/vendor/tasks-vision/wasm');
  const [pose, face] = await Promise.all([
    create(PoseLandmarker, fileset, '/models/pose_landmarker_full.task', { numPoses: 1 }),
    create(FaceLandmarker, fileset, '/models/face_landmarker.task', {
      numFaces: 1,
      outputFaceBlendshapes: true,
    }),
  ]);

  let lastTs = 0;
  return {
    detect(video, { body = true, faceOn = true } = {}) {
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      const out = { pose: null, face: null };
      if (body) out.pose = pose.detectForVideo(video, ts).landmarks?.[0] ?? null;
      if (faceOn) {
        const r = face.detectForVideo(video, ts);
        if (r.faceLandmarks?.[0]) {
          const shapes = {};
          for (const c of r.faceBlendshapes?.[0]?.categories ?? []) shapes[c.categoryName] = c.score;
          out.face = { landmarks: r.faceLandmarks[0], shapes };
        }
      }
      return out;
    },
  };
}

// MediaPipe pose indices, from the person's own point of view.
const IDX = {
  shoulder: [11, 12], elbow: [13, 14], wrist: [15, 16],
  hip: [23, 24], knee: [25, 26], ankle: [27, 28], ear: [7, 8],
};

// Convert raw landmarks into character-space joints.
// Character sides assume the character faces the viewer: "R" is on the screen's left.
export function poseToJoints(lm, aspect, mirror) {
  const p = (i) => {
    const l = lm[i];
    const inFrame = l.y > -0.05 && l.y < 1.05 && l.x > -0.05 && l.x < 1.05;
    return { x: (mirror ? 1 - l.x : l.x) * aspect, y: l.y, v: inFrame ? (l.visibility ?? 1) : 0.03 };
  };
  // Mirrored: your left side shows on the screen's left, so it drives the character's right.
  const personL = mirror ? 'R' : 'L';
  const personR = mirror ? 'L' : 'R';
  const j = {};
  for (const [name, [li, ri]] of Object.entries(IDX)) {
    j[name + personL] = p(li);
    j[name + personR] = p(ri);
  }
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
  j.neck = mid(j.shoulderL, j.shoulderR);
  j.pelvis = mid(j.hipL, j.hipR);
  j.head = mid(j.earL, j.earR);
  return j;
}

// How far the body is turned from facing the camera, in degrees: 0 = facing it, ±90 = side on,
// 180 = back to it. Positive when the performer's left shoulder comes toward the camera.
// From the depth (z) and width (x) of the shoulders and hips (MediaPipe's z is on the same scale as x).
export function bodyYaw(lm) {
  const dx = (lm[11].x - lm[12].x + (lm[23].x - lm[24].x)) / 2;
  const dz = (lm[12].z - lm[11].z + (lm[24].z - lm[23].z)) / 2;
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

export function faceToExpression(face, aspect, mirror) {
  const lm = face.landmarks;
  const s = face.shapes;
  const pt = (i) => ({ x: (mirror ? 1 - lm[i].x : lm[i].x) * aspect, y: lm[i].y });
  // 33 = person's right outer eye corner, 263 = person's left.
  const eyeA = pt(mirror ? 263 : 33); // character's right (screen left)
  const eyeB = pt(mirror ? 33 : 263);
  const nose = pt(1);
  const eyeDist = Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y) || 1;
  const midX = (eyeA.x + eyeB.x) / 2;
  const blinkPersonL = s.eyeBlinkLeft ?? 0;
  const blinkPersonR = s.eyeBlinkRight ?? 0;
  return {
    roll: Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x),
    yaw: Math.max(-1, Math.min(1, ((nose.x - midX) / eyeDist) * 2.2)),
    blinkR: mirror ? blinkPersonL : blinkPersonR,
    blinkL: mirror ? blinkPersonR : blinkPersonL,
    jaw: s.jawOpen ?? 0,
    smile: ((s.mouthSmileLeft ?? 0) + (s.mouthSmileRight ?? 0)) / 2,
    browUp: s.browInnerUp ?? 0,
  };
}

// Skeleton drawn over the camera image (raw image coordinates; CSS handles mirroring).
const LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [7, 8]];
export function drawOverlay(ctx, lm, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  ctx.lineWidth = Math.max(2, w / 220);
  ctx.strokeStyle = 'rgba(30,144,255,.9)';
  for (const [a, b] of LINKS) {
    if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  for (const i of [7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const v = lm[i].visibility ?? 1;
    ctx.fillStyle = v > 0.5 ? '#fff' : 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, Math.max(3, w / 140), 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- joints on a drawing

let imagePose = null;
async function imageLandmarker() {
  if (!imagePose) {
    const fileset = await FilesetResolver.forVisionTasks('/vendor/tasks-vision/wasm');
    // Drawings score lower than photos, so accept less confident detections.
    imagePose = await create(PoseLandmarker, fileset, '/models/pose_landmarker_full.task', {
      numPoses: 1, runningMode: 'IMAGE', minPoseDetectionConfidence: 0.2, minPosePresenceConfidence: 0.2,
    });
  }
  return imagePose;
}

// Typical A-pose joint layout (from the sample character), as fractions of the figure's
// height around its centre line. Used when the pose model can't find a body in the drawing.
const TEMPLATE = {
  head: [-0.01, 0.078], headPivot: [-0.004, 0.15], shoulderR: [-0.088, 0.199], shoulderL: [0.094, 0.202],
  elbowR: [-0.151, 0.352], elbowL: [0.149, 0.35], wristR: [-0.215, 0.487], wristL: [0.213, 0.467],
  hipR: [-0.05, 0.479], hipL: [0.048, 0.479], kneeR: [-0.08, 0.691], kneeL: [0.062, 0.691],
  ankleR: [-0.11, 0.916], ankleL: [0.093, 0.916],
};

// Bounding box of the visible (non-transparent, non-white) pixels.
function figureBox(canvas) {
  const { width: W, height: H } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] <= 20) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? { x0: 0, y0: 0, x1: W, y1: H } : { x0, y0, x1, y1 };
}

export function templateJoints(canvas) {
  const b = figureBox(canvas);
  const h = b.y1 - b.y0;
  const cx = (b.x0 + b.x1) / 2;
  return Object.fromEntries(Object.entries(TEMPLATE).map(([k, [fx, fy]]) => [k, [cx + fx * h, b.y0 + fy * h]]));
}

// Find joints on a drawing with the pose model. The drawing faces the viewer, so the
// person's left side is on the screen's right (character "L").
// Line art on plain white often isn't recognised as a person; a tinted, slightly softened
// copy usually is. Try a few versions and keep the first anatomically sensible result.
const LOOKS = [
  { bg: '#7a8a99', blur: 1.5, pad: 0.15 },
  { bg: '#ffffff', blur: 3, pad: 0.15 },
  { bg: '#9a9a9a', blur: 0, pad: 0.15 },
  { bg: '#7a8a99', blur: 1.5, pad: 0.5 },
];

function plausible(lm) {
  const y = (i) => lm[i].y;
  return y(11) < y(23) && y(12) < y(24) && y(23) < y(25) && y(24) < y(26) && y(25) < y(27) && y(26) < y(28) && y(0) < y(11);
}

export async function detectJoints(canvas) {
  const model = await imageLandmarker();
  let lm = null;
  let work = null;
  let pad = 0;
  for (const look of LOOKS) {
    pad = Math.round(Math.max(canvas.width, canvas.height) * look.pad);
    work = document.createElement('canvas');
    work.width = canvas.width + pad * 2;
    work.height = canvas.height + pad * 2;
    const g = work.getContext('2d');
    g.fillStyle = look.bg;
    g.fillRect(0, 0, work.width, work.height);
    g.filter = look.blur ? `blur(${look.blur}px)` : 'none';
    g.drawImage(canvas, pad, pad);
    const found = model.detect(work).landmarks?.[0];
    if (found && plausible(found)) {
      lm = found;
      break;
    }
  }
  if (!lm) return { joints: templateJoints(canvas), face: null, detected: false };
  const P = (i) => [lm[i].x * work.width - pad, lm[i].y * work.height - pad];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const j = {
    shoulderL: P(11), shoulderR: P(12), elbowL: P(13), elbowR: P(14), wristL: P(15), wristR: P(16),
    hipL: P(23), hipR: P(24), kneeL: P(25), kneeR: P(26), ankleL: P(27), ankleR: P(28),
  };
  const ears = mid(P(7), P(8));
  j.head = mid(ears, P(0));
  j.headPivot = mid(mid(j.shoulderL, j.shoulderR), ears);
  const eyeR = P(5), eyeL = P(2), eyeGap = Math.hypot(eyeL[0] - eyeR[0], eyeL[1] - eyeR[1]);
  const mouth = mid(P(9), P(10));
  const face = {
    eyes: [[eyeR[0], eyeR[1], eyeGap * 0.45], [eyeL[0], eyeL[1], eyeGap * 0.45]],
    mouth: [mouth[0], mouth[1], Math.hypot(P(9)[0] - P(10)[0], P(9)[1] - P(10)[1]) * 1.1],
  };
  return { joints: j, face, detected: true };
}
