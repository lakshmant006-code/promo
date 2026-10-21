// Face screen: the shared face core on its own tablet screen. The character copies your face from the live webcam,
// or from a clip you recorded (or loaded), through the same tracker.
import { createFace } from '../facecore.js';
const $ = (id) => document.getElementById(id);
const stage = $('stage'), ctx = stage.getContext('2d'), workspace = $('workspace'), device = $('device'), video = $('camVideo');
const params = new URLSearchParams(location.search), DEMO = params.has('demo');
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
document.body.classList.add('lab-open');
function fit() {
  const panel = document.body.classList.contains('lab-open') ? 340 : 0;
  device.style.setProperty('--fit', String(Math.min(1, (innerWidth - panel) / 1240, innerHeight / 880)));
  device.style.setProperty('--shift', `${-panel / 2}px`);
}
fit(); addEventListener('resize', fit);
function resize() { const k = window.devicePixelRatio || 1; stage.width = Math.round(workspace.clientWidth * k); stage.height = Math.round(workspace.clientHeight * k); }
resize(); new ResizeObserver(resize).observe(workspace);

const face = await createFace('assets/'), st = face.state;
let zoom = params.has('wide') ? 0 : 1, zoomGoal = zoom, source = 'live', clipURL = null, sim = DEMO;
const bgEl = $('bgLayer'), fgEl = $('fgLayer');
const node = (id, s, text, sub) => { const n = $(id); n.classList.toggle('on', s === 'on'); n.classList.toggle('warn', s === 'warn'); if (sub) $(sub).textContent = text; };
const status = (t) => { $('fStatus').textContent = t; };
let frames = 0, fpsT = performance.now(), drawFps = 0;
function strip() {
  const clip = source === 'clip';
  if (sim) { node('pnCam', 'on', 'simulated', 'pnCamTxt'); node('pnTrk', 'on', 'scripted · no camera', 'pnTrkTxt'); }
  else {
    node('pnCam', st.cameraOk || (clip && st.live) ? 'on' : 'warn', clip ? 'recorded clip' : st.cameraOk ? st.camera : local ? 'allow the camera' : 'no camera', 'pnCamTxt');
    node('pnTrk', st.haveFace ? 'on' : 'warn', st.haveFace ? `478 points · 52 blendshapes · ${st.trackFps} fps` : st.live ? 'step into view' : 'starting', 'pnTrkTxt');
  }
  node('pnRet', st.haveFace || sim ? (st.calibrating ? 'warn' : 'on') : '', st.calibrating ? 'hold a neutral face' : st.calibrated || sim ? 'calibrated · One Euro' : 'waiting', 'pnRetTxt');
  node('pnRig', st.haveFace || sim ? 'on' : '', '14 controls · spring', 'pnRigTxt');
  node('pnOut', 'on', `${drawFps} fps · original art`, 'pnOutTxt');
}

// ---------- source: live webcam, or a clip ----------
let rec = null, chunks = [], recT0 = 0, recTimer = 0;
const recording = () => rec && rec.state === 'recording';
function syncUi() {
  $('fSrc').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === source));
  $('fShot').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === (zoomGoal ? 'face' : 'wide')));
  $('fPlay').disabled = !clipURL; $('fSave').disabled = !clipURL;
  $('fPlaySub').textContent = clipURL ? 'from the start' : 'record or load one first';
  $('fRec').classList.toggle('recording', !!recording());
  $('fMirror').checked = st.mirror;
  status(sim ? 'A scripted face (no camera here).' : source === 'clip' ? 'Playing a clip through the tracker.' : st.cameraOk ? 'Live from your webcam.' : local ? 'Allow the camera to start.' : 'The camera needs localhost.');
}
async function useLive() {
  source = 'live'; sim = false;
  const r = await face.startCamera(video);
  if (!r.ok && !local) sim = true; // a published page cannot use the camera: show a scripted performance
  syncUi(); return r;
}
async function useClip(restart = true) {
  if (!clipURL) return;
  if (recording()) stopRecording();
  source = 'clip'; sim = false;
  await face.playClip(video, clipURL, { loop: $('fLoop').checked, sound: $('fSound').checked });
  if (restart) video.currentTime = 0;
  syncUi();
}
async function startRecording() {
  if (!face.getStream()) { const r = await useLive(); if (!r.ok) return; }
  if (source !== 'live') await useLive();
  const s = face.getStream(); if (!s || typeof MediaRecorder === 'undefined') return;
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  chunks = []; rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    clearInterval(recTimer);
    if (clipURL) URL.revokeObjectURL(clipURL);
    clipURL = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'video/webm' }));
    $('fRec').firstChild.textContent = 'Record yourself'; $('fRecSub').textContent = 'talk, then stop';
    useClip(); // play it straight back so you see the character perform it
  };
  rec.start(250); recT0 = performance.now(); syncUi();
  recTimer = setInterval(() => { const s = Math.floor((performance.now() - recT0) / 1000); $('fRec').firstChild.textContent = 'Stop recording'; $('fRecSub').textContent = `0:${String(s).padStart(2, '0')}`; }, 250);
}
function stopRecording() { if (recording()) rec.stop(); }

$('fSrc').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.v === 'live') useLive(); else useClip(false); }));
$('fRec').addEventListener('click', () => (recording() ? stopRecording() : startRecording()));
$('fPlay').addEventListener('click', () => useClip(true));
$('fFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; if (clipURL) URL.revokeObjectURL(clipURL); clipURL = URL.createObjectURL(f); useClip(); e.target.value = ''; });
$('fSave').addEventListener('click', () => { const a = document.createElement('a'); a.href = clipURL; a.download = 'face-clip.webm'; a.click(); });
$('fLoop').addEventListener('input', (e) => { video.loop = e.target.checked; });
$('fSound').addEventListener('input', (e) => { video.muted = source === 'live' || !e.target.checked; });
$('fShot').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { zoomGoal = b.dataset.v === 'face' ? 1 : 0; syncUi(); }));
$('fMirror').addEventListener('input', (e) => { st.mirror = e.target.checked; face.calibrate(); });
$('fCal').addEventListener('click', face.calibrate);
$('fStrip').addEventListener('input', (e) => $('pipe').classList.toggle('hidden', !e.target.checked));
const setPanel = (on) => { document.body.classList.toggle('lab-open', on); fit(); };
$('fClose').addEventListener('click', () => setPanel(false)); $('fToggle').addEventListener('click', () => setPanel(true));
addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setPanel(!document.body.classList.contains('lab-open'));
  else if (k === 'z') { zoomGoal = zoomGoal ? 0 : 1; syncUi(); }
  else if (k === 'c') face.calibrate();
  else if (k === 'm') { st.mirror = !st.mirror; face.calibrate(); syncUi(); }
});
if (/[?&]clean\b/.test(location.search)) setPanel(false);

let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (sim) { face.demo(now / 1000); st.haveFace = true; } else if (!st.live && !window.__holdIdle) face.idle(now / 1000);
  zoom += Math.sign(zoomGoal - zoom) * Math.min(Math.abs(zoomGoal - zoom), dt / 1.6);
  face.step(dt); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, stage.width, stage.height);
  const e = face.drawScene(ctx, stage.width, stage.height, zoom);
  bgEl.style.transform = `scale(${1 + 1.1 * e})`; fgEl.style.opacity = String(1 - e); fgEl.style.transform = `scale(${1 + 0.6 * e})`;
  frames++; if (now - fpsT > 1000) { drawFps = frames; frames = 0; fpsT = now; }
  requestAnimationFrame(frame);
})(last);
setInterval(() => { strip(); syncUi(); }, 250);
window.__face = { retarget: face._retarget, rig: face.rig, target: face.target, set: (o) => Object.assign(face.target, o), snap: face.snap };
window.__face.bench = (n = 150) => { // average milliseconds to draw one frame
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { face.demo(i / 30); face.step(1 / 60); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, stage.width, stage.height); face.drawScene(ctx, stage.width, stage.height, zoom); }
  return (performance.now() - t0) / n;
};
if (!DEMO) useLive();
syncUi();
