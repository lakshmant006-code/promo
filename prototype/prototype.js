// Prototype screen: set up a sequence of scenes (capture, arrival sheet, rig, walk-in, say hi, face zoom), press Okay, then Play.
// Nothing plays until you do, and there are no captions. Self-contained: it does not load or change the Motion Rig application.
const $ = (id) => document.getElementById(id);
document.body.classList.add('lab-open'); // the panel starts open
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
const view = { kind: 'hi', skel: false, show: true, walkOn: false, walkPhase: 0, walkDist: 0, hiT: 0, hiPlay: false, last: 0, entered: false };
// options chosen in the panel
const opts = { dir: 'ltr', end: 'stop', skel: 'auto', // skeleton: auto = where the step shows it, on = always, off = never
  art: true, finger: true, loop: false, speed: 0.6 };

function fit() {
  const panel = document.body.classList.contains('lab-open') ? 340 : 0;
  const s = Math.min(1, (innerWidth - panel) / 1240, innerHeight / 880);
  device.style.setProperty('--fit', String(s));
  device.style.setProperty('--shift', `${-panel / 2}px`);
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
const bgEl = $('bgLayer'), fgEl = $('fgLayer');
const travelling = () => opts.dir !== 'place' && view.kind === 'walk' && view.travel;
let lastTs = 0;
function tick(now) {
  const dt = lastTs ? Math.min((now - lastTs) / 1000, 0.1) : 0; lastTs = now;
  if (view.kind === 'walk' && view.walkOn) {
    const adv = dt * WALK.fps * opts.speed;
    view.walkPhase = (view.walkPhase + adv) % WALK.frames;
    view.walkDist += adv * WALK.stepH;
    if (view.travel && opts.dir !== 'place' && opts.end === 'stop') { // "stops in the middle": once he reaches it, he stands still
      const h = stage.height * CHAR_H, w = WALK.w * (h / WALK.h);
      if (view.walkDist * h >= stage.width / 2 + w / 2) { view.walkOn = false; view.arrived = true; }
    }
  } else if (view.kind === 'hi' && view.hiPlay) {
    view.hiT += dt * HI.fps * opts.speed;
    const total = HI.frames + HI.hold * HI.fps;
    if (view.hiT >= total) { if (opts.loop) view.hiT %= total; else { view.hiT = HI.frames - 1; view.hiPlay = false; } }
  }
}
function draw() {
  const W = stage.width, H = stage.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  if (!view.show) return;
  const cell = view.kind === 'walk' ? WALK : HI;
  const h = H * CHAR_H, k = h / cell.h, w = cell.w * k, top = H * GROUND - h;
  let cx = W / 2, i, f, sheet, joints, BL, flip = false;
  if (view.kind === 'walk') {
    if (travelling()) {
      const d = view.walkDist * h;
      if (opts.dir === 'ltr') cx = -w / 2 + (opts.end === 'stop' ? Math.min(d, W / 2 + w / 2) : d % (W + w));
      else { flip = true; cx = W + w / 2 - (opts.end === 'stop' ? Math.min(d, W / 2 + w / 2) : d % (W + w)); }
    } else if (view.travel && opts.dir === 'rtl') flip = true;
    if (view.walkOn) { i = Math.floor(view.walkPhase) % WALK.frames; f = view.walkPhase - Math.floor(view.walkPhase); } else { i = WALK.stand; f = 0; }
    sheet = walkSheet; joints = walkJoints; BL = 0.4;
  } else {
    i = Math.min(Math.floor(view.hiT), HI.frames - 1); f = view.hiT < HI.frames - 1 ? view.hiT - Math.floor(view.hiT) : 0;
    sheet = hiSheet; joints = hiJoints; BL = 0.5;
  }
  ctx.save();
  if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); cx = W - cx; }
  const at = (n, a) => { ctx.globalAlpha = a; ctx.drawImage(sheet, n * cell.w, 0, cell.w, cell.h, cx - w / 2, top, w, h); ctx.globalAlpha = 1; };
  if (opts.art) {
    at(i, 1);
    const t = (view.kind === 'hi' && i === HI.frames - 1) || (view.kind === 'walk' && !view.walkOn) ? 0 : Math.max(0, (f - (1 - BL)) / BL);
    if (t > 0) at((i + 1) % cell.frames, t * t * (3 - 2 * t));
  }
  if (opts.skel === 'on' || (opts.skel === 'auto' && view.skel)) {
    const J = blend(joints[i], joints[(i + 1) % cell.frames], f, cx - w / 2, top, k);
    if (view.kind === 'walk') drawWalkSkeleton(J, k); else drawHiSkeleton(J, k);
  }
  ctx.restore();
}
(function frame(now) { tick(now); draw(); requestAnimationFrame(frame); })(0);

// ---------- steps ----------
class Cancel extends Error {}
const pending = new Set();
const wait = (ms) => new Promise((res, rej) => { const t = setTimeout(() => { pending.delete(e); res(); }, ms / opts.speed); const e = { t, rej }; pending.add(e); });
const waitReal = (ms) => new Promise((res, rej) => { const t = setTimeout(() => { pending.delete(e); res(); }, ms); const e = { t, rej }; pending.add(e); });
function cancelAll() { for (const e of pending) { clearTimeout(e.t); e.rej(new Cancel()); } pending.clear(); }
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const touch = $('pTouch');
const bar = $('capBar');
const motionBtn = bar.querySelector('[data-mode="motion"]'), poseBtn = bar.querySelector('[data-mode="pose"]');
const mmss = (s) => `0:${String(s).padStart(2, '0')}`;

function centerOf(el) {
  const s = fit(), r = el.getBoundingClientRect(), o = screenEl.getBoundingClientRect();
  return [(r.left + r.width / 2 - o.left) / s, (r.top + r.height / 2 - o.top) / s];
}
async function moveTo(el, ms = 900) {
  if (!opts.finger) { await wait(ms * 0.5); return; }
  const [x, y] = centerOf(el);
  if (!touch.classList.contains('show')) { touch.classList.add('jump'); touch.style.left = `${x + 60}px`; touch.style.top = `${y + 90}px`; touch.offsetWidth; touch.classList.remove('jump'); touch.classList.add('show'); }
  touch.style.transitionDuration = `${ms / opts.speed}ms`; touch.style.left = `${x}px`; touch.style.top = `${y}px`;
  await wait(ms);
}
async function tap(el) { await moveTo(el); if (opts.finger) { touch.classList.add('down'); await wait(160); touch.classList.remove('down'); } await wait(140); }
const liftFinger = () => touch.classList.remove('show', 'down');
const status = (t) => { const s = $('pStatus'); if (s) s.textContent = t; };

function resetUi() { // every on-screen piece back to "nothing happening"
  liftFinger(); show('capBar', false); show('arrive', false); show('recChip', false); show('capCount', false); show('pFlash', false);
  document.body.classList.remove('take-recording'); $('btnCam').classList.remove('on');
  bar.className = 'cap-bar idle hidden'; motionBtn.classList.remove('active'); poseBtn.classList.remove('active'); $('recTime').textContent = '0:00';
}
const standFront = () => Object.assign(view, { show: true, kind: 'hi', skel: false, hiT: 0, hiPlay: false });
const walkStand = (skel = false) => Object.assign(view, { show: true, kind: 'walk', skel, travel: false, walkOn: false, walkPhase: 0, walkDist: 0, arrived: false });
function startWalk({ travel, skel }) { Object.assign(view, { show: true, kind: 'walk', skel, travel, walkOn: true, walkPhase: 0, walkDist: 0, arrived: false }); }
const camOn = () => { $('btnCam').classList.add('on'); };
function barLive(mode) {
  camOn(); bar.classList.remove('idle', 'hidden', 'motion', 'recording', 'counting'); show('capBar');
  $('capStatusText').textContent = 'Demo performer';
  motionBtn.classList.toggle('active', mode === 'motion'); poseBtn.classList.toggle('active', mode === 'pose');
  bar.classList.toggle('motion', mode === 'motion');
  $('capInfo').textContent = mode === 'motion' ? 'Tap, then move for up to 10 seconds' : 'Tap, then hold your pose';
}
function arriveSheet() {
  const thumb = (i) => {
    const c = document.createElement('canvas'); c.width = 180; c.height = 126;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 180, 126);
    const k = 120 / WALK.h; g.drawImage(walkSheet, i * WALK.w, 0, WALK.w, WALK.h, 90 - (WALK.w * k) / 2, 3, WALK.w * k, 120);
    return c;
  };
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
  show('arrive');
}

// Each step first sets up what came before it, then plays only its own part.
const steps = {
  async ready() { resetUi(); standFront(); status('Ready: the character stands.'); },
  async camera() {
    resetUi(); standFront(); await wait(900);
    await tap($('btnCam')); camOn(); bar.classList.remove('hidden'); liftFinger(); status('Camera open: the capture bar is offered.');
  },
  async demo() {
    resetUi(); standFront(); camOn(); bar.classList.remove('hidden'); await wait(900);
    await tap($('capStartDemo')); barLive('pose'); liftFinger(); status('Demo performer: the capture bar is live.');
  },
  async record() {
    resetUi(); standFront(); barLive('pose'); await wait(700);
    await tap(motionBtn); barLive('motion'); await wait(600); await tap($('capShutter'));
    bar.classList.add('recording'); document.body.classList.add('take-recording'); show('recChip'); liftFinger();
    startWalk({ travel: true, skel: true }); status('Recording a walk.');
    for (let s = 1; s <= 8; s++) { $('recTime').textContent = mmss(s); $('capInfo').textContent = `Recording ${mmss(s)}`; await wait(1000); }
    await tap($('capShutter')); liftFinger();
    bar.classList.remove('recording'); document.body.classList.remove('take-recording'); show('recChip', false);
    walkStand(false); show('capBar', false); status('Recording stopped.');
  },
  async arrive() { resetUi(); walkStand(false); arriveSheet(); status('Arrival sheet: the drawings that were caught.'); },
  async rig() { resetUi(); startWalk({ travel: false, skel: true }); status('Rig mode: the skeleton follows every drawing.'); },
  async walkin() {
    resetUi(); startWalk({ travel: true, skel: true });
    status(opts.dir === 'place' ? 'Walking in place.' : `Walking in ${opts.dir === 'ltr' ? 'from the left' : 'from the right'}.`);
  },
  async pose() {
    resetUi(); standFront(); barLive('pose'); await wait(900);
    await tap(poseBtn); await tap($('capShutter')); liftFinger();
    bar.classList.add('counting'); show('capBar', false); show('capCount');
    for (const n of [3, 2, 1]) { $('capCountNum').textContent = n; const c = $('capCount'); c.classList.remove('beat'); c.offsetWidth; c.classList.add('beat'); await wait(950); }
    show('capCount', false); const fl = $('pFlash'); fl.classList.remove('hidden'); fl.style.animation = 'none'; fl.offsetWidth; fl.style.animation = ''; await wait(450); fl.classList.add('hidden');
    Object.assign(view, { kind: 'hi', skel: true, hiT: 0, hiPlay: true }); status('Say hi.');
    await wait(1200 + (HI.frames / HI.fps) * 1000 + 1500); view.skel = false;
  },
  async hi() { resetUi(); Object.assign(view, { show: true, kind: 'hi', skel: true, hiT: 0, hiPlay: true }); status('Say hi.'); },
  async walkhi() {
    const keep = opts.end; opts.end = 'stop'; if (opts.dir === 'place') opts.dir = 'ltr';
    syncOpts(); resetUi(); startWalk({ travel: true, skel: true }); status('Walking in, then saying hi.');
    try { while (view.walkOn) await wait(100); await wait(500); } finally { opts.end = keep; syncOpts(); }
    Object.assign(view, { kind: 'hi', skel: true, hiT: 0, hiPlay: true }); status('Say hi.');
  },
  async stop() { resetUi(); standFront(); status('Set up the sequence, then press Okay and Play.'); },
};
// what the sequence plays, in order, with how long each scene is left on screen (seconds at normal speed)
const SCENES = [
  { id: 'ready', label: 'Ready', dwell: 1.6 }, { id: 'camera', label: 'Open the camera', dwell: 1.8 }, { id: 'demo', label: 'Demo performer', dwell: 1.8 },
  { id: 'record', label: 'Record a walk', dwell: 1 }, { id: 'arrive', label: 'Arrival sheet', dwell: 3.5 }, { id: 'rig', label: 'Rig mode', dwell: 6.5 },
  { id: 'walkin', label: 'Walk in', dwell: 0 }, { id: 'pose', label: 'Pose and say hi', dwell: 0.6 } ,
];
let seq = SCENES.map((s) => ({ id: s.id, on: true }));
let running = null, playing = false;
async function run(name) {
  cancelAll(); playing = false;
  document.querySelectorAll('#pPanel [data-step]').forEach((b) => b.classList.toggle('running', b.dataset.step === name && name !== 'stop'));
  running = name;
  try { await steps[name](); } catch (e) { if (!(e instanceof Cancel)) throw e; return; }
  if (running === name) document.querySelectorAll('#pPanel [data-step]').forEach((b) => b.classList.remove('running'));
}
async function play() {
  cancelAll(); playing = true; setPanel(false); $('pFab').classList.add('gone');
  try {
    for (const s of seq.filter((x) => x.on)) {
      await steps[s.id]();
      if (s.id === 'walkin') { if (opts.dir !== 'place' && opts.end === 'stop') { while (view.walkOn) await wait(100); await wait(1400); } else await wait(9000); }
      else await wait(SCENES.find((x) => x.id === s.id).dwell * 1000);
    }
    await steps.stop();
  } catch (e) { if (!(e instanceof Cancel)) throw e; return; }
  playing = false; $('pFab').classList.remove('gone');
}
function stopPlay() { cancelAll(); playing = false; steps.stop(); $('pFab').classList.remove('gone'); }

// ---------- panel ----------
const PANEL = 340;
function setPanel(on) { document.body.classList.toggle('lab-open', on); fit(); $('pFab').classList.toggle('gone', on || playing); }
function save() { try { localStorage.setItem('proto.setup', JSON.stringify({ opts, seq })); } catch {} }
function restore() { try { const s = JSON.parse(localStorage.getItem('proto.setup') || 'null'); if (s) { Object.assign(opts, s.opts); if (Array.isArray(s.seq) && s.seq.every((x) => steps[x.id])) seq = s.seq; } } catch {} }
restore();
function renderSeq() {
  const ul = $('seqList'); ul.innerHTML = '';
  seq.forEach((s, i) => {
    const li = document.createElement('div'); li.className = 'row seq-row';
    li.innerHTML = `<label><input type="checkbox" class="switch" ${s.on ? 'checked' : ''}><span>${SCENES.find((x) => x.id === s.id).label}</span></label><span class="seq-mv"><button data-mv="-1" aria-label="Move up">&#9650;</button><button data-mv="1" aria-label="Move down">&#9660;</button></span>`;
    li.querySelector('input').addEventListener('input', (e) => { s.on = e.target.checked; save(); });
    li.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => { const j = i + Number(b.dataset.mv); if (j < 0 || j >= seq.length) return; [seq[i], seq[j]] = [seq[j], seq[i]]; save(); renderSeq(); }));
    ul.append(li);
  });
}
const SEG = [['oDir', 'dir'], ['oEnd', 'end'], ['oSkel', 'skel']];
function syncOpts() {
  for (const [id, key] of SEG) $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === opts[key]));
  $('oSpeedOut').textContent = `${opts.speed.toFixed(2)}×`; $('oSpeed').value = opts.speed;
  for (const [id, key] of [['oArt', 'art'], ['oFinger', 'finger'], ['oLoop', 'loop']]) $(id).checked = !!opts[key];
}
for (const [id, key] of SEG) $(id).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { opts[key] = b.dataset.v; syncOpts(); save(); }));
for (const [id, key] of [['oArt', 'art'], ['oFinger', 'finger'], ['oLoop', 'loop']]) $(id).addEventListener('input', (e) => { opts[key] = e.target.checked; if (key === 'finger' && !opts.finger) liftFinger(); save(); });
$('oFg').addEventListener('input', (e) => { fgEl.style.display = e.target.checked ? '' : 'none'; });
$('oSpeed').addEventListener('input', (e) => { opts.speed = Number(e.target.value); syncOpts(); save(); });
document.querySelectorAll('#pPanel [data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#pPanel [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('#pPanel [data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
}));
document.querySelectorAll('#pPanel [data-step]').forEach((b) => b.addEventListener('click', () => run(b.dataset.step)));
$('pOkay').addEventListener('click', () => { save(); setPanel(false); });
$('pPlay').addEventListener('click', () => { save(); play(); });
$('pFab').addEventListener('click', play);
$('pClose').addEventListener('click', () => setPanel(false));
$('pToggle').addEventListener('click', () => setPanel(true));
addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setPanel(!document.body.classList.contains('lab-open'));
  else if (k === ' ' || k === 'enter') { e.preventDefault(); playing ? stopPlay() : play(); }
  else if (k === 'escape') { stopPlay(); setPanel(true); }
  else if (k === 's') { opts.skel = opts.skel === 'on' ? 'off' : 'on'; syncOpts(); }
});
renderSeq(); syncOpts(); setPanel(true);
if (/[?&]clean\b/.test(location.search)) setPanel(false);
const first = location.hash.replace('#', '');
await steps[steps[first] ? first : 'ready']();
