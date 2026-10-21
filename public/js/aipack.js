// "AI pack": everything an image model needs to redraw each animation frame in your style.
// Per frame: the rendered frame (img2img input), an OpenPose skeleton (ControlNet OpenPose)
// and a line-art guide (ControlNet Lineart). Plus the original drawing as a style reference,
// all keypoints as OpenPose JSON, and a how-to. Packed into one ZIP, made locally.

const SIZE = { w: 1024, h: 768 }; // multiples of 64, which image models like

// OpenPose COCO-18 order. Character "R" is the character's right, on the screen's left,
// which is what OpenPose calls right for a figure facing the viewer.
const LIMBS = [[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]];
const COLORS = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]];

// Rig joints (stage pixels) → 18 OpenPose keypoints. Eyes and ears are placed around the head.
function keypoints(P, roll) {
  const R = P.T * 0.18;
  const around = (dx, dy) => {
    const c = Math.cos(roll), s = Math.sin(roll);
    return { x: P.head.x + dx * c - dy * s, y: P.head.y + dx * s + dy * c };
  };
  return [
    P.head, P.neck, P.shoulderR, P.elbowR, P.wristR, P.shoulderL, P.elbowL, P.wristL,
    P.hipR, P.kneeR, P.ankleR, P.hipL, P.kneeL, P.ankleL,
    around(-R * 0.45, -R * 0.35), around(R * 0.45, -R * 0.35), around(-R, -R * 0.1), around(R, -R * 0.1),
  ];
}

function drawOpenPose(kp, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const stick = Math.max(3, w / 256);
  g.globalAlpha = 0.6;
  LIMBS.forEach(([a, b], i) => {
    const A = kp[a], B = kp[b];
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    g.fillStyle = `rgb(${COLORS[i].join(',')})`;
    g.beginPath();
    g.ellipse((A.x + B.x) / 2, (A.y + B.y) / 2, len / 2, stick, Math.atan2(B.y - A.y, B.x - A.x), 0, Math.PI * 2);
    g.fill();
  });
  g.globalAlpha = 1;
  kp.forEach((p, i) => {
    g.fillStyle = `rgb(${COLORS[i].join(',')})`;
    g.beginPath();
    g.arc(p.x, p.y, stick + 1, 0, Math.PI * 2);
    g.fill();
  });
  return c;
}

// ControlNet's line-art models expect white lines on black. Solid fills (the black pants)
// are reduced to their outlines; thin strokes are kept whole.
function lineGuide(frame) {
  const W = frame.width, H = frame.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(frame, 0, 0);
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  let ink = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) ink[p] = 255 - (d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114) > 90 ? 1 : 0;
  const original = ink;
  // Erode a few times: whatever survives is the inside of a fill.
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      next[p] = ink[p] & ink[p - 1] & ink[p + 1] & ink[p - W] & ink[p + W];
    }
    ink = next;
  }
  for (let p = 0; p < W * H; p++) {
    const v = original[p] && !ink[p] ? 255 : 0;
    d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v;
    d[p * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}

const toPNG = (canvas) => new Promise((r) => canvas.toBlob((b) => b.arrayBuffer().then((a) => r(new Uint8Array(a))), 'image/png'));
const pad = (n) => String(n).padStart(4, '0');

const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/png'));

// The three guide images for one pose: the posed frame on white, its OpenPose skeleton and
// its line guide (PNG blobs), plus the keypoints. renderPose(ctx, w, h, pose) returns joints.
export async function frameGuides(pose, renderPose) {
  const { w, h } = SIZE;
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const P = renderPose(layer.getContext('2d'), w, h, pose);
  const frame = document.createElement('canvas');
  frame.width = w;
  frame.height = h;
  const g = frame.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(layer, 0, 0);
  const kp = keypoints(P, pose.face.roll || 0);
  return { kp, frame: await toBlob(frame), pose: await toBlob(drawOpenPose(kp, w, h)), lineart: await toBlob(lineGuide(frame)) };
}

// poses: rig poses to export. renderPose(ctx, w, h, pose) draws one and returns the joints.
export async function buildAIPack({ poses, renderPose, reference, name, fps, onProgress }) {
  const { w, h } = SIZE;
  const files = [];
  const people = [];
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  for (let i = 0; i < poses.length; i++) {
    const { kp, frame, pose, lineart } = await frameGuides(poses[i], renderPose);
    files.push([`frames/frame_${pad(i + 1)}.png`, await bytes(frame)]);
    files.push([`pose/pose_${pad(i + 1)}.png`, await bytes(pose)]);
    files.push([`lineart/lineart_${pad(i + 1)}.png`, await bytes(lineart)]);
    people.push({
      frame: i + 1,
      canvas_width: w,
      canvas_height: h,
      people: [{ pose_keypoints_2d: kp.flatMap((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, 1]) }],
    });
    onProgress?.(i + 1, poses.length);
  }

  if (reference) {
    const ref = document.createElement('canvas');
    ref.width = reference.width;
    ref.height = reference.height;
    const g = ref.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, ref.width, ref.height);
    g.drawImage(reference, 0, 0);
    files.push(['reference/character.png', await toPNG(ref)]);
  }
  const enc = new TextEncoder();
  files.push(['poses_openpose.json', enc.encode(JSON.stringify({ format: 'OpenPose COCO-18', fps, frames: people }, null, 1))]);
  files.push(['README.txt', enc.encode(readme(name, poses.length, fps, w, h))]);
  return new Blob([zip(files)], { type: 'application/zip' });
}

function readme(name, n, fps, w, h) {
  return `AI pack: ${name}
${n} frames at ${w}x${h}, ${fps} fps. Made locally by Motion Rig.

FOLDERS
  frames/     Each frame as rendered by the rig: your drawing, posed. Use it as the img2img input.
  pose/       OpenPose skeleton for each frame, for ControlNet OpenPose. It keeps the pose exact.
  lineart/    White-on-black line guide for each frame, for ControlNet Lineart. It keeps your linework.
  reference/  Your original drawing, for IP-Adapter or a reference image. It keeps the character and style consistent.
  poses_openpose.json   Keypoints for every frame in OpenPose COCO-18 order, in pixels.

REDRAW EVERY FRAME IN YOUR STYLE (ComfyUI, all local)
  1. Install ComfyUI. Add an SDXL or SD 1.5 checkpoint, an OpenPose ControlNet, a Lineart ControlNet,
     and IP-Adapter (ComfyUI_IPAdapter_plus).
  2. Use "Load Image Batch" (or "Load Images From Dir") on frames/, pose/ and lineart/, in the same order.
  3. Wire it up: frame, then VAE Encode, then KSampler (img2img).
       ControlNet OpenPose  <- pose/      strength 0.8 to 1.0
       ControlNet Lineart   <- lineart/   strength 0.4 to 0.6 (lower lets the AI clean up stretched lines)
       IP-Adapter           <- reference/character.png   weight 0.6 to 0.8
  4. Prompt: "clean black and white ink line art, hand-drawn, consistent line weight, white background,
     character in beanie, glasses, oversized sweatshirt, black baggy pants".
     Negative: "color, shading, blurry, extra limbs, distorted hands, text".
  5. Use a fixed seed and denoise 0.35 to 0.5. Higher redraws more but can drift off model.
  6. Save in order, then rebuild the animation: import the frames back into Procreate (one per layer,
     with Animation Assist on) or join them, for example:
       ffmpeg -framerate ${fps} -i out_%04d.png -pix_fmt yuv420p animation.mp4

TIPS
  - Lower denoise keeps frames consistent with each other. Raise it only for frames that look broken.
  - If hands come out messy, add the reference drawing's hands region as an extra IP-Adapter image.
  - The same files work in Automatic1111 / Forge: ControlNet tab, Batch mode, pointed at these folders.
`;
}

// ---------------------------------------------------------------- minimal ZIP (stored, no compression)
// PNGs are already compressed, so storing them is fine.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)]);
}
