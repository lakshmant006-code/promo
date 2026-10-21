// Face screen: the shared face core on its own tablet screen, with a thin pipeline strip.
import { createFace } from '../facecore.js';
const $ = (id) => document.getElementById(id);
const stage = $('stage'), ctx = stage.getContext('2d'), workspace = $('workspace'), device = $('device'), video = $('camVideo');
const params = new URLSearchParams(location.search), DEMO = params.has('demo');
const lerp = (a, b, t) => a + (b - a) * t;
function fit() { device.style.setProperty('--fit', String(Math.min(1, innerWidth / 1240, innerHeight / 880))); }
fit(); addEventListener('resize', fit);
function resize() { const k = window.devicePixelRatio || 1; stage.width = Math.round(workspace.clientWidth * k); stage.height = Math.round(workspace.clientHeight * k); }
resize(); new ResizeObserver(resize).observe(workspace);

const face = await createFace('assets/'), st = face.state;
let zoom = params.has('wide') ? 0 : 1, zoomGoal = zoom, mirrorOn = true;
const bgEl = $('bgLayer'), fgEl = $('fgLayer');
const setZoom = (g) => { zoomGoal = g; $('pbZoom').textContent = g ? 'Wide shot' : 'Zoom to face'; };
const node = (id, s, text, sub) => { const n = $(id); n.classList.toggle('on', s === 'on'); n.classList.toggle('warn', s === 'warn'); if (sub) $(sub).textContent = text; };
const note = () => {}; // no on-screen messages
let frames = 0, fpsT = performance.now(), drawFps = 0;
function strip() {
  node('pnRet', st.haveFace ? (st.calibrating ? 'warn' : 'on') : '', st.calibrating ? 'hold a neutral face' : st.calibrated ? 'calibrated · One Euro' : 'tap Calibrate', 'pnRetTxt');
  node('pnRig', st.haveFace ? 'on' : '', '14 controls · spring', 'pnRigTxt');
  node('pnOut', 'on', `${drawFps} fps · original art`, 'pnOutTxt');
  if (st.haveFace) node('pnTrk', 'on', `478 points · 52 blendshapes · ${st.trackFps} fps`, 'pnTrkTxt');
}
$('pbCal').addEventListener('click', face.calibrate);
const flip = () => { st.mirror = !st.mirror; face.calibrate(); };
$('pbMirror').addEventListener('click', flip);
$('pbZoom').addEventListener('click', () => setZoom(zoomGoal ? 0 : 1));
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'c') face.calibrate(); if (k === 'z') setZoom(zoomGoal ? 0 : 1); if (k === 'm') flip();
});
let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (DEMO || window.__sim) { face.demo(now / 1000); st.haveFace = true; } else if (!st.live && !window.__holdIdle) face.idle(now / 1000);
  zoom += Math.sign(zoomGoal - zoom) * Math.min(Math.abs(zoomGoal - zoom), dt / 1.6);
  face.step(dt); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, stage.width, stage.height);
  const e = face.drawScene(ctx, stage.width, stage.height, zoom);
  bgEl.style.transform = `scale(${1 + 1.1 * e})`; fgEl.style.opacity = String(1 - e); fgEl.style.transform = `scale(${1 + 0.6 * e})`;
  frames++; if (now - fpsT > 1000) { drawFps = frames; frames = 0; fpsT = now; }
  requestAnimationFrame(frame);
})(last);
setInterval(strip, 250); setZoom(zoomGoal);
window.__face = { rig: face.rig, target: face.target, set: (o) => Object.assign(face.target, o), snap: face.snap };
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
function simulated() { st.haveFace = true; window.__sim = true; node('pnCam', 'on', 'simulated', 'pnCamTxt'); node('pnTrk', 'on', 'scripted · no camera', 'pnTrkTxt'); }
if (DEMO) simulated();
else {
  node('pnTrk', 'warn', 'starting', 'pnTrkTxt');
  const r = await face.startTracking(video);
  if (r.ok) node('pnCam', 'on', st.camera, 'pnCamTxt');
  else if (!local) simulated(); // a published page cannot use the camera: show a scripted performance instead
  else node('pnCam', 'warn', r.reason === 'model' ? 'model failed' : 'allow the camera', 'pnCamTxt');
}
