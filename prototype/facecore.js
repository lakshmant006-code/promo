// Face core: webcam face tracking -> retargeting -> a face rig cut from the front red-beanie art.
// Shared by the face screen (face/) and the prototype screen. It does not touch the Motion Rig app.
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

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

export async function createFace(assetBase = 'assets/') {
  const L = await (await fetch(`${assetBase}layout.json`)).json();
  const load = (n) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `${assetBase}${n}.png`; });
  const img = {};
  await Promise.all(['base', 'body', 'browL', 'browR', 'pupL', 'pupR', 'must', 'goat', 'eyeL', 'eyeR'].map(async (n) => { img[n] = await load(n); }));
  const CW = L.crop.w, CH = L.crop.h, PIVOT = { x: CW / 2, y: 400 }, FACE_CX = 196, FIG = L.figure, HEAD = L.head;
  const rc = document.createElement('canvas'); rc.width = CW; rc.height = CH;
  const eyeCv = { L: document.createElement('canvas'), R: document.createElement('canvas') };

  const rig = { yaw: 0, pitch: 0, roll: 0, blinkL: 0, blinkR: 0, gazeX: 0, gazeY: 0, browL: 0, browR: 0, innerL: 0, innerR: 0, jaw: 0, smile: 0, pucker: 0, frown: 0 };
  const target = { ...rig };
  const vel = Object.fromEntries(Object.keys(rig).map((k) => [k, 0]));
  const state = { haveFace: false, trackFps: 0, calibrating: false, calibrated: false, cameraOk: false, camera: '', model: '', mirror: true, live: false, idleBlink: true };
  let baseline = {}, calSince = 0, calSum = null, calN = 0;

  function step(dt) { // critically damped spring: follows quickly, never overshoots, no jitter
    const w = 30, e = Math.exp(-w * dt);
    for (const k of Object.keys(rig)) { const x = rig[k] - target[k], t = vel[k] + w * x; rig[k] = target[k] + (x + t * dt) * e; vel[k] = (vel[k] - w * t * dt) * e; }
  }
  function snap() { for (const k in target) { rig[k] = target[k]; vel[k] = 0; } }

  function drawEye(side, r) {
    const e = L['eye' + side], p = L['pup' + side], c = eyeCv[side], blink = side === 'L' ? r.blinkL : r.blinkR, skin = L['skinEye' + side];
    c.width = e.w; c.height = e.h; const g = c.getContext('2d');
    g.drawImage(img['eye' + side], 0, 0); g.globalCompositeOperation = 'source-atop';
    g.drawImage(img['pup' + side], p.x - e.x + r.gazeX * L.pupilRange.x, p.y - e.y + r.gazeY * L.pupilRange.y);
    const lid = clamp(blink) * (e.h + 2);
    g.fillStyle = `rgb(${skin.join(',')})`; g.fillRect(0, 0, e.w, lid);
    if (blink > 0.12 && blink <= 0.7) { g.fillStyle = '#23253b'; g.fillRect(0, Math.max(0, lid - 2.5), e.w, 3.5); }
    if (blink > 0.7) {
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = clamp((blink - 0.7) / 0.3); g.strokeStyle = '#23253b'; g.lineWidth = 3.6; g.lineCap = 'round';
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
    for (let y = 0; y < 450; y += STRIP) { // the head: strips turned about the neck, fading out below the chin
      const w = 1 - smooth(380, 460, y), core = 0.3 + 0.7 * smooth(150, 210, y) * (1 - smooth(320, 420, y));
      g.save(); g.translate(PIVOT.x, PIVOT.y); g.rotate(r.roll * w); g.translate(-PIVOT.x, -PIVOT.y);
      g.translate(r.yaw * YB * core, r.pitch * PB * w); g.drawImage(img.base, 0, y, CW, STRIP + 1, 0, y, CW, STRIP + 1); g.restore();
    }
    g.drawImage(img.base, 0, 450, CW, CH - 450, 0, 450, CW, CH - 450);
    g.save(); g.translate(PIVOT.x, PIVOT.y); g.rotate(r.roll); g.translate(-PIVOT.x, -PIVOT.y);
    g.translate(FACE_CX + r.yaw * YF, r.pitch * PF); g.scale(1 - 0.08 * Math.abs(r.yaw), 1); g.translate(-FACE_CX, 0);
    drawEye('L', r); drawEye('R', r);
    const brow = (n, v, inner, outerLeft) => { const b = L[n]; g.save(); g.translate(b.x + (outerLeft ? 0 : b.w), b.y + b.h / 2 - v * 13); g.rotate((outerLeft ? -1 : 1) * inner * 0.28); g.drawImage(img[n], outerLeft ? 0 : -b.w, -b.h / 2); g.restore(); };
    brow('browL', r.browL, r.innerL, true); brow('browR', r.browR, r.innerR, false);
    drawMouth(g, r);
    const must = L.must, goat = L.goat;
    g.save(); g.translate(must.x + must.w / 2, must.y); g.scale(1 + 0.06 * r.smile - 0.1 * r.pucker, 1); g.drawImage(img.must, -must.w / 2, -r.smile * 3 + r.pucker * 2); g.restore();
    g.save(); g.translate(goat.x + goat.w / 2, goat.y + r.jaw * 26 + r.pucker * 3); g.scale(1 - 0.08 * r.pucker, 1); g.drawImage(img.goat, -goat.w / 2, 0); g.restore();
    g.restore();
  }

  // camera: e = 0 is the wide shot (the full figure, same size as the other screens), e = 1 is the face
  function camera(W, H, e) {
    const k1 = (H * 0.5) / (FIG.bottom - FIG.top), k2 = (H * 0.62) / HEAD.h;
    return { k: k1 * Math.pow(k2 / k1, e), Fx: lerp(FIG.cx, HEAD.cx, e), Fy: lerp(FIG.bottom, HEAD.cy, e), Ax: W / 2, Ay: lerp(H * 0.8, H * 0.46, e) };
  }
  function drawScene(ctx, W, H, zoom) {
    const e = zoom * zoom * (3 - 2 * zoom), c = camera(W, H, e);
    renderRig(rig); ctx.save(); ctx.imageSmoothingQuality = 'high';
    ctx.translate(c.Ax, c.Ay); ctx.scale(c.k, c.k); ctx.translate(-c.Fx, -c.Fy);
    ctx.drawImage(img.body, 0, 0); ctx.drawImage(rc, L.crop.x, L.crop.y); ctx.restore();
    return e;
  }

  // ---------- tracking and retargeting ----------
  const filters = {}; const F = (k, v, t) => (filters[k] ||= new OneEuro()).f(v, t);
  const CAL_KEYS = ['eyeBlinkLeft', 'eyeBlinkRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthPucker', 'mouthFunnel'];
  function headPose(lm) { // from landmark geometry in the raw (un-mirrored) camera image
    const m = state.mirror ? -1 : 1, cL = lm[234], cR = lm[454], nose = lm[1], top = lm[10], chin = lm[152];
    const eA = lm[33].x < lm[263].x ? lm[33] : lm[263], eB = lm[33].x < lm[263].x ? lm[263] : lm[33];
    const fw = Math.abs(cR.x - cL.x) || 1, fh = Math.abs(chin.y - top.y) || 1;
    return { yaw: m * (nose.x - (cL.x + cR.x) / 2) / fw, pitch: (nose.y - (top.y + chin.y) / 2) / fh, roll: m * Math.atan2(eB.y - eA.y, eB.x - eA.x) };
  }
  function retarget(cats, lm, t) {
    const bs = {}; for (const c of cats) bs[c.categoryName] = c.score;
    if (calSince) { // average a neutral face for about a second
      calSum ||= {}; calN++;
      for (const k of CAL_KEYS) calSum[k] = (calSum[k] || 0) + (bs[k] || 0);
      const hd = headPose(lm); calSum.yaw = (calSum.yaw || 0) + hd.yaw; calSum.pitch = (calSum.pitch || 0) + hd.pitch; calSum.roll = (calSum.roll || 0) + hd.roll;
      if (t - calSince > 1.0) { for (const k in calSum) baseline[k] = calSum[k] / calN; calSince = 0; calSum = null; calN = 0; state.calibrating = false; state.calibrated = true; }
    }
    const g = (n) => Math.max(0, (bs[n] || 0) - (baseline[n] || 0));
    const side = (n) => [g(n + (state.mirror ? 'Left' : 'Right')), g(n + (state.mirror ? 'Right' : 'Left'))];
    const [bL, bR] = side('eyeBlink'), [dnL, dnR] = side('browDown'), [ouL, ouR] = side('browOuterUp'), inner = g('browInnerUp');
    const [smL, smR] = side('mouthSmile'), [frL, frR] = side('mouthFrown');
    const gaze = (((bs.eyeLookInLeft || 0) + (bs.eyeLookOutRight || 0)) - ((bs.eyeLookOutLeft || 0) + (bs.eyeLookInRight || 0))) / 2;
    const up = (((bs.eyeLookUpLeft || 0) + (bs.eyeLookUpRight || 0)) - ((bs.eyeLookDownLeft || 0) + (bs.eyeLookDownRight || 0))) / 2;
    const hd = headPose(lm);
    const v = {
      blinkL: smooth(0.12, 0.62, bL), blinkR: smooth(0.12, 0.62, bR),
      gazeX: clamp(gaze * 2.2 * (state.mirror ? 1 : -1), -1, 1), gazeY: clamp(-up * 2.2, -1, 1),
      browL: clamp(ouL / 0.55 * 0.8 + inner / 0.6 * 0.4 - dnL / 0.5, -1, 1), browR: clamp(ouR / 0.55 * 0.8 + inner / 0.6 * 0.4 - dnR / 0.5, -1, 1),
      innerL: clamp(inner / 0.6), innerR: clamp(inner / 0.6),
      jaw: clamp(g('jawOpen') / 0.5), smile: clamp((smL + smR) / 2 / 0.55), frown: clamp((frL + frR) / 2 / 0.4),
      pucker: clamp(Math.max(g('mouthPucker'), g('mouthFunnel') * 0.8) / 0.6),
      yaw: clamp((hd.yaw - (baseline.yaw || 0)) / 0.2, -1, 1), pitch: clamp((hd.pitch - (baseline.pitch || 0)) / 0.1, -1, 1), roll: clamp(hd.roll - (baseline.roll || 0), -0.45, 0.45),
    };
    for (const k in v) target[k] = F(k, v[k], t);
  }
  const calibrate = () => { calSince = performance.now() / 1000; calSum = null; calN = 0; state.calibrating = true; };

  let stream = null, loopOn = false, lmk = null;
  async function ensureModel() {
    if (lmk) return true;
    try {
      const { FilesetResolver, FaceLandmarker } = await import('/vendor/tasks-vision/vision_bundle.mjs');
      const fileset = await FilesetResolver.forVisionTasks('/vendor/tasks-vision/wasm');
      for (const delegate of ['GPU', 'CPU']) {
        try { lmk = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true }); return true; }
        catch (e) { if (delegate === 'CPU') throw e; }
      }
    } catch (e) { return false; }
    return false;
  }
  function startLoop(video) { // runs the tracker on whatever the video element is showing (the camera or a clip)
    state.live = true; state.idleBlink = false;
    if (loopOn) return; loopOn = true;
    let lastTime = -1, n = 0, t0 = performance.now(), lost = 0;
    const loop = () => {
      if (!loopOn) return;
      if (video.currentTime !== lastTime && video.readyState >= 2 && !video.paused) {
        lastTime = video.currentTime; const s = performance.now(), r = lmk.detectForVideo(video, s); n++;
        if (performance.now() - t0 > 1000) { state.trackFps = n; n = 0; t0 = performance.now(); }
        const lm = r.faceLandmarks?.[0], cats = r.faceBlendshapes?.[0]?.categories;
        if (lm && cats) { if (!state.haveFace) { state.haveFace = true; if (!state.calibrated) calibrate(); } lost = 0; retarget(cats, lm, s / 1000); }
        else if (++lost > 20) state.haveFace = false;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } state.cameraOk = false; }
  // the camera (with sound, so a recording can include your voice). The camera only works on localhost or https.
  async function startCamera(video) {
    stopCamera();
    const want = { width: 640, height: 480, facingMode: 'user' };
    try { stream = await navigator.mediaDevices.getUserMedia({ video: want, audio: true }); }
    catch (e) { try { stream = await navigator.mediaDevices.getUserMedia({ video: want, audio: false }); } catch (e2) { return { ok: false, reason: 'camera' }; } }
    video.pause(); video.removeAttribute('src'); video.loop = false; video.srcObject = stream; video.muted = true;
    try { await video.play(); } catch (e) { stopCamera(); return { ok: false, reason: 'camera' }; }
    state.cameraOk = true; state.camera = `${video.videoWidth}×${video.videoHeight}`;
    if (!(await ensureModel())) { stopCamera(); return { ok: false, reason: 'model' }; }
    startLoop(video); return { ok: true, stream };
  }
  // a recorded or loaded clip, played through the same tracker so the character performs it
  async function playClip(video, url, { loop = true, sound = true } = {}) {
    stopCamera(); video.pause(); video.srcObject = null; video.src = url; video.loop = loop; video.muted = !sound;
    try { await video.play(); } catch (e) { video.muted = true; try { await video.play(); } catch (e2) { return { ok: false, reason: 'clip' }; } }
    state.camera = 'clip';
    if (!(await ensureModel())) return { ok: false, reason: 'model' };
    startLoop(video); return { ok: true };
  }
  const startTracking = startCamera; // earlier name
  function stopTracking() { loopOn = false; state.live = false; state.haveFace = false; stopCamera(); }
  // a scripted face: talking, blinking, smiling, brows and head turns
  function demo(t) {
    const talk = smooth(0.2, 0.5, Math.sin(t * 0.7)) * (0.5 + 0.5 * Math.sin(t * 11)), ph = t % 3.2, blink = ph < 0.18 ? Math.sin((ph / 0.18) * Math.PI) : 0;
    Object.assign(target, {
      jaw: talk * 0.9, blinkL: blink, blinkR: blink, smile: smooth(0.3, 0.9, Math.sin(t * 0.45)), pucker: smooth(0.85, 1, Math.sin(t * 0.31 + 1)) * 0.9, frown: 0,
      browL: Math.sin(t * 0.9) * 0.6, browR: Math.sin(t * 0.9 + 0.4) * 0.6, innerL: Math.max(0, Math.sin(t * 0.9)) * 0.7, innerR: Math.max(0, Math.sin(t * 0.9)) * 0.7,
      gazeX: Math.sin(t * 0.6), gazeY: Math.sin(t * 0.4) * 0.5, yaw: Math.sin(t * 0.5) * 0.9, pitch: Math.sin(t * 0.37) * 0.5, roll: Math.sin(t * 0.43) * 0.2,
    });
  }
  function idle(t) { const ph = t % 4, b = ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0; target.blinkL = target.blinkR = b; } // a slow blink so he is alive
  return { _retarget: retarget, rig, target, state, step, snap, drawScene, camera, calibrate, startTracking, startCamera, playClip, stopCamera, stopTracking, getStream: () => stream, demo, idle, L };
}
