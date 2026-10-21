// Prototype screen: an automated walkthrough of the Motion Rig flow (capture, arrival sheet, rig, say hi).
// It plays by itself and loops. Self-contained: it does not load or change the Motion Rig application.
const $ = (id) => document.getElementById(id);
const stage = $('stage'), ctx = stage.getContext('2d'), workspace = $('workspace'), screenEl = $('screen'), device = $('device');

const WALK = { frames: 12, w: 162, h: 386, fps: 12, stepH: 0.021, stand: 11 };
const HI = { frames: 12, w: 217, h: 451, fps: 8, hold: 0.9 };
const CHAR_H = 0.52; // on-screen character height, as a share of the screen height
const GROUND = 0.8;  // where the feet stand, as a share of the screen height

const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
const loadJson = (src) => fetch(src).then((r) => r.json());
const [walkSheet, hiSheet, walkJoints, hiJoints] = await Promise.all([
  load('assets/walk-sheet.png'), load('assets/hi-sheet.png'), loadJson('assets/walk-skeleton.json'), loadJson('assets/hi-skeleton.json'),
]);

// what the stage shows right now
const view = { kind: 'hi', skel: false, travel: false, walkPhase: 0, walkDist: 0, hiT: 0, hiPlay: false, last: 0, speed: 1 };

function fit() {
  const s = Math.min(1, innerWidth / 1240, innerHeight / 880);
  device.style.setProperty('--fit', String(s));
  return s;
}
fit(); addEventListener('resize', fit);
function resize() {
  const k = window.devicePixelRatio || 1;
  stage.width = Math.round(workspace.clientWidth * k);
  stage.height = Math.round(workspace.clientHeight * k);
}
resize(); new ResizeObserver(resize).observe(workspace);

// ---------- skeletons (same look as the rig) ----------
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

// ---------- the stage ----------
function tick(now) {
  const dt = view.last ? Math.min((now - view.last) / 1000, 0.1) : 0;
  view.last = now;
  if (view.kind === 'walk' && view.walkOn) {
    const adv = dt * WALK.fps * view.speed;
    view.walkPhase = (view.walkPhase + adv) % WALK.frames;
    view.walkDist += adv * WALK.stepH;
  } else if (view.kind === 'hi' && view.hiPlay) {
    view.hiT = Math.min(view.hiT + dt * HI.fps * view.speed, HI.frames - 1);
  }
}
function draw() {
  const W = stage.width, H = stage.height;
  ctx.clearRect(0, 0, W, H);
  const cell = view.kind === 'walk' ? WALK : HI;
  const h = H * CHAR_H, k = h / cell.h, w = cell.w * k, top = H * GROUND - h;
  let cx = W / 2, i, f, sheet, joints, BL;
  if (view.kind === 'walk') {
    if (view.travel) cx = -w / 2 + ((view.walkDist * h) % (W + w));
    if (view.walkOn) { i = Math.floor(view.walkPhase) % WALK.frames; f = view.walkPhase - Math.floor(view.walkPhase); } else { i = WALK.stand; f = 0; }
    sheet = walkSheet; joints = walkJoints; BL = 0.4;
  } else {
    i = Math.min(Math.floor(view.hiT), HI.frames - 1); f = view.hiT < HI.frames - 1 ? view.hiT - Math.floor(view.hiT) : 0;
    sheet = hiSheet; joints = hiJoints; BL = 0.5;
  }
  const at = (n, a) => { ctx.globalAlpha = a; ctx.drawImage(sheet, n * cell.w, 0, cell.w, cell.h, cx - w / 2, top, w, h); ctx.globalAlpha = 1; };
  at(i, 1);
  const t = (view.kind === 'hi' && i === HI.frames - 1) || (view.kind === 'walk' && !view.walkOn) ? 0 : Math.max(0, (f - (1 - BL)) / BL);
  if (t > 0) at((i + 1) % cell.frames, t * t * (3 - 2 * t));
  if (view.skel) {
    const J = blend(joints[i], joints[(i + 1) % cell.frames], f, cx - w / 2, top, k);
    if (view.kind === 'walk') drawWalkSkeleton(J, k); else drawHiSkeleton(J, k);
  }
}
(function frame(now) { tick(now); draw(); requestAnimationFrame(frame); })(0);

// ---------- director ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const touch = $('pTouch');
function centerOf(el) {
  const s = fit(), r = el.getBoundingClientRect(), o = screenEl.getBoundingClientRect();
  return [(r.left + r.width / 2 - o.left) / s, (r.top + r.height / 2 - o.top) / s];
}
async function moveTo(el, ms = 900) {
  const [x, y] = centerOf(el);
  if (!touch.classList.contains('show')) { touch.classList.add('jump'); touch.style.left = `${x + 60}px`; touch.style.top = `${y + 90}px`; touch.offsetWidth; touch.classList.remove('jump'); touch.classList.add('show'); }
  touch.style.left = `${x}px`; touch.style.top = `${y}px`;
  await wait(ms);
}
async function tap(el) { await moveTo(el); touch.classList.add('down'); await wait(160); touch.classList.remove('down'); await wait(140); }
const liftFinger = () => touch.classList.remove('show');
function tip(text, anchor, below = false) {
  const t = $('pTip'); t.textContent = text; t.classList.remove('hidden'); t.classList.toggle('below', below);
  const s = fit(), [x, y] = centerOf(anchor), o = screenEl.getBoundingClientRect();
  t.style.left = `${Math.max(10, x - 120)}px`;
  t.style.top = below ? `${y + 30}px` : `${y - 54}px`;
  t.style.setProperty('--arrow', `${Math.min(220, Math.max(14, x - Math.max(10, x - 120)))}px`);
}
const hideTip = () => show('pTip', false);
async function toast(text, ms = 2200) { const t = $('pToast'); t.textContent = text; show('pToast'); await wait(ms); show('pToast', false); }

const bar = $('capBar');
const stand = () => Object.assign(view, { kind: 'hi', skel: false, hiT: 0, hiPlay: false, travel: false });
const mmss = (s) => `0:${String(s).padStart(2, '0')}`;

// thumbnails of the walk drawings for the arrival sheet
function thumb(i) {
  const c = document.createElement('canvas'); c.width = 180; c.height = 126;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 180, 126);
  const k = 120 / WALK.h; g.drawImage(walkSheet, i * WALK.w, 0, WALK.w, WALK.h, 90 - (WALK.w * k) / 2, 3, WALK.w * k, 120);
  return c;
}
function arriveSheet() {
  const el = $('arrive');
  el.innerHTML = `
    <header class="ar-head"><div class="ar-titles"><div class="ar-title">Your motion</div><div class="ar-sub">The drawings where you move the most. Tap one to leave it out.</div></div></header>
    <div class="ar-strip-wrap"><div class="ar-strip" id="pStrip"></div></div>
    <div class="ar-count"><span>Few</span><input type="range" min="4" max="24" step="1" value="12" aria-label="How many drawings"><span>Many</span><b>12 drawings</b></div>
    <footer class="ar-foot"><button class="btn">Retake</button><span class="tl-spacer"></span><button class="btn" id="pRig">Rig it</button><button class="btn primary">Keep</button></footer>`;
  const strip = el.querySelector('#pStrip');
  for (let i = 0; i < 12; i++) {
    const b = document.createElement('button'); b.className = 'ar-frame'; b.append(thumb(i));
    const n = document.createElement('span'); n.textContent = i + 1; b.append(n); strip.append(b);
  }
}

async function scene() {
  // 1. ready: the character stands, the camera button is offered
  stand(); show('capBar', false); show('arrive', false); show('recChip', false); show('capCount', false); show('pToast', false);
  document.body.classList.remove('take-recording'); $('btnCam').classList.remove('on');
  bar.className = 'cap-bar idle hidden'; liftFinger();
  await wait(1200);
  tip('Tap to open the camera and capture', $('btnCam'), true); await wait(1500);
  await tap($('btnCam')); hideTip(); $('btnCam').classList.add('on');
  bar.classList.remove('hidden'); await wait(1000);

  // 2. no camera needed: demo performer
  await tap($('capStartDemo'));
  bar.classList.remove('idle'); $('capStatusText').textContent = 'Demo performer'; $('capInfo').textContent = 'Tap, then hold your pose';
  await wait(900);

  // 3. Motion: record a walk
  const motionBtn = bar.querySelector('[data-mode="motion"]'), poseBtn = bar.querySelector('[data-mode="pose"]');
  await tap(motionBtn); motionBtn.classList.add('active'); poseBtn.classList.remove('active'); bar.classList.add('motion');
  $('capInfo').textContent = 'Tap, then move for up to 10 seconds';
  await wait(700); await tap($('capShutter'));
  bar.classList.add('recording'); document.body.classList.add('take-recording'); show('recChip'); liftFinger();
  Object.assign(view, { kind: 'walk', skel: true, travel: true, walkOn: true, walkPhase: 0, walkDist: 0.05 });
  for (let s = 1; s <= 7; s++) { $('recTime').textContent = mmss(s); $('capInfo').textContent = `Recording ${mmss(s)}`; await wait(1000); }
  await tap($('capShutter')); liftFinger();
  bar.classList.remove('recording'); document.body.classList.remove('take-recording'); show('recChip', false);
  view.walkOn = false; view.travel = false; show('capBar', false);

  // 4. arrival sheet: the drawings that were caught
  arriveSheet(); show('arrive'); await wait(2200);
  await tap($('pRig')); show('arrive', false);

  // 5. rig mode: bones follow every drawing
  const pill = document.createElement('div'); pill.className = 'rig-pill'; pill.innerHTML = '<b>Rig</b> Bones follow every drawing'; screenEl.append(pill);
  Object.assign(view, { kind: 'walk', skel: true, travel: false, walkOn: true, walkPhase: 0 }); liftFinger();
  await wait(6500); pill.remove();

  // 6. a pose: say hi
  stand(); bar.classList.remove('motion', 'recording'); bar.classList.add('counting'); show('capBar');
  poseBtn.classList.add('active'); motionBtn.classList.remove('active'); $('capInfo').textContent = 'Tap, then hold your pose'; await wait(700);
  await tap(poseBtn); await tap($('capShutter')); liftFinger();
  bar.classList.remove('counting'); show('capBar', false); show('capCount');
  for (const n of [3, 2, 1]) { $('capCountNum').textContent = n; const c = $('capCount'); c.classList.remove('beat'); c.offsetWidth; c.classList.add('beat'); await wait(950); }
  show('capCount', false); const fl = $('pFlash'); fl.classList.remove('hidden'); fl.style.animation = 'none'; fl.offsetWidth; fl.style.animation = ''; await wait(450); fl.classList.add('hidden');
  Object.assign(view, { kind: 'hi', skel: true, hiT: 0, hiPlay: true });
  await wait(1200 + (HI.frames / HI.fps) * 1000 + 2500);
  await toast('Say hi added to Layers', 2200);
  view.skel = false; await wait(1800);
}
for (;;) await scene();
