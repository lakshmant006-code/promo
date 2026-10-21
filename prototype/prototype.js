// Prototype screen: plays the walk cycle and the say-hi wave inside the tablet, with the rig skeleton on top.
// Self-contained; it does not load or change the Motion Rig application.
const $ = (id) => document.getElementById(id);
const stage = $('stage'), ctx = stage.getContext('2d'), workspace = $('workspace');

const WALK = { frames: 12, w: 162, h: 386, fps: 12, stepH: 0.021, standFrame: 11 };
const HI = { frames: 12, w: 217, h: 451, fps: 8, hold: 0.9 };
const CHAR_H = 0.52; // on-screen character height, as a share of the screen height
const GROUND = 0.8;  // where the feet stand, as a share of the screen height

const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
const loadJson = (src) => fetch(src).then((r) => r.json());
const [walkSheet, hiSheet, walkJoints, hiJoints] = await Promise.all([
  load('assets/walk-sheet.png'), load('assets/hi-sheet.png'), loadJson('assets/walk-skeleton.json'), loadJson('assets/hi-skeleton.json'),
]);

const state = { mode: 'walk', skel: true, art: true, travel: true, loop: true, speed: 1, last: 0, walkPhase: 0, walkDist: 0, hiT: 0, hiPlaying: true };

function resize() {
  const k = window.devicePixelRatio || 1;
  stage.width = Math.round(workspace.clientWidth * k);
  stage.height = Math.round(workspace.clientHeight * k);
}
resize();
new ResizeObserver(resize).observe(workspace);

// ---------- skeletons ----------
const WALK_BONES = [['head', 'neck'], ['neck', 'hip'], ['neck', 'fElbow'], ['fElbow', 'fWrist'], ['hip', 'fKnee'], ['fKnee', 'fAnkle'], ['fAnkle', 'fToe'],
  ['neck', 'nElbow'], ['nElbow', 'nWrist'], ['hip', 'nKnee'], ['nKnee', 'nAnkle'], ['nAnkle', 'nToe']];
const blend = (A, B, f, ox, oy, k) => {
  const J = {};
  for (const n of Object.keys(A)) J[n] = [ox + (A[n][0] + (B[n][0] - A[n][0]) * f) * k, oy + (A[n][1] + (B[n][1] - A[n][1]) * f) * k];
  return J;
};
function drawWalkSkeleton(J, k) {
  ctx.save(); ctx.lineCap = 'round';
  for (const [a, b] of WALK_BONES) {
    const far = a[0] === 'f' || b[0] === 'f';
    ctx.strokeStyle = far ? 'rgba(80,190,255,.95)' : 'rgba(255,255,255,.98)';
    ctx.lineWidth = Math.max(2, 7 * k);
    ctx.beginPath(); ctx.moveTo(...J[a]); ctx.lineTo(...J[b]); ctx.stroke();
  }
  const r = Math.max(3, 8 * k);
  ctx.beginPath(); ctx.arc(J.head[0], J.head[1], 38 * k, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(2, 4 * k); ctx.stroke();
  for (const [n, p] of Object.entries(J)) {
    ctx.beginPath(); ctx.arc(p[0], p[1], n === 'hip' ? r * 1.4 : r, 0, Math.PI * 2);
    ctx.fillStyle = n === 'hip' ? '#ff5a3c' : '#ffb62e'; ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2.5 * k); ctx.strokeStyle = '#1b1b22'; ctx.stroke();
  }
  ctx.restore();
}
function drawHiSkeleton(J, k) {
  const lw = Math.max(2, 5 * k), r = Math.max(3, 6 * k);
  const line = (pts, col, w = lw) => {
    ctx.beginPath(); ctx.moveTo(...J[pts[0]]);
    for (const p of pts.slice(1)) ctx.lineTo(...J[p]);
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const [hx, hy] = J.head, hr = 52 * k;
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.strokeStyle = '#2f7ae0'; ctx.lineWidth = lw; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx - hr, hy); ctx.lineTo(hx + hr, hy); ctx.moveTo(hx, hy - hr); ctx.lineTo(hx, hy + hr);
  ctx.strokeStyle = 'rgba(47,122,224,.55)'; ctx.lineWidth = Math.max(1, 2 * k); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx, hy + hr); ctx.lineTo(...J.neck); ctx.strokeStyle = '#e5566a'; ctx.lineWidth = lw; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(...J.lS); ctx.lineTo(...J.rS); ctx.lineTo(...J.rH); ctx.lineTo(...J.lH); ctx.closePath();
  ctx.fillStyle = 'rgba(229,86,106,.16)'; ctx.fill(); ctx.strokeStyle = '#e5566a'; ctx.lineWidth = lw; ctx.stroke();
  line(['lH', 'rH'], '#2fb36a', lw * 1.8);
  line(['lS', 'lE', 'lW'], '#f0a02a'); line(['rS', 'rE', 'rW'], '#f0a02a');
  line(['lH', 'lK', 'lA', 'lT'], '#8d63e0'); line(['rH', 'rK', 'rA', 'rT'], '#8d63e0');
  for (const [n, p] of Object.entries(J)) {
    if (n === 'head' || n === 'neck') continue;
    ctx.beginPath(); ctx.arc(p[0], p[1], n === 'lW' || n === 'rW' ? r * 1.5 : r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = Math.max(1.5, 2.5 * k); ctx.strokeStyle = '#2f7ae0'; ctx.stroke();
  }
  ctx.restore();
}

// ---------- playback ----------
function tick(now) {
  const dt = state.last ? Math.min((now - state.last) / 1000, 0.1) : 0;
  state.last = now;
  if (state.mode === 'walk') {
    const adv = dt * WALK.fps * state.speed;
    state.walkPhase = (state.walkPhase + adv) % WALK.frames;
    state.walkDist += adv * WALK.stepH;
  } else if (state.hiPlaying) {
    state.hiT += dt * HI.fps * state.speed;
    const total = HI.frames + HI.hold * HI.fps;
    if (state.hiT >= total) { if (state.loop) state.hiT %= total; else { state.hiT = total; state.hiPlaying = false; } }
  }
}

function draw() {
  const W = stage.width, H = stage.height;
  ctx.clearRect(0, 0, W, H);
  const cell = state.mode === 'walk' ? WALK : HI;
  const h = H * CHAR_H, k = h / cell.h, w = cell.w * k, groundY = H * GROUND, top = groundY - h;
  let cx = W / 2, i, f, sheet, joints;
  if (state.mode === 'walk') {
    if (state.travel) cx = -w / 2 + ((state.walkDist * h) % (W + w));
    i = Math.floor(state.walkPhase) % WALK.frames; f = state.walkPhase - Math.floor(state.walkPhase);
    sheet = walkSheet; joints = walkJoints;
  } else {
    i = Math.min(Math.floor(state.hiT), HI.frames - 1); f = state.hiT < HI.frames - 1 ? state.hiT - Math.floor(state.hiT) : 0;
    sheet = hiSheet; joints = hiJoints;
  }
  const at = (n, a) => { ctx.globalAlpha = a; ctx.drawImage(sheet, n * cell.w, 0, cell.w, cell.h, cx - w / 2, top, w, h); ctx.globalAlpha = 1; };
  if (state.art) {
    at(i, 1);
    const BL = state.mode === 'walk' ? 0.4 : 0.5;
    const nxt = (i + 1) % cell.frames;
    const t = state.mode === 'hi' && i === HI.frames - 1 ? 0 : Math.max(0, (f - (1 - BL)) / BL);
    if (t > 0) at(nxt, t * t * (3 - 2 * t));
  }
  if (state.skel) {
    const J = blend(joints[i], joints[(i + 1) % cell.frames], f, cx - w / 2, top, k);
    if (state.mode === 'walk') drawWalkSkeleton(J, k); else drawHiSkeleton(J, k);
  }
}

function frame(now) { tick(now); draw(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

// ---------- controls ----------
const bar = $('protoBar');
const setPressed = (btn, on) => btn.setAttribute('aria-pressed', String(on));
function setMode(m) {
  state.mode = m;
  document.querySelectorAll('.proto-bar [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  $('pbTravel').hidden = m !== 'walk';
  $('pbLoop').hidden = m !== 'hi';
  if (m === 'hi') { state.hiT = 0; state.hiPlaying = true; }
}
document.querySelectorAll('.proto-bar [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
const toggle = (id, key) => $(id).addEventListener('click', (e) => { state[key] = !state[key]; setPressed(e.currentTarget, state[key]); if (key === 'loop' && state.loop) state.hiPlaying = true; });
toggle('pbSkel', 'skel'); toggle('pbArt', 'art'); toggle('pbTravel', 'travel'); toggle('pbLoop', 'loop');
$('pbSpeed').addEventListener('input', (e) => { state.speed = Number(e.target.value); $('pbSpeedOut').textContent = `${state.speed.toFixed(2)}×`; });
$('pbReplay').addEventListener('click', () => { state.hiT = 0; state.hiPlaying = true; state.walkPhase = 0; state.walkDist = 0; });
addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') bar.classList.toggle('off'); });
if (/[?&]clean\b/.test(location.search)) bar.classList.add('off');
const modeFromHash = location.hash.replace('#', '');
setMode(modeFromHash === 'hi' ? 'hi' : 'walk');
