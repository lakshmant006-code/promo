// Face prototype: live webcam face tracking -> retargeting -> a face rig cut from the front character art.
// Self-contained. It does not load or change the Motion Rig application.
const $ = (id) => document.getElementById(id);
const stage = $('stage'), ctx = stage.getContext('2d'), workspace = $('workspace'), device = $('device');
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo'); // a scripted face, for checking the rig without a camera

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function fit() {
  const s = Math.min(1, innerWidth / 1240, innerHeight / 880);
  device.style.setProperty('--fit', String(s));
}
fit(); addEventListener('resize', fit);
function resize() {
  const k = window.devicePixelRatio || 1;
  stage.width = Math.round(workspace.clientWidth * k); stage.height = Math.round(workspace.clientHeight * k);
}
resize(); new ResizeObserver(resize).observe(workspace);

// ---------- the face rig: layers cut from the front art ----------
const L = await (await fetch('assets/layout.json')).json();
const load = (n) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `assets/${n}.png`; });
const img = {};
await Promise.all(['base', 'browL', 'browR', 'pupL', 'pupR', 'must', 'goat', 'eyeL', 'eyeR'].map(async (n) => { img[n] = await load(n); }));
const CW = L.crop.w, CH = L.crop.h, PIVOT = { x: CW / 2, y: 400 }, FACE_CX = 196;
const rc = document.createElement('canvas'); rc.width = CW; rc.height = CH;
const eyeCv = { L: document.createElement('canvas'), R: document.createElement('canvas') };

// the rig's controls, all in -1..1 or 0..1
const rig = { yaw: 0, pitch: 0, roll: 0, blinkL: 0, blinkR: 0, gazeX: 0, gazeY: 0, browL: 0, browR: 0, innerL: 0, innerR: 0, jaw: 0, smile: 0, pucker: 0, frown: 0 };
const target = { ...rig };
const vel = Object.fromEntries(Object.keys(rig).map((k) => [k, 0]));
function spring(dt) { // critically damped: follows quickly, never overshoots, no jitter
  const w = 30;
  for (const k of Object.keys(rig)) {
    const x = rig[k] - target[k], v = vel[k], t = vel[k] + w * x;
    const e = Math.exp(-w * dt);
    rig[k] = target[k] + (x + t * dt) * e; vel[k] = (v - w * t * dt) * e;
  }
}

function drawEye(side, r) {
  const e = L['eye' + side], p = L['pup' + side], c = eyeCv[side];
  const blink = side === 'L' ? r.blinkL : r.blinkR, skin = L['skinEye' + side];
  c.width = e.w; c.height = e.h; const g = c.getContext('2d');
  g.drawImage(img['eye' + side], 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.drawImage(img['pup' + side], p.x - e.x + r.gazeX * L.pupilRange.x, p.y - e.y + r.gazeY * L.pupilRange.y);
  const lid = clamp(blink) * (e.h + 2);
  g.fillStyle = `rgb(${skin.join(',')})`; g.fillRect(0, 0, e.w, lid);
  if (blink > 0.12 && blink <= 0.7) { g.fillStyle = '#23253b'; g.fillRect(0, Math.max(0, lid - 2.5), e.w, 3.5); }
  if (blink > 0.7) { // closed: a curved lash line across the lid
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = clamp((blink - 0.7) / 0.3);
    g.strokeStyle = '#23253b'; g.lineWidth = 3.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(2, e.h * 0.58); g.quadraticCurveTo(e.w / 2, e.h * 0.58 + 7, e.w - 2, e.h * 0.58); g.stroke(); g.globalAlpha = 1;
  }
  rc.getContext('2d').drawImage(c, e.x, e.y);
}
function drawMouth(g, r) {
  const m = L.mouth, open = Math.max(r.jaw * 30, r.pucker * 8);
  if (open < 2.2) return;
  const w = m.halfW * (1 + 0.22 * r.smile - 0.45 * r.pucker - 0.12 * r.frown), cy = -r.smile * 7 + r.frown * 5;
  g.save(); g.translate(m.cx, m.y);
  const path = () => { g.beginPath(); g.moveTo(-w, cy); g.quadraticCurveTo(0, -4 - r.smile * 2, w, cy); g.quadraticCurveTo(0, 2 * open + 6 + cy * 0.2, -w, cy); g.closePath(); };
  path(); g.fillStyle = '#3a1722'; g.fill();
  g.save(); path(); g.clip();
  if (open > 7) { g.fillStyle = '#fbf1e7'; g.fillRect(-w, -4, 2 * w, Math.min(open * 0.35, 9)); }
  if (open > 12) { g.fillStyle = '#e0607a'; g.beginPath(); g.ellipse(0, open + 2, w * 0.55, open * 0.5, 0, 0, Math.PI * 2); g.fill(); }
  g.restore(); g.restore();
}
function renderRig(r) {
  const g = rc.getContext('2d'); g.clearRect(0, 0, CW, CH);
  const YB = 12, YF = 16, PB = 8, PF = 14, STRIP = 4;
  // the head: horizontal strips, each turned about the neck by an amount that fades out below the chin
  for (let y = 0; y < 450; y += STRIP) {
    const w = 1 - smooth(380, 460, y), core = 0.3 + 0.7 * smooth(150, 210, y) * (1 - smooth(320, 420, y));
    g.save(); g.translate(PIVOT.x, PIVOT.y); g.rotate(r.roll * w); g.translate(-PIVOT.x, -PIVOT.y);
    g.translate(r.yaw * YB * core, r.pitch * PB * w);
    g.drawImage(img.base, 0, y, CW, STRIP + 1, 0, y, CW, STRIP + 1); g.restore();
  }
  g.drawImage(img.base, 0, 450, CW, CH - 450, 0, 450, CW, CH - 450);
  // the face parts sit on the head and slide further than it when the head turns
  g.save(); g.translate(PIVOT.x, PIVOT.y); g.rotate(r.roll); g.translate(-PIVOT.x, -PIVOT.y);
  g.translate(FACE_CX + r.yaw * YF, r.pitch * PF); g.scale(1 - 0.08 * Math.abs(r.yaw), 1); g.translate(-FACE_CX, 0);
  drawEye('L', r); drawEye('R', r);
  const brow = (n, v, inner, outerLeft) => {
    const b = L[n]; g.save(); g.translate(b.x + (outerLeft ? 0 : b.w), b.y + b.h / 2 - v * 13);
    g.rotate((outerLeft ? -1 : 1) * inner * 0.28); g.drawImage(img[n], outerLeft ? 0 : -b.w, -b.h / 2); g.restore();
  };
  brow('browL', r.browL, r.innerL, true); brow('browR', r.browR, r.innerR, false);
  drawMouth(g, r);
  const must = L.must, goat = L.goat;
  g.save(); g.translate(must.x + must.w / 2, must.y); g.scale(1 + 0.06 * r.smile - 0.1 * r.pucker, 1); g.drawImage(img.must, -must.w / 2, -r.smile * 3 + r.pucker * 2); g.restore();
  g.save(); g.translate(goat.x + goat.w / 2, goat.y + r.jaw * 26 + r.pucker * 3); g.scale(1 - 0.08 * r.pucker, 1); g.drawImage(img.goat, -goat.w / 2, 0); g.restore();
  g.restore();
}
function drawStage() {
  const W = stage.width, H = stage.height; ctx.clearRect(0, 0, W, H);
  renderRig(rig);
  const s = (H * 0.97) / CH; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(rc, W / 2 - (CW * s) / 2, H * 0.025, CW * s, CH * s);
}

// ---------- tracking and retargeting ----------
class OneEuro { // smooths jitter without adding lag when the face moves fast
  constructor(minCutoff = 1.4, beta = 0.08) { this.mc = minCutoff; this.b = beta; this.x = null; this.dx = 0; this.t = 0; }
  alpha(c, dt) { const r = 2 * Math.PI * c * dt; return r / (r + 1); }
  f(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const dx = (v - this.x) / dt; this.dx += this.alpha(1, dt) * (dx - this.dx);
    this.x += this.alpha(this.mc + this.b * Math.abs(this.dx), dt) * (v - this.x); return this.x;
  }
}
const filters = {}; const F = (k, v, t) => (filters[k] ||= new OneEuro()).f(v, t);
let mirror = true, baseline = {}, calibrating = 0, calSum = null, calN = 0, haveFace = false, trackFps = 0, trackMs = 0, lastDet = 0;
const CAL_KEYS = ['eyeBlinkLeft', 'eyeBlinkRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthPucker', 'mouthFunnel'];

function retarget(cats, lm, t) {
  const bs = {}; for (const c of cats) bs[c.categoryName] = c.score;
  if (calibrating) { // average a neutral face for about a second
    calSum ||= {}; calN++;
    for (const k of CAL_KEYS) calSum[k] = (calSum[k] || 0) + (bs[k] || 0);
    const hd = headPose(lm); calSum.yaw = (calSum.yaw || 0) + hd.yaw; calSum.pitch = (calSum.pitch || 0) + hd.pitch; calSum.roll = (calSum.roll || 0) + hd.roll;
    if (t - calibrating > 1.0) { for (const k in calSum) baseline[k] = calSum[k] / calN; calibrating = 0; calSum = null; calN = 0; }
  }
  const g = (n) => Math.max(0, (bs[n] || 0) - (baseline[n] || 0));
  const side = (n) => [g(n + (mirror ? 'Left' : 'Right')), g(n + (mirror ? 'Right' : 'Left'))]; // screen-left, screen-right
  const [bL, bR] = side('eyeBlink');
  const [dnL, dnR] = side('browDown'), [ouL, ouR] = side('browOuterUp'), inner = g('browInnerUp');
  const [smL, smR] = side('mouthSmile'), [frL, frR] = side('mouthFrown');
  // gaze: toward the subject's right is "in" for the left eye and "out" for the right eye
  const gaze = (((bs.eyeLookInLeft || 0) + (bs.eyeLookOutRight || 0)) - ((bs.eyeLookOutLeft || 0) + (bs.eyeLookInRight || 0))) / 2;
  const up = (((bs.eyeLookUpLeft || 0) + (bs.eyeLookUpRight || 0)) - ((bs.eyeLookDownLeft || 0) + (bs.eyeLookDownRight || 0))) / 2;
  const hd = headPose(lm);
  const v = {
    blinkL: smooth(0.12, 0.62, bL), blinkR: smooth(0.12, 0.62, bR),
    gazeX: clamp(gaze * 2.2 * (mirror ? 1 : -1), -1, 1), gazeY: clamp(-up * 2.2, -1, 1),
    browL: clamp(ouL / 0.55 * 0.8 + inner / 0.6 * 0.4 - dnL / 0.5, -1, 1), browR: clamp(ouR / 0.55 * 0.8 + inner / 0.6 * 0.4 - dnR / 0.5, -1, 1),
    innerL: clamp(inner / 0.6), innerR: clamp(inner / 0.6),
    jaw: clamp(g('jawOpen') / 0.5), smile: clamp((smL + smR) / 2 / 0.55), frown: clamp((frL + frR) / 2 / 0.4),
    pucker: clamp(Math.max(g('mouthPucker'), g('mouthFunnel') * 0.8) / 0.6),
    yaw: clamp((hd.yaw - (baseline.yaw || 0)) / 0.2, -1, 1), pitch: clamp((hd.pitch - (baseline.pitch || 0)) / 0.1, -1, 1),
    roll: clamp(hd.roll - (baseline.roll || 0), -0.45, 0.45),
  };
  for (const k in v) target[k] = F(k, v[k], t);
}
function headPose(lm) { // from landmark geometry, in the raw (un-mirrored) camera image
  const m = mirror ? -1 : 1, cL = lm[234], cR = lm[454], nose = lm[1], top = lm[10], chin = lm[152];
  const eA = lm[33].x < lm[263].x ? lm[33] : lm[263], eB = lm[33].x < lm[263].x ? lm[263] : lm[33];
  const fw = Math.abs(cR.x - cL.x) || 1, fh = Math.abs(chin.y - top.y) || 1;
  return { yaw: m * (nose.x - (cL.x + cR.x) / 2) / fw, pitch: (nose.y - (top.y + chin.y) / 2) / fh, roll: m * Math.atan2(eB.y - eA.y, eB.x - eA.x) };
}

// ---------- the pipeline strip ----------
const node = (id, state, text, sub) => { const n = $(id); n.classList.toggle('on', state === 'on'); n.classList.toggle('warn', state === 'warn'); if (sub !== undefined) $(sub).textContent = text; };
function note(text) { const n = $('faceNote'); n.textContent = text || ''; n.classList.toggle('hidden', !text); }
let frames = 0, fpsT = performance.now(), drawFps = 0;
function updateStrip() {
  const calibrated = Object.keys(baseline).length > 0;
  node('pnRet', haveFace ? (calibrating ? 'warn' : 'on') : '', calibrating ? 'hold a neutral face' : calibrated ? 'calibrated · One Euro' : 'tap Calibrate', 'pnRetTxt');
  node('pnRig', haveFace ? 'on' : '', '14 controls · spring', 'pnRigTxt');
  node('pnOut', 'on', `${drawFps} fps · original art`, 'pnOutTxt');
  if (haveFace) node('pnTrk', 'on', `478 points · 52 blendshapes · ${trackFps} fps`, 'pnTrkTxt');
}
$('pbCal').addEventListener('click', startCal);
function startCal() { calibrating = performance.now() / 1000; calSum = null; calN = 0; }
addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') startCal();
  if (e.key === 'm' || e.key === 'M') { mirror = !mirror; baseline = {}; }
});

// ---------- camera and tracker ----------
const video = $('camVideo');
async function startTracking() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    video.srcObject = stream; await video.play();
    node('pnCam', 'on', `${video.videoWidth}×${video.videoHeight}`, 'pnCamTxt');
  } catch (e) {
    node('pnCam', 'warn', 'no camera', 'pnCamTxt');
    note(location.hostname === 'localhost' || location.protocol === 'https:' ? 'Allow camera access to start tracking.' : 'The camera only works on localhost or https. Run it from node prototype/server.mjs.');
    return;
  }
  node('pnTrk', 'warn', 'loading the face model', 'pnTrkTxt');
  const { FilesetResolver, FaceLandmarker } = await import('/vendor/tasks-vision/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('/vendor/tasks-vision/wasm');
  let lmk;
  for (const delegate of ['GPU', 'CPU']) {
    try { lmk = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true }); break; }
    catch (e) { if (delegate === 'CPU') { node('pnTrk', 'warn', 'model failed to load', 'pnTrkTxt'); note('The face model could not load.'); return; } }
  }
  note('');
  let lastTime = -1, n = 0, t0 = performance.now(), lost = 0;
  const loop = () => {
    if (video.currentTime !== lastTime && video.readyState >= 2) {
      lastTime = video.currentTime; const s = performance.now();
      const r = lmk.detectForVideo(video, s); trackMs = performance.now() - s; n++;
      if (performance.now() - t0 > 1000) { trackFps = n; n = 0; t0 = performance.now(); }
      const lm = r.faceLandmarks?.[0], cats = r.faceBlendshapes?.[0]?.categories;
      if (lm && cats) {
        if (!haveFace) { haveFace = true; if (!Object.keys(baseline).length) startCal(); }
        lost = 0; retarget(cats, lm, s / 1000);
      } else if (++lost > 20) { haveFace = false; node('pnTrk', 'warn', 'step into view', 'pnTrkTxt'); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// a scripted face: talking, blinking, smiling, brows and head turns
function demoFace(t) {
  const talk = smooth(0.2, 0.5, Math.sin(t * 0.7)) * (0.5 + 0.5 * Math.sin(t * 11));
  const blink = (t % 3.2) < 0.18 ? Math.sin(((t % 3.2) / 0.18) * Math.PI) : 0;
  Object.assign(target, {
    jaw: talk * 0.9, blinkL: blink, blinkR: blink, smile: smooth(0.3, 0.9, Math.sin(t * 0.45)), pucker: smooth(0.85, 1, Math.sin(t * 0.31 + 1)) * 0.9, frown: 0,
    browL: Math.sin(t * 0.9) * 0.6, browR: Math.sin(t * 0.9 + 0.4) * 0.6, innerL: Math.max(0, Math.sin(t * 0.9)) * 0.7, innerR: Math.max(0, Math.sin(t * 0.9)) * 0.7,
    gazeX: Math.sin(t * 0.6), gazeY: Math.sin(t * 0.4) * 0.5, yaw: Math.sin(t * 0.5) * 0.9, pitch: Math.sin(t * 0.37) * 0.5, roll: Math.sin(t * 0.43) * 0.2,
  });
}

let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (DEMO) { demoFace(now / 1000); haveFace = true; } else if (!haveFace && !window.__holdIdle) { /* idle: a slow blink so the character is alive */ const t = now / 1000; const b = (t % 4) < 0.16 ? Math.sin(((t % 4) / 0.16) * Math.PI) : 0; target.blinkL = target.blinkR = b; }
  spring(dt); drawStage();
  frames++; if (now - fpsT > 1000) { drawFps = frames; frames = 0; fpsT = now; }
  requestAnimationFrame(frame);
})(last);
setInterval(updateStrip, 250);
window.__face = { rig, target, set: (o) => Object.assign(target, o), snap: () => { for (const k in target) { rig[k] = target[k]; vel[k] = 0; } } };
if (DEMO) { node('pnCam', 'on', 'demo face', 'pnCamTxt'); node('pnTrk', 'on', 'scripted · no camera', 'pnTrkTxt'); } else startTracking();
