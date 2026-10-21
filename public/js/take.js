// Takes: capture one pose or a short motion (up to 10 s), land it in Layers as frames, and
// optionally rig it. Everything here speaks an artist's language: drawings, clean-up, feel,
// a pose brush. No graphs, no physics.
//
// A take keeps every captured sample (`raw`, 30 per second) and a list of frames (the
// drawings) that point into it. Clean-up and feel are applied when a frame is shown, so they
// can be changed at any time without losing the original performance.
import { lerpPose, splinePose } from './rig.js';

const $ = (id) => document.getElementById(id);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const RATE = 30; // samples per second while recording
const MAX_SECONDS = 10;
const MIN_SECONDS = 1;
const FLOAT_LAG = 0.16; // seconds a "floaty" part trails behind
const BONES = ['spine', 'neck', 'shoulders', 'hips', 'upperArmR', 'foreArmR', 'upperArmL', 'foreArmL', 'thighR', 'shinR', 'thighL', 'shinL'];

// ---------- the part tree ----------
const C = { char: '#c9c9d1', head: '#f0a14a', torso: '#ee6a7e', arm: '#6cb2ff', leg: '#4ec9b0' };
const TREE = [
  { id: 'char', p: null, name: 'Character', color: C.char },
  { id: 'head', p: 'char', name: 'Head', color: C.head, bones: ['neck'], joints: ['neck', 'head'] },
  { id: 'torso', p: 'char', name: 'Body', color: C.torso, bones: ['spine', 'shoulders', 'hips'], joints: ['neck', 'pelvis', 'shoulderR', 'shoulderL', 'hipR', 'hipL'] },
  { id: 'armR', p: 'char', name: 'Arm R', color: C.arm, joints: ['shoulderR', 'elbowR', 'wristR'] },
  { id: 'upperArmR', p: 'armR', name: 'Upper arm R', color: C.arm, bones: ['upperArmR'], joints: ['shoulderR', 'elbowR', 'wristR'] },
  { id: 'foreArmR', p: 'armR', name: 'Forearm & hand R', color: C.arm, bones: ['foreArmR'], joints: ['shoulderR', 'elbowR', 'wristR'] },
  { id: 'armL', p: 'char', name: 'Arm L', color: C.arm, joints: ['shoulderL', 'elbowL', 'wristL'] },
  { id: 'upperArmL', p: 'armL', name: 'Upper arm L', color: C.arm, bones: ['upperArmL'], joints: ['shoulderL', 'elbowL', 'wristL'] },
  { id: 'foreArmL', p: 'armL', name: 'Forearm & hand L', color: C.arm, bones: ['foreArmL'], joints: ['shoulderL', 'elbowL', 'wristL'] },
  { id: 'legR', p: 'char', name: 'Leg R', color: C.leg, joints: ['hipR', 'kneeR', 'ankleR'] },
  { id: 'thighR', p: 'legR', name: 'Thigh R', color: C.leg, bones: ['thighR'], joints: ['hipR', 'kneeR', 'ankleR'] },
  { id: 'shinR', p: 'legR', name: 'Shin & foot R', color: C.leg, bones: ['shinR'], joints: ['hipR', 'kneeR', 'ankleR'] },
  { id: 'legL', p: 'char', name: 'Leg L', color: C.leg, joints: ['hipL', 'kneeL', 'ankleL'] },
  { id: 'thighL', p: 'legL', name: 'Thigh L', color: C.leg, bones: ['thighL'], joints: ['hipL', 'kneeL', 'ankleL'] },
  { id: 'shinL', p: 'legL', name: 'Shin & foot L', color: C.leg, bones: ['shinL'], joints: ['hipL', 'kneeL', 'ankleL'] },
];
const NODE = Object.fromEntries(TREE.map((n) => [n.id, { ...n, kids: [] }]));
for (const n of TREE) if (n.p) NODE[n.p].kids.push(n.id);
const NODE_OF_BONE = {};
for (const n of TREE) for (const b of n.bones || []) NODE_OF_BONE[b] = n.id;
const ALL_JOINTS = ['head', 'neck', 'pelvis', 'shoulderR', 'shoulderL', 'elbowR', 'elbowL', 'wristR', 'wristL', 'hipR', 'hipL', 'kneeR', 'kneeL', 'ankleR', 'ankleL'];
// Bones drawn on the canvas in Rig mode, and tapped to select a part: [part, from joint, to joint].
const BONE_SHAPES = [
  ['torso', 'pelvis', 'neck'], ['torso', 'neck', 'shoulderR'], ['torso', 'neck', 'shoulderL'],
  ['torso', 'pelvis', 'hipR'], ['torso', 'pelvis', 'hipL'], ['head', 'neck', 'head'],
  ['upperArmR', 'shoulderR', 'elbowR'], ['foreArmR', 'elbowR', 'wristR'],
  ['upperArmL', 'shoulderL', 'elbowL'], ['foreArmL', 'elbowL', 'wristL'],
  ['thighR', 'hipR', 'kneeR'], ['shinR', 'kneeR', 'ankleR'],
  ['thighL', 'hipL', 'kneeL'], ['shinL', 'kneeL', 'ankleL'],
];
// What turns when a part is rotated: the joint it turns around, the joint at its tip (for the
// size of the rotate circle) and the rig bones that turn with it. Angles in this rig are
// absolute, so a part's children are listed too, to follow it the way they would on a puppet.
const ARM = (s) => ['upperArm' + s, 'foreArm' + s];
const LEG = (s) => ['thigh' + s, 'shin' + s];
const ROTATE = {
  head: { pivot: 'neck', tip: 'head', bones: ['neck'] },
  torso: { pivot: 'pelvis', tip: 'neck', bones: ['spine', 'neck', 'shoulders', ...ARM('R'), ...ARM('L')] },
  armR: { pivot: 'shoulderR', tip: 'wristR', bones: ARM('R') },
  upperArmR: { pivot: 'shoulderR', tip: 'elbowR', bones: ARM('R') },
  foreArmR: { pivot: 'elbowR', tip: 'wristR', bones: ['foreArmR'] },
  armL: { pivot: 'shoulderL', tip: 'wristL', bones: ARM('L') },
  upperArmL: { pivot: 'shoulderL', tip: 'elbowL', bones: ARM('L') },
  foreArmL: { pivot: 'elbowL', tip: 'wristL', bones: ['foreArmL'] },
  legR: { pivot: 'hipR', tip: 'ankleR', bones: LEG('R') },
  thighR: { pivot: 'hipR', tip: 'kneeR', bones: LEG('R') },
  shinR: { pivot: 'kneeR', tip: 'ankleR', bones: ['shinR'] },
  legL: { pivot: 'hipL', tip: 'ankleL', bones: LEG('L') },
  thighL: { pivot: 'hipL', tip: 'kneeL', bones: LEG('L') },
  shinL: { pivot: 'kneeL', tip: 'ankleL', bones: ['shinL'] },
};
// What lengthens with the Stretch brush: the joint it grows from, its tip, and the bones.
const STRETCH = {
  armR: { pivot: 'shoulderR', tip: 'wristR', bones: ARM('R') },
  upperArmR: { pivot: 'shoulderR', tip: 'elbowR', bones: ['upperArmR'] },
  foreArmR: { pivot: 'elbowR', tip: 'wristR', bones: ['foreArmR'] },
  armL: { pivot: 'shoulderL', tip: 'wristL', bones: ARM('L') },
  upperArmL: { pivot: 'shoulderL', tip: 'elbowL', bones: ['upperArmL'] },
  foreArmL: { pivot: 'elbowL', tip: 'wristL', bones: ['foreArmL'] },
  legR: { pivot: 'hipR', tip: 'ankleR', bones: LEG('R') },
  thighR: { pivot: 'hipR', tip: 'kneeR', bones: ['thighR'] },
  shinR: { pivot: 'kneeR', tip: 'ankleR', bones: ['shinR'] },
  legL: { pivot: 'hipL', tip: 'ankleL', bones: LEG('L') },
  thighL: { pivot: 'hipL', tip: 'kneeL', bones: ['thighL'] },
  shinL: { pivot: 'kneeL', tip: 'ankleL', bones: ['shinL'] },
};
const partBones = (id) => [...new Set([...(ROTATE[id]?.bones || []), ...(STRETCH[id]?.bones || []), ...bonesOfNode(id)])];
const bonesOfNode = (id) => {
  const n = NODE[id];
  return (n.bones || []).concat(...n.kids.map(bonesOfNode));
};
const bonesOf = (id) => {
  const n = NODE[id];
  return (n.bones || []).concat(...n.kids.map(bonesOf));
};
const isInside = (id, ancestor) => {
  for (let n = id; n; n = NODE[n].p) if (n === ancestor) return true;
  return false;
};

const FEELS = {
  snappy: { label: 'Snappy', hint: 'Holds each drawing, then moves quickly', icon: '<path d="M3 17h5l4-10 4 10h5"/>' },
  smooth: { label: 'Smooth', hint: 'One easy, flowing line of movement', icon: '<path d="M3 17c5 0 5-10 9-10s4 10 9 10"/>' },
  floaty: { label: 'Floaty', hint: 'Trails a little behind, then settles', icon: '<path d="M3 15c3-6 6-6 9 0s6 6 9 0"/><circle cx="21" cy="15" r="1.4" fill="currentColor" stroke="none"/><circle cx="17.5" cy="18.5" r="1" fill="currentColor" stroke="none"/>' },
};

// ---------- pose helpers ----------
const clonePose = (p) => ({ angle: { ...p.angle }, ratio: { ...p.ratio }, face: { ...p.face }, offset: { ...p.offset } });
function poseDist(a, b) {
  let d = 0;
  for (const k of BONES) d += Math.abs(wrap(a.angle[k] - b.angle[k]));
  return d + Math.hypot(a.offset.x - b.offset.x, a.offset.y - b.offset.y);
}
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// Pick n drawings from the samples: spaced evenly along how much the body moves, so fast
// moves get more drawings and holds get fewer, the way an animator plans keys.
function pickKeys(raw, n) {
  if (raw.length <= n) return raw.map((_, i) => i);
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum[i] = cum[i - 1] + poseDist(raw[i - 1], raw[i]) + 0.02;
  const total = cum[cum.length - 1];
  const picks = new Set([0, raw.length - 1]);
  let j = 0;
  for (let k = 1; k < n - 1; k++) {
    const target = (total * k) / (n - 1);
    while (j < raw.length - 1 && cum[j] < target) j++;
    picks.add(j);
  }
  const out = [...picks].sort((a, b) => a - b);
  while (out.length < n) {
    let gi = 0;
    for (let i = 1; i < out.length - 1; i++) if (out[i + 1] - out[i] > out[gi + 1] - out[gi]) gi = i;
    if (out[gi + 1] - out[gi] < 2) break;
    out.splice(gi + 1, 0, Math.round((out[gi] + out[gi + 1]) / 2));
  }
  return out;
}

// Clean-up: a soft average of neighbouring samples. 0 keeps every wobble; 1 is very clean.
function cleanAngle(raw, i, bone, amount) {
  const r = Math.round(amount * 14);
  const c = raw[i].angle[bone];
  if (!r) return c;
  const sig = r / 2;
  let s = 0, w = 0;
  for (let j = i - r; j <= i + r; j++) {
    if (j < 0 || j >= raw.length) continue;
    const wt = Math.exp(-((j - i) ** 2) / (2 * sig * sig));
    s += wrap(raw[j].angle[bone] - c) * wt;
    w += wt;
  }
  return c + s / w;
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function createTakes({ rig, toast, renderPose, pointsFor, isLive, onOpenChange, status, onStartCamera, onStartDemo, onStopLive, hints }) {
  const takes = [];
  let active = null;
  let nextFrameId = 1;
  let mode = 'pose'; // capture mode: 'pose' or 'motion'
  let rec = null; // motion being recorded
  let countdown = null; // pose countdown timer
  let sheet = null; // capture waiting for Keep / Rig it / Retake
  let panel = null; // 'frames' | 'rig' | null
  let playing = false;
  let playT0 = 0;
  let brush = null; // active pose-brush drag
  let hover = null; // part under the pointer in Rig mode, and where the pointer is
  let playRow = -1; // the frame row lit up while playing
  const preview = { playing: true, mode: 'after', t0: performance.now(), crop: null, cropKey: '' };
  const previewOff = document.createElement('canvas');
  previewOff.width = 960;
  previewOff.height = 640;

  // ---------- take data ----------
  function settingOf(take, id) {
    for (let n = id; n; n = NODE[n].p) if (take.settings[n]) return { from: n, ...take.settings[n] };
    return { from: 'char', clean: 0.35, feel: 'smooth' };
  }
  // The pose a frame shows. 'after' layers, in order: clean-up, the take's Rig changes (turns
  // and bone sizes for every frame), then this frame's own turns and stretches (Animate mode).
  // An in-between is a live blend of the two frames it was made from, so it follows them.
  function framePose(take, f, which, memo = new Map()) {
    if (memo.has(f.id)) return memo.get(f.id);
    let base;
    if (f.made) {
      const a = take.frames.find((x) => x.id === f.between[0]);
      const b = take.frames.find((x) => x.id === f.between[1]);
      base = a && b ? lerpPose(framePose(take, a, which, memo), framePose(take, b, which, memo), 0.5) : clonePose(take.raw[0]);
    } else {
      base = clonePose(take.raw[f.src]);
      if (which === 'before') return base;
      for (const b of BONES) base.angle[b] = cleanAngle(take.raw, f.src, b, settingOf(take, NODE_OF_BONE[b]).clean);
      for (const [b, v] of Object.entries(take.turns)) base.angle[b] += v;
      for (const [b, v] of Object.entries(take.lengths)) base.ratio[b] = (base.ratio[b] ?? 1) * v;
    }
    if (which === 'after') {
      for (const [b, v] of Object.entries(f.edits)) base.angle[b] += v;
      for (const [b, v] of Object.entries(f.stretch)) base.ratio[b] = (base.ratio[b] ?? 1) * v;
    }
    memo.set(f.id, base);
    return base;
  }
  // Separate caches so Before and After don't evict each other every frame.
  function posesFor(take, which) {
    take.caches = take.caches || {};
    const key = take.version;
    if (take.caches[which]?.key !== key) {
      const memo = new Map();
      take.caches[which] = { key, list: take.frames.map((f) => framePose(take, f, which, memo)) };
    }
    return take.caches[which].list;
  }
  const totalTime = (take) => take.frames.reduce((s, f) => s + f.dur, 0);
  function poseAtTime(take, t, which) {
    // Before: the performance exactly as the camera caught it, every sample, wobble and all.
    if (which === 'before' && take.raw.length > 1) {
      const n = take.raw.length;
      return take.raw[((Math.floor(t * RATE) % n) + n) % n];
    }
    const F = posesFor(take, which);
    const n = F.length;
    if (n === 1) return F[0];
    const total = totalTime(take);
    let r = ((t % total) + total) % total;
    let i = 0;
    while (i < n - 1 && r >= take.frames[i].dur) r -= take.frames[i++].dur;
    const u = clamp(r / take.frames[i].dur, 0, 1);
    const g = (k) => F[((k % n) + n) % n];
    if (which === 'before') return lerpPose(g(i), g(i + 1), u);
    const out = splinePose(g(i - 1), g(i), g(i + 1), g(i + 2), u);
    let snap = null, lag = null;
    for (const b of BONES) {
      const feel = settingOf(take, NODE_OF_BONE[b]).feel;
      if (feel === 'snappy') {
        snap = snap || lerpPose(g(i), g(i + 1), easeInOut(u));
        out.angle[b] = snap.angle[b];
      } else if (feel === 'floaty') {
        lag = lag || poseAtTimeSmooth(take, t - FLOAT_LAG);
        out.angle[b] = lag.angle[b];
      }
    }
    return out;
  }
  function poseAtTimeSmooth(take, t) {
    const F = posesFor(take, 'after');
    const n = F.length;
    const total = totalTime(take);
    let r = ((t % total) + total) % total;
    let i = 0;
    while (i < n - 1 && r >= take.frames[i].dur) r -= take.frames[i++].dur;
    const u = clamp(r / take.frames[i].dur, 0, 1);
    const g = (k) => F[((k % n) + n) % n];
    return splinePose(g(i - 1), g(i), g(i + 1), g(i + 2), u);
  }

  // Frames that sit next to each other but don't flow: a big change in pose between two
  // drawings that weren't neighbours when captured (usually after dragging frames around).
  function jumps(take) {
    return jumpInfo(take).flagged;
  }
  function jumpInfo(take) {
    const fr = take.frames;
    if (fr.length < 2) return { flagged: [], pairs: [], limit: 0 };
    const A = posesFor(take, 'after');
    const order = fr.filter((f) => !f.made).map((f) => f.src).sort((a, b) => a - b);
    const rank = new Map(order.map((s, i) => [s, i]));
    // How far the pose usually moves from one drawing to the next in this take.
    const bySrc = fr.map((f, i) => [f, A[i]]).filter(([f]) => !f.made).sort((a, b) => a[0].src - b[0].src);
    const steps = [];
    for (let i = 1; i < bySrc.length; i++) steps.push(poseDist(bySrc[i - 1][1], bySrc[i][1]));
    steps.sort((a, b) => a - b);
    const typical = steps.length ? steps[Math.floor(steps.length / 2)] : 0.4;
    // Drawings are spaced evenly along the movement, so every natural step is about the same
    // size. A reordered pair that changes more than a normal step won't flow.
    const limit = Math.max(0.35, typical * 1.15);
    const flagged = [], pairs = [];
    for (let i = 0; i < fr.length - 1; i++) {
      const a = fr[i], b = fr[i + 1];
      const d = poseDist(A[i], A[i + 1]);
      const natural = !a.made && !b.made && rank.get(b.src) === rank.get(a.src) + 1;
      pairs.push({ i, d: +d.toFixed(2), natural });
      if (natural || take.accepted.has(`${a.id}-${b.id}`)) continue;
      // Next to an in-between, only flag what's still clearly jumpy, so one fix reads as a fix.
      if (d > (a.made || b.made ? limit * 1.5 : limit)) flagged.push(i);
    }
    return { flagged, pairs, limit: +limit.toFixed(2), typical: +typical.toFixed(2) };
  }

  function makeTake(cap) {
    const n = takes.filter((t) => t.kind === cap.kind).length + 1;
    const take = {
      name: cap.kind === 'pose' ? `Pose ${n}` : `Take ${n}`, kind: cap.kind, raw: cap.raw,
      frames: [], settings: { char: { clean: 0.35, feel: 'smooth' } }, accepted: new Set(),
      turns: {}, lengths: {}, // Rig mode: changes to every frame
      mode: 'animate', tool: 'turn',
      sel: 'foreArmL', current: 0, version: 1, open: true,
    };
    const keys = cap.keys.filter((i) => !cap.dropped.has(i));
    const gaps = keys.slice(1).map((k, i) => (k - keys[i]) / RATE);
    const typical = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0.25;
    take.frames = keys.map((src, i) => ({
      id: nextFrameId++, src, made: false, edits: {}, stretch: {}, dur: Math.max(1 / RATE, i < gaps.length ? gaps[i] : typical),
    }));
    return take;
  }

  // ---------- capture ----------
  function startPose() {
    if (countdown) return;
    let k = 3;
    const el = $('capCount');
    const num = $('capCountNum');
    const tick = () => {
      num.textContent = k;
      el.classList.remove('beat');
      void el.offsetWidth;
      el.classList.add('beat');
    };
    el.classList.remove('hidden');
    tick();
    countdown = setInterval(() => {
      k -= 1;
      if (k > 0) {
        tick();
        return;
      }
      clearInterval(countdown);
      countdown = null;
      el.classList.add('hidden');
      renderBar();
      flash();
      landTake({ kind: 'pose', raw: [rig.getPose()], keys: [0], dropped: new Set() });
    }, 800);
    renderBar();
  }
  function startMotion() {
    rec = { t0: performance.now(), samples: [] };
    document.body.classList.add('take-recording');
    $('recChip').classList.remove('hidden');
    renderBar();
  }
  function stopMotion() {
    const r = rec;
    rec = null;
    document.body.classList.remove('take-recording');
    $('recChip').classList.add('hidden');
    renderBar();
    const T = r.samples.length ? r.samples[r.samples.length - 1].t : 0;
    if (T < MIN_SECONDS) {
      toast('Too short. Hold the button for at least a second of movement.', 3000);
      renderBar();
      return;
    }
    // Resample to an even 30 per second.
    const raw = [];
    let j = 0;
    for (let k = 0; k <= Math.floor(T * RATE); k++) {
      const t = k / RATE;
      while (j < r.samples.length - 2 && r.samples[j + 1].t < t) j++;
      const a = r.samples[j], b = r.samples[Math.min(j + 1, r.samples.length - 1)];
      const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
      raw.push(lerpPose(a.pose, b.pose, u));
    }
    flash();
    const count = clamp(Math.round(T * 2.2), 6, 20);
    landTake({ kind: 'motion', raw, count, keys: pickKeys(raw, count), dropped: new Set(), seconds: T });
  }
  function flash() {
    const f = $('captureFlash');
    f.classList.remove('hidden');
    f.style.animation = 'none';
    void f.offsetWidth;
    f.style.animation = '';
  }

  // ---------- capture bar ----------
  // Two states: idle (camera off: start it, or try the demo) and live (Pose / Motion, the
  // shutter, and a status light that says whether you're being tracked).
  function renderBar() {
    const bar = $('capBar');
    for (const b of bar.querySelectorAll('[data-mode]')) {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
      b.disabled = !!rec || !!countdown;
    }
    bar.classList.toggle('recording', !!rec);
    bar.classList.toggle('counting', !!countdown);
    bar.classList.toggle('motion', mode === 'motion');
    $('capShutter').dataset.tip = rec ? 'Stop recording' : mode === 'pose' ? 'Capture a pose after a 3-second countdown' : 'Start recording (tap again to stop)';
    $('capShutter').setAttribute('aria-label', rec ? 'Stop recording' : mode === 'pose' ? 'Capture a pose' : 'Start recording');
    $('capInfo').textContent = rec ? 'Recording… tap to stop' : countdown ? 'Get into your pose' : mode === 'pose' ? 'Tap, then hold your pose' : `Tap to record, up to ${MAX_SECONDS} s`;
  }
  let lastStatus = '';
  function renderStatus() {
    const st = status?.() || { live: isLive(), ok: true, label: 'Tracking' };
    const key = `${st.live}|${st.ok}|${st.label}`;
    if (key === lastStatus) return;
    lastStatus = key;
    const bar = $('capBar');
    bar.classList.toggle('idle', !st.live);
    $('capStatus').classList.toggle('warn', !st.ok);
    $('capStatusText').textContent = st.label;
    if (st.live && !sheet && !panel) hints?.show('capture', $('capBar'), '<b>Pose</b> catches one drawing after a 3-second countdown.<br><b>Motion</b> records up to 10 seconds of you moving.', 'above');
  }
  $('capBar').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m && !rec && !countdown) {
      mode = m.dataset.mode;
      renderBar();
    }
  });
  $('capShutter').addEventListener('click', () => {
    if (rec) return stopMotion();
    if (countdown) return;
    mode === 'pose' ? startPose() : startMotion();
  });
  $('capStartCam').addEventListener('click', () => onStartCamera?.());
  $('capStartDemo').addEventListener('click', () => onStartDemo?.());
  $('capStop').addEventListener('click', () => {
    if (rec || countdown) return;
    camOpen = false;
    onStopLive?.();
  });
  renderBar();

  // ---------- arrival sheet ----------
  const thumbCache = new Map(); // raw sample → thumbnail, for the arrival strip
  function rawThumb(raw, i, big) {
    const key = `${raw.length}:${i}:${big ? 1 : 0}`;
    if (!thumbCache.has(key)) {
      const c = document.createElement('canvas');
      c.width = big ? 480 : 180;
      c.height = big ? 336 : 126;
      renderPose(c.getContext('2d'), c.width, c.height, raw[i], { mul: 1.1, which: 'thumb' });
      thumbCache.set(key, c);
    }
    return thumbCache.get(key);
  }
  function openSheet(cap) {
    sheet = cap;
    thumbCache.clear();
    renderSheet();
    syncVisibility();
  }
  function renderSheet() {
    const el = $('arrive');
    if (!sheet) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const s = sheet;
    const kept = s.keys.filter((i) => !s.dropped.has(i)).length;
    const title = s.kind === 'pose' ? 'Pose captured' : `Motion captured · ${s.seconds.toFixed(1)} s`;
    const sub = s.kind === 'pose'
      ? 'Keep it as a drawing in Layers, or rig it to tweak the pose.'
      : `We picked ${kept} drawings where you move the most. Tap one to leave it out.`;
    el.innerHTML = `
      <header class="ar-head">
        <div class="ar-titles"><div class="ar-title">${title}</div><div class="ar-sub">${sub}</div></div>
        ${s.kind === 'motion' ? `<button class="ar-play ${s.playing ? 'on' : ''}" data-act="preview" aria-pressed="${!!s.playing}" data-tip="Play the drawings you picked on the canvas">${icon(s.playing ? I.pause : I.play, 14)}<span>${s.playing ? 'Pause' : 'Preview'}</span></button>` : ''}
      </header>
      <div class="ar-strip-wrap"><div class="ar-strip ${s.kind === 'pose' ? 'single' : ''}" id="arStrip"></div></div>
      ${s.kind === 'motion' ? `
      <div class="ar-count">
        <span>Few</span>
        <input type="range" id="arCount" min="4" max="24" step="1" value="${s.count}" aria-label="How many drawings" data-tip="How many drawings to keep. More drawings follow your movement more closely.">
        <span>Many</span>
        <b>${kept} drawings</b>
      </div>` : ''}
      <footer class="ar-foot">
        <button class="btn" data-act="retake" data-tip="Throw this away and capture again">Retake</button>
        <span class="tl-spacer"></span>
        <button class="btn" data-act="rig" data-tip="Keep it and open the rig to tweak the pose">Rig it</button>
        <button class="btn primary" data-act="keep" data-tip="Add it to Layers as ${s.kind === 'pose' ? 'a drawing' : 'frames'}">Keep</button>
      </footer>`;
    const strip = el.querySelector('#arStrip');
    s.keys.forEach((i, k) => {
      const b = document.createElement('button');
      const out = s.dropped.has(i);
      b.className = 'ar-frame' + (out ? ' dropped' : '');
      b.dataset.i = i;
      if (s.kind === 'motion') {
        b.dataset.tip = out ? 'Left out. Tap to bring it back' : `Drawing ${k + 1}. Tap to leave it out`;
        b.setAttribute('aria-pressed', String(!out));
      } else b.setAttribute('aria-label', 'Your pose');
      b.append(rawThumb(s.raw, i, s.kind === 'pose'));
      if (s.kind === 'motion') {
        const n = document.createElement('span');
        n.textContent = out ? 'Left out' : k + 1;
        b.append(n);
      }
      strip.append(b);
    });
    // Fade the edge when there are more drawings than fit, so it's clear the strip scrolls.
    const wrap = el.querySelector('.ar-strip-wrap');
    const fade = () => {
      wrap.classList.toggle('more-right', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4);
      wrap.classList.toggle('more-left', strip.scrollLeft > 4);
    };
    strip.addEventListener('scroll', fade);
    requestAnimationFrame(fade);
  }
  $('arrive').addEventListener('input', (e) => {
    if (e.target.id !== 'arCount' || !sheet) return;
    sheet.count = Number(e.target.value);
    sheet.keys = pickKeys(sheet.raw, sheet.count);
    sheet.dropped.clear();
    renderSheet();
  });
  $('arrive').addEventListener('click', (e) => {
    if (!sheet) return;
    const fr = e.target.closest('.ar-frame');
    if (fr && sheet.kind === 'motion') {
      const i = Number(fr.dataset.i);
      if (sheet.dropped.has(i)) sheet.dropped.delete(i);
      else if (sheet.keys.length - sheet.dropped.size > 1) sheet.dropped.add(i);
      else toast('Keep at least one drawing.', 1800);
      const left = $('arStrip').scrollLeft;
      renderSheet();
      $('arStrip').scrollLeft = left;
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'preview') {
      sheet.playing = !sheet.playing;
      sheet.t0 = performance.now();
      renderSheet();
      return;
    }
    if (act === 'retake') {
      sheet = null;
      renderSheet();
      syncVisibility();
      return;
    }
    const take = makeTake(sheet);
    takes.push(take);
    active = take;
    sheet = null;
    renderSheet();
    openPanel(act === 'rig' ? 'rig' : 'frames');
    toast(`${take.name} added to Layers.`, 2500);
  });

  // ---------- canvas-first dock ----------
  // Everything you need while editing sits around the canvas instead of in a panel:
  // a filmstrip along the bottom, a slim Feel strip on the right, a small command pill next to the
  // selected part (Turn / Stretch, Animate / Rig) and a status pill that says what a change reaches.
  const screenEl = $('screen');
  const mk = (cls, id) => {
    const d = document.createElement('div');
    d.className = `${cls} hidden`;
    d.id = id;
    screenEl.append(d);
    return d;
  };
  const film = mk('film', 'film');
  const feel = mk('feelstrip', 'feelStrip');
  const cmd = mk('cmd', 'cmdPill');
  const pill = mk('statuspill', 'statusPill');
  const land = mk('land-toast', 'landToast');
  let partsOpen = false; // the Parts list (the full part tree)
  let camOpen = false; // the capture bar
  let pathOn = false; // dotted path of the selected part on the canvas
  let original = false; // holding the Original button
  let playOnce = false; // replay a fresh take once
  let pathCache = null;
  let lastCtx = null;

  const WAVE_RAW = 'M0 32 C8 18 14 46 26 30 S42 16 52 34 S70 50 82 28 S102 12 112 32 S130 46 140 30';
  const WAVES = {
    snappy: 'M0 46 L16 46 C26 46 28 14 38 14 L72 14 L88 14 C98 14 100 46 110 46 L140 46',
    smooth: 'M0 30 C24 6 46 6 70 30 S116 54 140 30',
    floaty: 'M0 34 C30 32 48 10 76 12 S112 50 140 42',
  };
  // The grey line is what the camera caught, the black line is the result, and the dot travels along
  // it, so each tile shows the feel as movement.
  const waveSvg = (k) => `<svg class="fs-wave" viewBox="0 0 140 60" aria-hidden="true"><path class="raw" d="${WAVE_RAW}"/><path class="res" d="${WAVES[k]}"/><circle class="dot" r="6"><animateMotion dur="${k === 'snappy' ? 1.6 : 2.4}s" repeatCount="indefinite" path="${WAVES[k]}"/></circle></svg>`;

  function frameCanvas(t, i) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 64;
    c.getContext('2d').drawImage(frameThumb(t, i), 0, 0);
    return c;
  }

  function renderDock() {
    const t = active;
    const open = !!panel && !!t;
    for (const el of [film, feel, pill]) el.classList.toggle('hidden', !open);
    cmd.classList.toggle('hidden', !open || !ROTATE[t?.sel] || playing);
    $('btnCam')?.classList.toggle('active', camOpen && !open);
    if (!open) return;
    const multi = t.frames.length > 1;
    const J = new Set(jumps(t));
    const rigMode = t.mode === 'rig';
    const sel = t.sel;
    const s = settingOf(t, sel);

    // --- filmstrip (bottom) ---
    const prevScroll = $('fmStrip')?.scrollLeft || 0;
    const cells = [];
    t.frames.forEach((f, i) => {
      const tweaked = Object.keys(f.edits).length || Object.keys(f.stretch).length;
      const cur = i === t.current;
      cells.push(`<div class="fm-cell" data-cell="${i}">
        <button class="fm-frame ${cur ? 'current' : ''} ${f.made ? 'made' : ''} ${tweaked ? 'tweaked' : ''}" data-frame="${i}" aria-label="Frame ${i + 1}${cur ? ', selected' : ''}" aria-pressed="${cur}" data-tip="${cur ? 'Blue outline: the frame you are editing' : f.made ? 'An in-between made for you' : `Frame ${i + 1}`}${tweaked ? '. You changed this one' : ''}"><span data-thumb="${i}"></span><i class="fm-no">${i + 1}</i>${tweaked ? '<i class="fm-dot"></i>' : ''}</button>
        ${cur && multi ? `<button class="fm-del" data-act="del" aria-label="Remove this drawing" data-tip="Remove this drawing from the take">${icon('<path d="M6 6l12 12M18 6 6 18"/>', 12)}</button>` : ''}
      </div>`);
      if (J.has(i)) {
        cells.push(`<div class="fm-seam-wrap"><button class="fm-seam" data-act="between" data-i="${i}" aria-label="Add an in-between" data-tip="Jump: these two drawings are far apart. Tap to add a drawing between them"><svg width="16" height="44" viewBox="0 0 8 72" preserveAspectRatio="none" aria-hidden="true"><path d="M4 0L0 12L8 24L0 36L8 48L0 60L4 72" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg></button><button class="fm-leave" data-act="leave" data-i="${i}" aria-label="Leave the jump" data-tip="Keep the jump. Sometimes a snap is what you want">${icon('<path d="M5 12l5 5 9-10"/>', 12)}</button></div>`);
      }
    });
    const motion = t.kind === 'motion';
    film.innerHTML = `
      <div class="fm-meta">
        <b class="fm-name">${t.name}</b>
        <span class="fm-count" data-tip="How many drawings this take has${motion ? '. Fewer is looser, more follows you closely' : ''}">${t.frames.length} drawing${multi ? 's' : ''}${motion ? ` · ${totalTime(t).toFixed(1)} s` : ''}</span>
        ${motion ? '<button class="fm-step" data-act="fewer" aria-label="Fewer drawings" data-tip="Fewer drawings">&minus;</button><button class="fm-step" data-act="more" aria-label="More drawings" data-tip="More drawings">+</button>' : ''}
        ${J.size ? `<span class="fm-warn" data-tip="Drawings that won't flow are marked with a tear">${icon(I.jump, 13)}${J.size} to check</span>` : ''}
        <span class="fm-sp"></span>
        ${undoButtons(t)}
        <button class="fm-btn ${partsOpen ? 'on' : ''}" id="fmParts" data-act="parts" aria-pressed="${partsOpen}" data-tip="Pick any body part from a list, and see its settings">Parts</button>
        <button class="fm-btn done" data-act="close" data-tip="Back to the live character">Done</button>
      </div>
      <div class="fm-row">
        ${multi ? `<button class="fm-play ${playing ? 'on' : ''}" data-act="play" aria-label="${playing ? 'Pause' : 'Play'}" data-tip="${playing ? 'Pause' : 'Play the take on the canvas'}">${icon(playing ? I.pause : I.play, 18)}</button>` : ''}
        <div class="fm-strip" id="fmStrip">${cells.join('')}</div>
      </div>`;
    for (const slot of film.querySelectorAll('[data-thumb]')) slot.append(frameCanvas(t, Number(slot.dataset.thumb)));
    const strip = $('fmStrip');
    strip.scrollLeft = prevScroll;
    const curCell = strip.querySelector('.fm-frame.current')?.parentElement;
    if (curCell) {
      if (curCell.offsetLeft < strip.scrollLeft + 6) strip.scrollLeft = curCell.offsetLeft - 12;
      else if (curCell.offsetLeft + curCell.offsetWidth > strip.scrollLeft + strip.clientWidth - 6) strip.scrollLeft = curCell.offsetLeft + curCell.offsetWidth - strip.clientWidth + 12;
    }

    // --- feel strip (right) ---
    const tiles = Object.entries(FEELS).map(([k, f]) => `<button class="fs-tile ${s.feel === k ? 'on' : ''}" data-feel="${k}" aria-pressed="${s.feel === k}" data-tip="${f.hint}">${waveSvg(k)}<b>${f.label}</b></button>`).join('');
    feel.innerHTML = `
      <div class="fs-head" data-tip="Feel and clean-up apply to the part you picked. Tap another limb on the canvas to change it."><span class="tp-swatch" style="background:${NODE[sel].color}"></span>${NODE[sel].name}</div>
      ${multi ? `
      <div class="fs-title">Feel</div>
      ${tiles}
      <div class="fs-clean" data-tip="Removes the wobble the camera picked up"><label for="tpClean">Clean-up <span id="tpCleanVal">${Math.round(s.clean * 100)}%</span></label><input type="range" id="tpClean" min="0" max="100" step="1" value="${Math.round(s.clean * 100)}"></div>
      <button class="fs-btn ${pathOn ? 'on' : ''}" id="fsPath" data-act="path" aria-pressed="${pathOn}" data-tip="Show the path this part travels. Dots close together are slow, far apart are fast">${icon('<path d="M4 18c4-10 8 2 12-8"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/><circle cx="16" cy="10" r="1.4" fill="currentColor"/>', 18)}Path</button>` : ''}
      <button class="fs-btn" id="fsOriginal" data-tip="Press and hold to see the original capture, before any clean-up">${icon('<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>', 18)}Original</button>`;

    // --- command pill (next to the selected part) ---
    cmd.innerHTML = `
      <div class="cm-group" role="group" aria-label="Brush">
        <button data-tool="turn" class="${t.tool === 'turn' ? 'on' : ''}" aria-pressed="${t.tool === 'turn'}" data-tip="Turn the part around its joint (or drag the circle)" data-key="T">${icon(I.turn, 20)}<span>Turn</span></button>
        <button data-tool="stretch" class="${t.tool === 'stretch' ? 'on' : ''}" aria-pressed="${t.tool === 'stretch'}" data-tip="Make an arm or leg longer or shorter (or drag the diamond)" data-key="S">${icon(I.stretch, 20)}<span>Stretch</span></button>
      </div>
      <i class="cm-sep"></i>
      <div class="cm-group" role="group" aria-label="Where a change goes">
        <button data-mode="animate" class="${rigMode ? '' : 'on'}" aria-pressed="${!rigMode}" data-tip="Changes only the frame you're on (blue)" data-key="A">${icon(I.one, 20)}<span>Animate</span></button>
        <button data-mode="rig" class="rig ${rigMode ? 'on' : ''}" aria-pressed="${rigMode}" data-tip="Changes every frame of the take (amber)" data-key="R">${icon(I.rig, 20)}<span>Rig</span></button>
      </div>`;

    // --- status pill (above the filmstrip) ---
    const pb = partBones(sel);
    const cf = t.frames[t.current];
    const edited = cf && pb.some((b) => b in cf.edits || b in cf.stretch);
    const rigged = pb.some((b) => b in t.turns || b in t.lengths);
    pill.classList.toggle('rig', rigMode);
    pill.innerHTML = original
      ? '<i class="sp-dot"></i><span>Showing the original capture</span>'
      : `<i class="sp-dot"></i><span>${NODE[sel].name} · ${rigMode ? 'every frame' : 'this frame'}</span>
        ${multi && edited ? '<button class="pl-apply" data-act="applyall" data-tip="Make this change on every frame of the take">Apply to all frames</button>' : ''}
        ${edited ? '<button class="pl-reset" data-act="unbend" data-tip="Remove your turns and stretches for this part on this frame">Reset</button>' : ''}
        ${rigged ? '<button class="pl-reset amber" data-act="unrig" data-tip="Remove changes made to every frame for this part">Reset all frames</button>' : ''}`;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTips(false), 450);
  }

  // Apply this frame's changes for the selected part to every frame (Animate becomes Rig).
  function applyAll(t) {
    remember(t);
    const f = t.frames[t.current];
    for (const b of partBones(t.sel)) {
      if (b in f.edits) {
        t.turns[b] = (t.turns[b] || 0) + f.edits[b];
        delete f.edits[b];
      }
      if (b in f.stretch) {
        t.lengths[b] = (t.lengths[b] ?? 1) * f.stretch[b];
        delete f.stretch[b];
      }
    }
    t.version++;
    renderPanel();
    toast('Applied to every frame.', 1800);
  }

  // More or fewer drawings: pick them again along the movement.
  function repick(t, n) {
    remember(t);
    const keys = pickKeys(t.raw, n);
    const gaps = keys.slice(1).map((k, i) => (k - keys[i]) / RATE);
    const typical = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0.25;
    t.frames = keys.map((src, i) => ({ id: nextFrameId++, src, made: false, edits: {}, stretch: {}, dur: Math.max(1 / RATE, i < gaps.length ? gaps[i] : typical) }));
    t.accepted = new Set();
    t.current = Math.min(t.current, t.frames.length - 1);
    t.version++;
  }
  function removeFrame(t) {
    if (t.frames.length < 2) return toast('A take needs at least one drawing.', 1800);
    const gone = new Set([t.frames[t.current].id]);
    for (const f of t.frames) if (f.made && f.between.some((id) => gone.has(id))) gone.add(f.id);
    if (t.frames.length - gone.size < 1) return toast('A take needs at least one drawing.', 1800);
    remember(t);
    const extra = t.frames.filter((f) => gone.has(f.id)).reduce((a, f) => a + f.dur, 0);
    const i = t.current;
    t.frames = t.frames.filter((f) => !gone.has(f.id));
    t.frames[Math.max(0, Math.min(i - 1, t.frames.length - 1))].dur += extra;
    t.current = Math.max(0, Math.min(i, t.frames.length - 1));
    t.version++;
    renderPanel();
  }
  function dockAction(act, t) {
    if (act === 'parts' || act === 'partsclose') {
      partsOpen = act === 'parts' ? !partsOpen : false;
      syncVisibility();
      renderPanel();
    } else if (act === 'applyall') applyAll(t);
    else if (act === 'path') {
      pathOn = !pathOn;
      renderPanel();
    } else if (act === 'del') removeFrame(t);
    else if (act === 'more' || act === 'fewer') {
      const n = t.frames.filter((f) => !f.made).length;
      const n2 = clamp(n + (act === 'more' ? 2 : -2), 4, 24);
      if (n2 === n) return toast(act === 'more' ? 'That is the most drawings.' : 'That is the fewest drawings.', 1500);
      const changed = t.frames.some((f) => f.made || Object.keys(f.edits).length || Object.keys(f.stretch).length);
      repick(t, n2);
      renderPanel();
      toast(changed ? 'Drawings picked again. Undo brings your frame changes back.' : `${n2} drawings`, changed ? 2600 : 1200);
    }
  }

  // The take arrives straight in the filmstrip. A toast offers Undo, and a fresh motion plays once.
  let landTimer = null;
  function landTake(cap) {
    thumbCache.clear();
    const take = makeTake(cap);
    takes.push(take);
    active = take;
    partsOpen = false;
    openPanel('rig');
    if (take.frames.length > 1) {
      playing = true;
      playOnce = true;
      playT0 = performance.now();
      renderPanel();
    }
    land.innerHTML = `<span>${take.name} added</span><button data-act="landundo" data-tip="Remove it and capture again">Undo</button>`;
    land.dataset.take = String(takes.indexOf(take));
    land.classList.remove('hidden');
    clearTimeout(landTimer);
    landTimer = setTimeout(() => land.classList.add('hidden'), 7000);
  }
  land.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="landundo"]')) return;
    const t = takes[Number(land.dataset.take)];
    land.classList.add('hidden');
    if (!t) return;
    takes.splice(takes.indexOf(t), 1);
    active = takes[takes.length - 1] || null;
    playing = false;
    playOnce = false;
    if (!active) closePanel();
    else {
      renderPanel();
      syncVisibility();
    }
    toast(`${t.name} removed`, 1400);
  });

  // Hold Original to see the capture as the camera caught it.
  feel.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#fsOriginal') || !active) return;
    original = true;
    pill.innerHTML = '<i class="sp-dot"></i><span>Showing the original capture</span>';
    document.body.classList.add('show-original');
  });
  const endOriginal = () => {
    if (!original) return;
    original = false;
    document.body.classList.remove('show-original');
    renderDock();
  };
  addEventListener('pointerup', endOriginal, true);
  addEventListener('pointercancel', endOriginal, true);

  // Drag a drawing sideways in the filmstrip to change the order.
  let fdrag = null;
  film.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.fm-cell');
    if (!cell || e.target.closest('.fm-del') || !active || active.frames.length < 2) return;
    fdrag = { from: Number(cell.dataset.cell), to: Number(cell.dataset.cell), x0: e.clientX, moved: false, cell, id: e.pointerId };
  });
  film.addEventListener('pointermove', (e) => {
    const d = fdrag;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 8) return;
    const strip = $('fmStrip');
    if (!d.moved) {
      d.moved = true;
      playing = false;
      try { d.cell.setPointerCapture(d.id); } catch {}
      strip.classList.add('reordering');
      d.cells = [...strip.querySelectorAll('.fm-cell')];
      d.k = scaleOf(d.cell);
      d.w = d.cell.getBoundingClientRect().width + 8 * d.k;
      d.mids = d.cells.map((x) => {
        const q = x.getBoundingClientRect();
        return q.left + q.width / 2;
      });
      d.cell.classList.add('dragging');
    }
    d.cell.style.transform = `translateX(${(e.clientX - d.x0) / d.k}px) scale(1.05)`;
    let to = 0;
    d.mids.forEach((m, k) => {
      if (k !== d.from && e.clientX > m) to++;
    });
    d.to = to;
    d.cells.forEach((x, k) => {
      if (k === d.from) return;
      let shift = 0;
      if (d.from < d.to && k > d.from && k <= d.to) shift = -1;
      if (d.to < d.from && k >= d.to && k < d.from) shift = 1;
      x.style.transform = shift ? `translateX(${(shift * d.w) / d.k}px)` : '';
    });
  });
  const endFilmDrag = () => {
    const d = fdrag;
    if (!d) return;
    fdrag = null;
    if (d.moved && d.to !== d.from) {
      const t = active;
      remember(t);
      const [f] = t.frames.splice(d.from, 1);
      t.frames.splice(d.to, 0, f);
      t.current = d.to;
      t.version++;
      const J = jumps(t);
      if (J.length) toast(`Moved. ${J.length} spot${J.length > 1 ? 's' : ''} now won't flow, marked with a tear.`, 2600);
    }
    if (d.moved) renderPanel();
  };
  film.addEventListener('pointerup', endFilmDrag);
  film.addEventListener('pointercancel', endFilmDrag);

  // ---------- small tips that appear by themselves ----------
  // Each shows once (up to three at a time) and fades away; the ? button shows every one again.
  let tipTimer = null;
  const bubbles = new Map();
  const seenAuto = (id) => {
    try { return localStorage.getItem(`rig.auto.${id}`) === '1'; } catch { return false; }
  };
  const markAuto = (id) => {
    try { localStorage.setItem(`rig.auto.${id}`, '1'); } catch {}
  };
  function rectOf(el) {
    if (!el || !el.getClientRects().length) return null;
    const sr = screenEl.getBoundingClientRect();
    const k = sr.width / screenEl.offsetWidth || 1;
    const r = el.getBoundingClientRect();
    return { l: (r.left - sr.left) / k, t: (r.top - sr.top) / k, r: (r.right - sr.left) / k, b: (r.bottom - sr.top) / k };
  }
  function handleRect(which) {
    const h = api.handles?.[which];
    if (!h || !lastCtx) return null;
    const c = lastCtx.canvas;
    const cr = c.getBoundingClientRect();
    const sr = screenEl.getBoundingClientRect();
    const k = sr.width / screenEl.offsetWidth || 1;
    const x = (cr.left - sr.left + (h.x / c.width) * cr.width) / k;
    const y = (cr.top - sr.top + (h.y / c.height) * cr.height) / k;
    const rr = (h.r / c.width) * (cr.width / k);
    return { l: x - rr, t: y - rr, r: x + rr, b: y + rr };
  }
  const AUTO = [
    { id: 'cam', side: 'below', text: 'Tap to open the camera and capture', at: () => (panel ? null : rectOf($('btnCam'))) },
    { id: 'cmd', side: 'below', text: 'Turn or Stretch. Animate = this frame only, Rig = every frame', at: () => rectOf(cmd) },
    { id: 'turnh', side: 'left', text: 'Drag the circle to turn', at: () => handleRect('turn') },
    { id: 'stretchh', side: 'right', text: 'Drag the diamond to stretch', at: () => handleRect('stretch') },
    { id: 'cur', side: 'above', text: 'Blue outline: the frame you are editing', at: () => rectOf(film.querySelector('.fm-frame.current')) },
    { id: 'seam', side: 'above', text: 'Jump: tap the tear to add an in-between', at: () => rectOf(film.querySelector('.fm-seam')) },
    { id: 'count', side: 'above', text: 'More or fewer drawings', at: () => rectOf(film.querySelector('.fm-step')) },
    { id: 'parts', side: 'above', text: 'Pick any body part from a list', at: () => rectOf($('fmParts')) },
    { id: 'feel', side: 'left', text: 'Feel: pick by watching. Each tile moves like your take', at: () => rectOf(feel.querySelector('.fs-tile.on')) },
    { id: 'clean', side: 'left', text: 'Clean-up removes camera wobble', at: () => rectOf(feel.querySelector('.fs-clean')) },
    { id: 'path', side: 'left', text: 'Path: close dots are slow, far apart are fast', at: () => rectOf($('fsPath')) },
    { id: 'orig', side: 'left', text: 'Hold to see the original capture', at: () => rectOf($('fsOriginal')) },
    { id: 'apply', side: 'above', text: 'Make this change on every frame', at: () => rectOf(pill.querySelector('.pl-apply')) },
  ];
  function clearBubbles() {
    for (const b of bubbles.values()) {
      b.el.remove();
      clearTimeout(b.timer);
    }
    bubbles.clear();
  }
  function showTips(force = false) {
    if (rec || countdown || sheet) return;
    if (force) clearBubbles();
    let shown = 0;
    for (const a of AUTO) {
      if (bubbles.has(a.id)) continue;
      if (!force && (seenAuto(a.id) || shown >= 3)) continue;
      const r = a.at();
      if (!r) continue;
      const el = document.createElement('div');
      el.className = `auto-tip ${a.side}`;
      el.textContent = a.text;
      screenEl.append(el);
      const w = el.offsetWidth, h = el.offsetHeight;
      const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
      let x = cx - w / 2, y = cy - h / 2;
      if (a.side === 'above') y = r.t - h - 11;
      else if (a.side === 'below') y = r.b + 11;
      else if (a.side === 'left') x = r.l - w - 12;
      else x = r.r + 12;
      el.style.left = `${clamp(x, 8, screenEl.offsetWidth - w - 8)}px`;
      el.style.top = `${clamp(y, 8, screenEl.offsetHeight - h - 8)}px`;
      const timer = setTimeout(() => {
        el.remove();
        bubbles.delete(a.id);
      }, force ? 12000 : 8000);
      bubbles.set(a.id, { el, timer });
      if (!force) markAuto(a.id);
      shown++;
    }
  }
  $('btnTips')?.addEventListener('click', () => showTips(true));
  $('btnCam')?.addEventListener('click', () => {
    if (panel) {
      closePanel();
      camOpen = true;
    } else camOpen = !camOpen;
    renderDock();
  });
  setTimeout(() => showTips(false), 1400);

  // Put the command pill next to the selected part, and keep it out of the way while dragging.
  let pillAt = '';
  function placeCmd(ctx, P) {
    const spec = active && ROTATE[active.sel];
    if (!spec || cmd.classList.contains('hidden')) return;
    const A = P[spec.pivot], B = P[spec.tip];
    if (!A || !B) return;
    const c = ctx.canvas;
    const cr = c.getBoundingClientRect();
    const sr = screenEl.getBoundingClientRect();
    const k = sr.width / screenEl.offsetWidth || 1;
    const sx = (p) => (cr.left - sr.left + (p.x / c.width) * cr.width) / k;
    const sy = (p) => (cr.top - sr.top + (p.y / c.height) * cr.height) / k;
    const mx = (sx(A) + sx(B)) / 2, my = (sy(A) + sy(B)) / 2;
    const w = cmd.offsetWidth, h = cmd.offsetHeight;
    const limit = screenEl.offsetWidth - 108;
    let x = mx + 58;
    if (x + w > limit) x = mx - 58 - w;
    x = clamp(x, 76, limit - w);
    const y = clamp(my - h / 2, 58, screenEl.offsetHeight - 150 - h);
    const key = `${Math.round(x)},${Math.round(y)}`;
    if (key === pillAt) return;
    pillAt = key;
    cmd.style.left = `${x}px`;
    cmd.style.top = `${y}px`;
  }

  // ---------- the panel (now the Parts list) ----------
  function openPanel() {
    panel = 'rig';
    playing = false;
    preview.t0 = performance.now();
    renderPanel();
    syncVisibility();
  }
  function closePanel() {
    panel = null;
    partsOpen = false;
    camOpen = true;
    playing = false;
    playOnce = false;
    clearBubbles();
    renderPanel();
    syncVisibility();
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTips(false), 500);
  }
  function syncVisibility() {
    const open = !!panel && !!active;
    document.body.classList.toggle('take-open', open);
    $('takePanel').classList.toggle('hidden', !open || !partsOpen);
    $('partPreview').classList.add('hidden');
    onOpenChange?.(open);
    renderLayersRows();
  }

  function frameThumb(take, i) {
    const f = take.frames[i];
    if (f.thumbVer !== take.version || !f.thumb) {
      f.thumb = f.thumb || document.createElement('canvas');
      f.thumb.width = 96;
      f.thumb.height = 64;
      const g = f.thumb.getContext('2d');
      g.clearRect(0, 0, 96, 64);
      renderPose(g, 96, 64, posesFor(take, 'after')[i], { mul: 1.15, which: 'thumb' });
      f.thumbVer = take.version;
    }
    return f.thumb;
  }
  const icon = (d, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
    jump: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    rig: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7m0 0-3 6m3-6 3 6M6.5 10l5.5-1.5 5.5 1.5"/>',
    brush: '<path d="M19.5 4.5 10 14l-.9 2.4L11.5 15.5 21 6z"/><path d="M8.2 15.8c-2.4.2-2.6 2.6-4.2 3.6 2.8.6 5.6-.2 5.6-2.4z"/>',
    undo: '<path d="M9 7 5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>',
    redo: '<path d="m15 7 4 4-4 4"/><path d="M19 11h-9a5 5 0 0 0 0 10h2"/>',
    one: '<rect x="4.5" y="5" width="15" height="14" rx="2.5"/>',
    turn: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
    stretch: '<path d="M4 12h16"/><path d="M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
  };

  function renderPanel() {
    const el = $('takePanel');
    if (!panel || !active) {
      el.innerHTML = '';
      renderDock();
      return;
    }
    renderRigMode(el);
    renderDock();
  }

  function renderFramesMode(el) {
    const t = active;
    const J = new Set(jumps(t));
    const rows = [];
    t.frames.forEach((f, i) => {
      const tweaked = Object.keys(f.edits).length || Object.keys(f.stretch).length;
      rows.push(`<li class="tp-frame ${i === t.current ? 'current' : ''} ${f.made ? 'made' : ''}" data-i="${i}" aria-label="Frame ${i + 1}">
        <span class="tp-thumb" data-thumb="${i}"></span>
        <span class="tp-fname">${f.made ? 'In-between' : `Frame ${i + 1}`}<small>${f.made ? 'made for you' : `at ${(f.src / RATE).toFixed(1)} s`}</small></span>
        ${tweaked ? '<span class="tp-badge" data-tip="You changed this frame in the rig">tweaked</span>' : ''}
        <span class="tp-grip" data-tip="Drag to change the order">${icon(I.grip)}</span>
      </li>`);
      if (J.has(i)) {
        rows.push(`<li class="tp-jump" data-pair="${i}">
          <button class="tp-jump-text" data-act="seejump" data-i="${i}" data-tip="Show this spot on the canvas">${icon(I.jump, 14)}<span>Big jump from ${i + 1} to ${i + 2}. It won't flow smoothly.</span></button>
          <div class="tp-jump-acts">
            <button data-act="between" data-i="${i}" data-tip="Add a drawing halfway between the two">Add in-between</button>
            <button data-act="leave" data-i="${i}" data-tip="Keep the jump. Sometimes a snap is what you want">Leave it</button>
          </div>
        </li>`);
      }
    });
    const others = takes.filter((x) => x !== t).map((x) => `<button class="tp-other" data-take="${takes.indexOf(x)}" data-tip="Open ${x.name}">${icon(I.chev, 14)}<span>${x.name}<small>${x.frames.length} frame${x.frames.length > 1 ? 's' : ''}</small></span></button>`).join('');
    el.classList.remove('rig-mode');
    el.innerHTML = `
      <header class="tp-head"><span class="tp-title">Layers</span>${undoButtons(t)}<button class="tp-done" data-act="close" data-tip="Back to the live character">Done</button></header>
      <div class="tp-group">
        <div class="tp-grow">
          <span class="tp-gname">${t.name}<small>${t.frames.length} frame${t.frames.length > 1 ? 's' : ''}${t.kind === 'motion' ? ` · ${totalTime(t).toFixed(1)} s` : ''}</small></span>
          ${t.frames.length > 1 ? `<button class="tp-icon ${playing ? 'on' : ''}" data-act="play" aria-label="${playing ? 'Pause' : 'Play'}" data-tip="${playing ? 'Pause' : 'Play the take on the canvas'}">${icon(playing ? I.pause : I.play)}</button>` : ''}
          <button class="tp-rig" data-act="rig" data-tip="Open the rig: bones, turn, stretch, clean-up and feel">${icon(I.rig)}Rig</button>
        </div>
        ${J.size ? `<p class="tp-note">${icon(I.jump, 13)} ${J.size} spot${J.size > 1 ? 's' : ''} won't flow. Fix or leave ${J.size > 1 ? 'them' : 'it'}, it's your call.</p>` : t.frames.length > 1 ? '<p class="tp-note quiet">Drag a frame by its handle to change the order.</p>' : ''}
        <ol class="tp-frames" id="tpFrames">${rows.join('')}</ol>
      </div>
      ${others}
      <div class="tp-layer"><span class="layer-thumb rig-thumb"></span><span>Motion Rig<small>live character</small></span></div>
      <div class="tp-layer"><span class="layer-thumb"></span><span>Layer 1</span></div>
      <div class="tp-layer"><span class="layer-thumb bg-thumb" style='background-image:${$('bgThumb')?.style.backgroundImage || 'none'}'></span><span>Playground<small>background image</small></span></div>`;
    for (const slot of el.querySelectorAll('[data-thumb]')) slot.append(frameThumb(t, Number(slot.dataset.thumb)));
    playRow = -1;
    if (t.frames.length > 1) {
      // Point at the list from the canvas side, so the hint never covers a frame.
      const row = el.querySelector('.tp-frame');
      requestAnimationFrame(() => row && hints?.show('frames', row, 'Drag a frame by its <b>handle</b> to change the order. If two frames stop flowing, an orange note appears between them.', 'left'));
    }
  }

  function undoButtons(t) {
    const u = t.hist?.undo.length, r = t.hist?.redo.length;
    return `<button class="tp-icon small" data-act="undo" ${u ? '' : 'disabled'} aria-label="Undo" data-tip="Undo" data-key="Ctrl Z">${icon(I.undo, 15)}</button>
      <button class="tp-icon small" data-act="redo" ${r ? '' : 'disabled'} aria-label="Redo" data-tip="Redo" data-key="Ctrl Shift Z">${icon(I.redo, 15)}</button>`;
  }

  function renderRigMode(el) {
    const t = active;
    const sel = t.sel;
    const s = settingOf(t, sel);
    const own = !!t.settings[sel];
    const rigMode = t.mode === 'rig';
    // The part tree: groups open when you pick something inside them (or tap their arrow).
    t.openGroups = t.openGroups || new Set();
    const rows = [];
    const walk = (id, depth) => {
      const n = NODE[id];
      const group = id !== 'char' && n.kids.length > 0;
      const open = id === 'char' || t.openGroups.has(id) || isInside(sel, id);
      rows.push(`<div class="tp-prow" style="padding-left:${6 + depth * 16}px">
        ${group ? `<button class="tp-chev ${open ? 'open' : ''}" data-toggle="${id}" aria-label="${open ? 'Close' : 'Open'} ${n.name}" aria-expanded="${open}">${icon(I.chev, 13)}</button>` : '<span class="tp-chev-gap"></span>'}
        <button class="tp-part ${id === sel ? 'sel' : ''} ${isInside(sel, id) && id !== sel && id !== 'char' ? 'holds' : ''}" data-part="${id}" aria-pressed="${id === sel}">
          <span class="tp-swatch" style="background:${n.color}"></span><span class="tp-pname">${n.name}</span>${t.settings[id] && id !== 'char' ? '<span class="tp-own" data-tip="Has its own clean-up or feel"></span>' : ''}
        </button>
      </div>`);
      if (open) n.kids.forEach((k) => walk(k, depth + 1));
    };
    walk('char', 0);
    const multi = t.frames.length > 1;
    const inherit = sel === 'char'
      ? 'Every part starts from these settings.'
      : own ? `Has its own clean-up and feel.` : `Clean-up and feel follow ${NODE[s.from].name}.`;
    const feelCards = Object.entries(FEELS).map(([k, f]) => `
      <button class="tp-feel ${s.feel === k ? 'on' : ''}" data-feel="${k}" aria-pressed="${s.feel === k}" data-tip="${f.hint}">
        <span class="tp-feel-icon">${icon(f.icon, 26)}</span><b>${f.label}</b>
      </button>`).join('');
    const strip = t.frames.map((f, i) => `<button class="tp-mini ${i === t.current ? 'current' : ''}" data-frame="${i}" aria-label="Frame ${i + 1}" data-tip="Frame ${i + 1}${f.made ? ' (in-between)' : ''}"><span data-thumb="${i}"></span></button>`).join('');
    const pb = partBones(sel);
    const cf = t.frames[t.current];
    const edited = cf && pb.some((b) => b in cf.edits || b in cf.stretch);
    const rigged = pb.some((b) => b in t.turns || b in t.lengths);
    const canTurn = !!ROTATE[sel], canStretch = !!STRETCH[sel];
    const name = `<b>${NODE[sel].name}</b>`;
    const where = rigMode ? 'on every frame' : 'on this frame';
    const help = !canTurn
      ? 'Tap a bone on the character to pick a part.'
      : t.tool === 'stretch'
        ? canStretch
          ? `Drag along ${name} to make it longer or shorter ${where}.`
          : `${NODE[sel].name} can't stretch. Pick an arm or a leg, or use Turn.`
        : `Drag anywhere on the canvas to turn ${name} ${where}.`;
    el.classList.toggle('rig-mode', rigMode);
    el.innerHTML = `
      <header class="tp-head"><span class="tp-title">Parts</span><button class="tp-done" data-act="partsclose" data-tip="Close the list">Done</button></header>
      <p class="tp-help">Pick a part here, or tap it on the canvas. Settings pass down from the part above it.</p>
      <div class="tp-tree">${rows.join('')}</div>
      <section class="tp-sec">
        <div class="tp-selname"><span class="tp-swatch" style="background:${NODE[sel].color}"></span>${NODE[sel].name}</div>
        <div class="tp-inherit">${inherit}${own && sel !== 'char' ? ' <button data-act="reset" data-tip="Use the same clean-up and feel as the rest">Match the rest</button>' : ''}</div>
        ${edited ? `<button class="tp-link" data-act="unbend" data-tip="Remove your turns and stretches for this part on this frame">${icon(I.undo, 14)} Undo my changes on this frame</button>` : ''}
        ${rigged ? `<button class="tp-link amber" data-act="unrig" data-tip="Remove changes made to every frame for this part">${icon(I.undo, 14)} Reset ${NODE[sel].name} on every frame</button>` : ''}
      </section>`;
    $('ppName').textContent = NODE[sel].name;
    playRow = -1;
  }

  function setSetting(patch) {
    const t = active;
    remember(t);
    const cur = settingOf(t, t.sel);
    t.settings[t.sel] = { clean: cur.clean, feel: cur.feel, ...patch };
    t.version++;
  }

  // ---------- undo / redo (for everything you change in a take) ----------
  function snapshot(t) {
    return JSON.stringify({
      frames: t.frames.map(({ id, src, made, between, edits, stretch, dur }) => ({ id, src, made, between, edits, stretch, dur })),
      settings: t.settings, turns: t.turns, lengths: t.lengths, accepted: [...t.accepted], current: t.current,
    });
  }
  function restore(t, snap) {
    const d = JSON.parse(snap);
    const old = new Map(t.frames.map((f) => [f.id, f]));
    t.frames = d.frames.map((f) => ({ ...f, thumb: old.get(f.id)?.thumb || null, thumbVer: -1 }));
    Object.assign(t, { settings: d.settings, turns: d.turns, lengths: d.lengths, accepted: new Set(d.accepted) });
    t.current = Math.min(d.current, t.frames.length - 1);
    t.version++;
  }
  // Call before changing a take.
  function remember(t) {
    t.hist = t.hist || { undo: [], redo: [] };
    t.hist.undo.push(snapshot(t));
    if (t.hist.undo.length > 80) t.hist.undo.shift();
    t.hist.redo.length = 0;
  }
  function step(dir) {
    const t = active;
    const from = dir === 'undo' ? t?.hist?.undo : t?.hist?.redo;
    if (!from?.length) return false;
    const to = dir === 'undo' ? t.hist.redo : t.hist.undo;
    to.push(snapshot(t));
    restore(t, from.pop());
    playing = false;
    renderPanel();
    toast(dir === 'undo' ? 'Undone' : 'Redone', 900);
    return true;
  }

  function setMode(m) {
    const t = active;
    if (!t || t.mode === m) return;
    t.mode = m;
    renderPanel();
    toast(m === 'rig' ? 'Rig mode: changes reach every frame (amber bones).' : 'Animate mode: changes only this frame (blue bones).', 2200);
  }
  function setTool(tool) {
    const t = active;
    if (!t || t.tool === tool) return;
    t.tool = tool;
    renderPanel();
  }

  // Panel clicks
  const onPanelClick = (e) => {
    const t = active;
    if (!t) return;
    const b = e.target.closest('button');
    if (!b) {
      const row = e.target.closest('.tp-frame');
      if (row && !dragState?.moved) {
        t.current = Number(row.dataset.i);
        playing = false;
        renderPanel();
      }
      return;
    }
    if (b.disabled) return;
    const act = b.dataset.act;
    if (b.dataset.part) {
      t.sel = b.dataset.part;
      renderPanel();
      return;
    }
    if (b.dataset.toggle) {
      const id = b.dataset.toggle;
      t.openGroups = t.openGroups || new Set();
      if (t.openGroups.has(id) || isInside(t.sel, id)) {
        t.openGroups.delete(id);
        if (isInside(t.sel, id)) t.sel = id; // closing the group you're in selects the group
      } else t.openGroups.add(id);
      renderPanel();
      return;
    }
    if (b.dataset.feel) {
      setSetting({ feel: b.dataset.feel });
      renderPanel();
      return;
    }
    if (b.dataset.frame) {
      t.current = Number(b.dataset.frame);
      playing = false;
      renderPanel();
      return;
    }
    if (b.dataset.take) {
      active = takes[Number(b.dataset.take)];
      playing = false;
      renderPanel();
      return;
    }
    if (b.dataset.mode) return setMode(b.dataset.mode);
    if (b.dataset.tool) return setTool(b.dataset.tool);
    if (['parts', 'partsclose', 'applyall', 'path', 'del', 'more', 'fewer'].includes(act)) return dockAction(act, t);
    if (act === 'close') closePanel();
    else if (act === 'undo') step('undo');
    else if (act === 'redo') step('redo');
    else if (act === 'rig') openPanel('rig');
    else if (act === 'frames') openPanel('frames');
    else if (act === 'play') {
      playing = !playing;
      playT0 = performance.now() - t.frames.slice(0, t.current).reduce((a, f) => a + f.dur, 0) * 1000;
      renderPanel();
    } else if (act === 'reset') {
      remember(t);
      delete t.settings[t.sel];
      t.version++;
      renderPanel();
    } else if (act === 'unbend') {
      remember(t);
      const f = t.frames[t.current];
      for (const bone of partBones(t.sel)) {
        delete f.edits[bone];
        delete f.stretch[bone];
      }
      t.version++;
      renderPanel();
    } else if (act === 'unrig') {
      remember(t);
      for (const bone of partBones(t.sel)) {
        delete t.turns[bone];
        delete t.lengths[bone];
      }
      t.version++;
      renderPanel();
    } else if (act === 'seejump') {
      t.current = Number(b.dataset.i) + 1;
      playing = false;
      renderPanel();
    } else if (act === 'between') {
      remember(t);
      const i = Number(b.dataset.i);
      const half = t.frames[i].dur / 2;
      t.frames[i].dur = half;
      t.frames.splice(i + 1, 0, { id: nextFrameId++, made: true, between: [t.frames[i].id, t.frames[i + 1].id], edits: {}, stretch: {}, dur: half });
      t.current = i + 1;
      t.version++;
      renderPanel();
      toast('In-between added. You can turn or stretch it like any frame.', 2500);
    } else if (act === 'leave') {
      remember(t);
      const i = Number(b.dataset.i);
      t.accepted.add(`${t.frames[i].id}-${t.frames[i + 1].id}`);
      renderPanel();
    }
  };
  for (const el of [$('takePanel'), film, feel, cmd, pill]) el.addEventListener('click', onPanelClick);
  // Clean-up: live while dragging (canvas and preview follow), thumbnails catch up on release.
  feel.addEventListener('pointerdown', (e) => {
    if (e.target.id === 'tpClean' && active) remember(active);
  }, true);
  feel.addEventListener('input', (e) => {
    if (e.target.id === 'tpClean' && active) {
      const t = active;
      const cur = settingOf(t, t.sel);
      t.settings[t.sel] = { clean: Number(e.target.value) / 100, feel: cur.feel };
      t.version++;
      for (const f of t.frames) f.thumbVer = t.version; // keep old thumbnails while dragging
      $('tpCleanVal').textContent = `${e.target.value}%`;
    }
  });
  feel.addEventListener('change', (e) => {
    if (e.target.id === 'tpClean' && active) {
      active.version++;
      renderPanel();
    }
  });

  // Drag frames to reorder (pointer based, so it works with a finger or Pencil too). The row
  // lifts, the others slide apart to open a slot where it will land.
  let dragState = null;
  $('takePanel').addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.tp-frame');
    if (!row || panel !== 'frames' || e.target.closest('button')) return;
    dragState = { from: Number(row.dataset.i), to: Number(row.dataset.i), y0: e.clientY, moved: false, row };
    row.setPointerCapture(e.pointerId);
  });
  $('takePanel').addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const d = dragState;
    if (!d.moved && Math.abs(e.clientY - d.y0) < 6) return;
    const list = $('tpFrames');
    if (!d.moved) {
      d.moved = true;
      playing = false;
      const before = d.row.getBoundingClientRect().top;
      list.classList.add('reordering'); // jump notes step aside while you drag
      d.rows = [...list.querySelectorAll('.tp-frame')];
      d.k = scaleOf(d.row);
      const r = d.row.getBoundingClientRect();
      d.grab = d.y0 - before; // where on the row you picked it up
      d.top = r.top;
      d.h = r.height + 4 * d.k;
      d.mids = d.rows.map((x) => {
        const q = x.getBoundingClientRect();
        return q.top + q.height / 2;
      });
      d.row.classList.add('dragging');
    }
    d.row.style.transform = `translateY(${(e.clientY - d.grab - d.top) / d.k}px) scale(1.02)`;
    // Where it would land: count the other rows whose middle is above the pointer.
    let to = 0;
    d.mids.forEach((m, k) => {
      if (k !== d.from && e.clientY > m) to++;
    });
    d.to = to;
    d.rows.forEach((x, k) => {
      if (k === d.from) return;
      let shift = 0;
      if (d.from < d.to && k > d.from && k <= d.to) shift = -1;
      if (d.to < d.from && k >= d.to && k < d.from) shift = 1;
      x.style.transform = shift ? `translateY(${(shift * d.h) / d.k}px)` : '';
    });
  });
  const endDrag = () => {
    if (!dragState) return;
    const d = dragState;
    if (d.moved && d.to !== d.from) {
      const t = active;
      remember(t);
      const [f] = t.frames.splice(d.from, 1);
      t.frames.splice(d.to, 0, f);
      t.current = d.to;
      t.version++;
      const J = jumps(t);
      if (J.length) toast(`Moved. ${J.length} spot${J.length > 1 ? 's' : ''} now won't flow, marked in orange.`, 2600);
    }
    setTimeout(() => (dragState = null), 0);
    renderPanel();
  };
  $('takePanel').addEventListener('pointerup', endDrag);
  $('takePanel').addEventListener('pointercancel', endDrag);
  function scaleOf(el) {
    const r = el.getBoundingClientRect();
    return r.width / el.offsetWidth || 1;
  }

  // Keyboard: T turn, S stretch, A animate, R rig (in the rig panel).
  addEventListener('keydown', (e) => {
    if (panel !== 'rig' || !active || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 't') setTool('turn');
    else if (k === 's') setTool('stretch');
    else if (k === 'a') setMode('animate');
    else if (k === 'r') setMode('rig');
  });

  // ---------- preview window ----------
  $('partPreview').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pmode) preview.mode = b.dataset.pmode;
    if (b.dataset.act === 'pplay') {
      preview.playing = !preview.playing;
      preview.t0 = performance.now();
    }
    for (const x of $('partPreview').querySelectorAll('[data-pmode]')) x.classList.toggle('on', x.dataset.pmode === preview.mode);
    $('ppPlay').innerHTML = icon(preview.playing ? I.pause : I.play, 14);
    $('ppCaption').textContent = preview.mode === 'after' ? 'After: cleaned up, with its feel' : 'Before: straight from the camera';
  });
  $('ppPlay').innerHTML = icon(I.pause, 14);

  function cropFor(take, id) {
    const key = `${take.version}:${id}`;
    if (preview.cropKey === key) return preview.crop;
    const names = NODE[id].joints || ALL_JOINTS;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, T = 0;
    for (const p of posesFor(take, 'after')) {
      const P = pointsFor(p, previewOff.width, previewOff.height);
      T = P.T;
      for (const n of names) {
        x0 = Math.min(x0, P[n].x); x1 = Math.max(x1, P[n].x);
        y0 = Math.min(y0, P[n].y); y1 = Math.max(y1, P[n].y);
      }
    }
    const m = T * (id === 'char' ? 0.6 : 0.42);
    const W = previewOff.width, H = previewOff.height;
    // Grow the box to the preview window's shape, then keep it inside the render.
    const aspect = $('ppCanvas').width / $('ppCanvas').height;
    let w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    w = Math.min(w, W);
    h = Math.min(h, H);
    const cx = clamp((x0 + x1) / 2 - w / 2, 0, W - w), cy = clamp((y0 + y1) / 2 - h / 2, 0, H - h);
    preview.crop = { x: cx, y: cy, w, h };
    preview.cropKey = key;
    return preview.crop;
  }
  function drawPreview(now) {
    const t = active;
    const cv = $('ppCanvas');
    const g = cv.getContext('2d');
    const time = preview.playing ? (now - preview.t0) / 1000 : t.frames.slice(0, t.current).reduce((s, f) => s + f.dur, 0);
    const pose = poseAtTime(t, time, preview.mode);
    const og = previewOff.getContext('2d');
    og.clearRect(0, 0, previewOff.width, previewOff.height);
    renderPose(og, previewOff.width, previewOff.height, pose, { which: 'preview' });
    const c = cropFor(t, t.sel);
    const k = Math.min(cv.width / c.w, cv.height / c.h);
    const w = c.w * k, h = c.h * k;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(previewOff, c.x, c.y, c.w, c.h, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
  }

  // ---------- bones and the rotate circle (modelled on TVPaint's rigging tool) ----------
  const aim = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);
  // Tap a bone to select its part.
  function hitPart(pt, P) {
    let best = null, bestD = 1e9;
    for (const [id, a, b] of BONE_SHAPES) {
      const A = P[a], B = P[b];
      const vx = B.x - A.x, vy = B.y - A.y;
      const u = clamp(((pt.x - A.x) * vx + (pt.y - A.y) * vy) / (vx * vx + vy * vy || 1), 0, 1.2);
      const d = Math.hypot(pt.x - (A.x + vx * u), pt.y - (A.y + vy * u));
      // Small parts win ties, so a forearm lying over the body can still be picked.
      const score = d - (id === 'torso' ? 0 : P.T * 0.04);
      if (score < bestD) {
        bestD = score;
        best = id;
      }
    }
    return bestD < P.T * 0.3 ? best : null;
  }
  // Start rotating the selected part around its joint.
  // Animate mode changes the current frame; Rig mode changes the whole take.
  const target = (t, kind) => (t.mode === 'rig' ? (kind === 'turn' ? t.turns : t.lengths) : t.frames[t.current][kind === 'turn' ? 'edits' : 'stretch']);
  function startRotate(pt) {
    const t = active;
    const spec = ROTATE[t.sel];
    const P = api.lastP;
    if (!spec || !P) return null;
    const store = target(t, 'turn');
    const pivot = { ...P[spec.pivot] };
    return { pivot, a0: aim(pivot, pt), store, base: Object.fromEntries(spec.bones.map((b) => [b, store[b] || 0])) };
  }
  function rotate(pt) {
    const r = brush.rot;
    const delta = wrap(aim(r.pivot, pt) - r.a0);
    for (const [b, a] of Object.entries(r.base)) r.store[b] = a + delta;
    brush.delta = delta;
    active.version++;
  }
  function startStretch(pt) {
    const t = active;
    const spec = STRETCH[t.sel];
    const P = api.lastP;
    if (!spec || !P) return null;
    const store = target(t, 'stretch');
    const A = P[spec.pivot], B = P[spec.tip];
    const L = dist(A, B) || 1;
    const dir = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
    const along = (q) => (q.x - A.x) * dir.x + (q.y - A.y) * dir.y;
    return { spec, store, A: { ...A }, dir, L, s0: along(pt), along, base: Object.fromEntries(spec.bones.map((b) => [b, store[b] || 1])) };
  }
  function stretch(pt) {
    const r = brush.str;
    const k = clamp((r.L + (r.along(pt) - r.s0)) / r.L, 0.4, 2.2);
    for (const [b, v] of Object.entries(r.base)) r.store[b] = clamp(v * k, 0.4, 2.5);
    brush.k = k;
    active.version++;
  }
  // A bone drawn like TVPaint's: a long, thin diamond that is widest near its root joint.
  function kite(ctx, A, B, T) {
    const L = dist(A, B);
    if (L < 2) return;
    const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
    const w = Math.min(L * 0.17, T * 0.17);
    const mx = A.x + ux * L * 0.22, my = A.y + uy * L * 0.22;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(mx - uy * w, my + ux * w);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(mx + uy * w, my - ux * w);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ---------- Layers popover rows ----------
  function renderLayersRows() {
    const box = $('layersTakes');
    if (!box) return;
    box.innerHTML = takes.map((t, i) => `<button class="layer take-layer ${t === active && panel ? 'active' : ''}" data-take="${i}">
      <span class="layer-thumb take-thumb"></span><span class="layer-name">${t.name}<small>${t.frames.length} frame${t.frames.length > 1 ? 's' : ''} · tap to open</small></span></button>`).join('');
    box.querySelectorAll('[data-take]').forEach((b) => {
      const t = takes[Number(b.dataset.take)];
      const slot = b.querySelector('.take-thumb');
      const c = document.createElement('canvas');
      c.width = 76;
      c.height = 56;
      if (t.frames[0]) c.getContext('2d').drawImage(frameThumb(t, 0), 0, 0, 96, 64, 0, 0, 76, 56);
      slot.append(c);
    });
  }
  $('layersTakes')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-take]');
    if (!b) return;
    active = takes[Number(b.dataset.take)];
    openPanel('frames');
  });

  // ---------- public ----------
  const api = {
    lastP: null,
    // While recording a motion, the rig should follow the camera closely: clean-up comes later.
    get rawCapture() {
      return !!rec;
    },
    get editing() {
      return !!panel && !!active;
    },
    brushActive() {
      return panel === 'rig' && !!active;
    },
    // Pointer on the canvas in Rig mode: tap a bone to select its part, drag to rotate it
    // around its joint (anywhere on the canvas works, like TVPaint's rotate circle).
    brushDown(pt) {
      const t = active;
      const P = api.lastP;
      if (!P) return false;
      playing = false;
      const Hd = api.handles;
      const near = (h) => h && dist(pt, h) <= h.r * 2.2;
      if (Hd && ROTATE[t.sel]) {
        if (near(Hd.stretch) && STRETCH[t.sel]) {
          remember(t);
          brush = { moved: false, str: startStretch(pt), k: 1 };
          hover = null;
          cmd.classList.add('dragging');
          return true;
        }
        if (near(Hd.turn)) {
          remember(t);
          brush = { moved: false, rot: startRotate(pt), delta: 0 };
          hover = null;
          cmd.classList.add('dragging');
          return true;
        }
      }
      const hit = hitPart(pt, P);
      if (hit && !isInside(hit, t.sel)) {
        t.sel = hit;
        brush = null;
        renderPanel();
        return true;
      }
      if (!ROTATE[t.sel]) {
        toast('Tap a bone on the character first.', 1800);
        return true;
      }
      if (t.tool === 'stretch') {
        if (!STRETCH[t.sel]) {
          toast(`${NODE[t.sel].name} can't stretch. Pick an arm or a leg.`, 2200);
          return true;
        }
        remember(t);
        brush = { moved: false, str: startStretch(pt), k: 1 };
      } else {
        remember(t);
        brush = { moved: false, rot: startRotate(pt), delta: 0 };
      }
      hover = null;
      cmd.classList.add('dragging');
      return true;
    },
    brushMove(pt) {
      if (!brush) return;
      brush.moved = true;
      if (brush.rot) rotate(pt);
      else if (brush.str) stretch(pt);
    },
    brushUp() {
      if (brush?.moved) renderPanel();
      else if (brush && active?.hist) active.hist.undo.pop(); // a tap changed nothing
      brush = null;
      cmd.classList.remove('dragging');
    },
    // Pointer moving over the canvas in Rig mode (no button down): highlight the bone under it.
    // Returns the cursor to show.
    hover(pt) {
      if (!pt || panel !== 'rig' || !active || !api.lastP) {
        hover = null;
        return '';
      }
      if (brush) return 'grabbing';
      const Hd = api.handles;
      if (Hd && ROTATE[active.sel]) {
        if (Hd.stretch && STRETCH[active.sel] && dist(pt, Hd.stretch) <= Hd.stretch.r * 2.2) return 'ew-resize';
        if (Hd.turn && dist(pt, Hd.turn) <= Hd.turn.r * 2.2) return 'grab';
      }
      const id = hitPart(pt, api.lastP);
      hover = id ? { id, pt } : null;
      if (id && !isInside(id, active.sel)) return 'pointer';
      if (!ROTATE[active.sel]) return 'default';
      return active.tool === 'stretch' ? (STRETCH[active.sel] ? 'ew-resize' : 'not-allowed') : 'grab';
    },
    undo: () => (panel && active ? step('undo') : false),
    redo: () => (panel && active ? step('redo') : false),
    // Called every animation frame by the main loop, after the rig has been updated.
    record(now) {
      if (!rec) return;
      const t = (now - rec.t0) / 1000;
      rec.samples.push({ t, pose: rig.getPose() });
      const k = Math.min(1, t / MAX_SECONDS);
      $('capRing').style.strokeDashoffset = String(176 * (1 - k));
      $('capInfo').textContent = `Recording ${fmtTime(t)} / ${fmtTime(MAX_SECONDS)} · tap to stop`;
      $('recTime').textContent = fmtTime(t);
      if (t >= MAX_SECONDS) stopMotion();
    },
    // The pose to show on the canvas, or null for the live character.
    tick(now) {
      const transforming = document.body.classList.contains('transforming');
      $('capBar').classList.toggle('hidden', !camOpen || !!sheet || !!panel || transforming);
      renderStatus();
      hints?.check();
      if (!rec) $('capRing').style.strokeDashoffset = '176';
      // Arrival sheet preview: the drawings you picked, each held until the next, in time.
      if (sheet?.playing && sheet.kind === 'motion') {
        const kept = sheet.keys.filter((i) => !sheet.dropped.has(i));
        const n = sheet.raw.length;
        const at = Math.floor((((now - sheet.t0) / 1000) * RATE) % n);
        let src = kept[0];
        for (const k of kept) if (k <= at) src = k;
        return { pose: sheet.raw[src] };
      }
      if (!panel || !active) return null;
      const t = active;
      if (panel === 'rig' && t.frames.length > 1 && !$('partPreview').classList.contains('hidden')) drawPreview(now);
      if (playing && t.frames.length > 1) {
        const time = (now - playT0) / 1000;
        // Light up the frame being played, in the list or the strip.
        let r = ((time % totalTime(t)) + totalTime(t)) % totalTime(t), i = 0;
        while (i < t.frames.length - 1 && r >= t.frames[i].dur) r -= t.frames[i++].dur;
        if (i !== playRow) {
          playRow = i;
          for (const el of film.querySelectorAll('[data-frame]')) el.classList.toggle('playing-now', Number(el.dataset.frame) === i);
        }
        if (playOnce && time >= totalTime(t)) {
          playOnce = false;
          playing = false;
          t.current = 0;
          renderPanel();
          return { pose: posesFor(t, 'after')[0] };
        }
        return { pose: poseAtTime(t, time, original ? 'before' : 'after') };
      }
      if (original) return { pose: posesFor(t, 'before')[t.current] };
      return { pose: posesFor(t, 'after')[t.current] };
    },
    onionPose() {
      const t = active;
      if (!panel || !t || playing || t.current === 0) return null;
      return posesFor(t, 'after')[t.current - 1];
    },
    // Rig mode overlay: every bone as a translucent blue diamond (the selected part darker),
    // and the rotate circle around the selected part's joint.
    drawOverlay(ctx, P) {
      api.handles = null;
      if (panel !== 'rig' || !active || !P || playing) return;
      lastCtx = ctx;
      const ids = new Set();
      const add = (id) => {
        ids.add(id);
        NODE[id].kids.forEach(add);
      };
      add(active.sel);
      const T = P.T;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, T * 0.008);
      // Animate mode bones are blue, like TVPaint; Rig mode bones are amber, so it's clear the
      // change will reach every frame.
      const rigMode = active.mode === 'rig';
      const col = rigMode
        ? { sel: 'rgba(255, 159, 10, .55)', selLine: 'rgba(200, 110, 0, .95)', rest: 'rgba(255, 170, 60, .28)', restLine: 'rgba(210, 130, 30, .5)' }
        : { sel: 'rgba(62, 58, 230, .58)', selLine: 'rgba(40, 36, 190, .9)', rest: 'rgba(86, 80, 225, .3)', restLine: 'rgba(70, 64, 200, .5)' };
      for (const sel of [false, true]) {
        ctx.fillStyle = sel ? col.sel : col.rest;
        ctx.strokeStyle = sel ? col.selLine : col.restLine;
        for (const [id, a, b] of BONE_SHAPES) if (ids.has(id) === sel) kite(ctx, P[a], P[b], T);
      }
      // The bone under the pointer: lighter, with its name, so you know what a tap will pick.
      if (hover && !isInside(hover.id, active.sel) && !brush) {
        ctx.fillStyle = rigMode ? 'rgba(255, 170, 60, .45)' : 'rgba(110, 104, 240, .5)';
        ctx.strokeStyle = col.selLine;
        for (const [id, a, b] of BONE_SHAPES) if (id === hover.id) kite(ctx, P[a], P[b], T);
        const label = `${NODE[hover.id].name}`;
        ctx.font = `600 ${Math.round(T * 0.085)}px -apple-system, system-ui, sans-serif`;
        const w = ctx.measureText(label).width + T * 0.1;
        const x = hover.pt.x + T * 0.12, y = hover.pt.y - T * 0.16, h = T * 0.14;
        ctx.fillStyle = 'rgba(28,28,30,.88)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y - h / 2, w, h, h / 2) : ctx.rect(x, y - h / 2, w, h);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + T * 0.05, y + 1);
      }
      const sspec = active.tool === 'stretch' ? STRETCH[active.sel] : null;
      if (sspec) {
        // Stretch: a double arrow at the tip of the part, along the bone, and the size while dragging.
        const A = P[sspec.pivot], B = P[sspec.tip];
        const L = dist(A, B) || 1;
        const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
        const a = T * 0.16, h = T * 0.05;
        const tipA = { x: B.x - ux * a, y: B.y - uy * a }, tipB = { x: B.x + ux * a, y: B.y + uy * a };
        ctx.strokeStyle = col.selLine;
        ctx.lineWidth = Math.max(1.5, T * 0.016);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tipA.x, tipA.y);
        ctx.lineTo(tipB.x, tipB.y);
        for (const [p, s] of [[tipA, -1], [tipB, 1]]) {
          ctx.moveTo(p.x - ux * h * s - uy * h, p.y - uy * h * s + ux * h);
          ctx.lineTo(p.x, p.y);
          ctx.lineTo(p.x - ux * h * s + uy * h, p.y - uy * h * s - ux * h);
        }
        ctx.stroke();
        if (brush?.str) {
          const pct = `${Math.round(brush.k * 100)}%`;
          ctx.font = `600 ${Math.round(T * 0.1)}px -apple-system, system-ui, sans-serif`;
          const w = ctx.measureText(pct).width + T * 0.08;
          const x = B.x + uy * T * 0.22, y = B.y - ux * T * 0.22;
          ctx.fillStyle = 'rgba(28,28,30,.85)';
          ctx.fillRect(x - w / 2, y - T * 0.08, w, T * 0.15);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pct, x, y);
        }
      }
      const spec = sspec ? null : ROTATE[active.sel];
      if (spec) {
        const c = brush?.rot ? brush.rot.pivot : P[spec.pivot];
        const r = Math.max(T * 0.35, dist(P[spec.pivot], P[spec.tip]) * 1.12);
        ctx.strokeStyle = 'rgba(120, 120, 128, .75)';
        ctx.lineWidth = Math.max(1, T * 0.009);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
        // While turning, show how far: a wedge from where the drag started.
        if (brush?.rot && Math.abs(brush.delta) > 0.01) {
          ctx.fillStyle = rigMode ? 'rgba(255, 159, 10, .16)' : 'rgba(62, 58, 230, .14)';
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.arc(c.x, c.y, r, brush.rot.a0, brush.rot.a0 + brush.delta, brush.delta < 0);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = col.selLine;
        ctx.lineWidth = Math.max(1.5, T * 0.014);
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(3, T * 0.035), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // The two handles: a circle in the middle turns the part, a diamond at its tip stretches it.
      const hs = ROTATE[active.sel];
      if (hs) {
        const A = P[hs.pivot], B = P[hs.tip];
        const hr = Math.max(T * 0.05, 8);
        api.handles = { turn: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, r: hr } };
        const ss = STRETCH[active.sel];
        if (ss) api.handles.stretch = { x: P[ss.tip].x, y: P[ss.tip].y, r: hr };
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = col.selLine;
        ctx.lineWidth = Math.max(2, T * 0.016);
        ctx.beginPath();
        ctx.arc(api.handles.turn.x, api.handles.turn.y, hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = col.selLine;
        ctx.beginPath();
        ctx.arc(api.handles.turn.x, api.handles.turn.y, hr * 0.32, 0, Math.PI * 2);
        ctx.fill();
        if (api.handles.stretch) {
          const q = api.handles.stretch;
          ctx.fillStyle = col.selLine;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(1.5, T * 0.01);
          ctx.beginPath();
          ctx.moveTo(q.x, q.y - hr * 1.15);
          ctx.lineTo(q.x + hr * 1.15, q.y);
          ctx.lineTo(q.x, q.y + hr * 1.15);
          ctx.lineTo(q.x - hr * 1.15, q.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
      // The path: where the selected part's tip goes across the frames. Close dots are slow.
      if (pathOn && hs && active.frames.length > 1 && pointsFor) {
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const key = `${active.version}|${active.sel}|${W}x${H}`;
        if (pathCache?.key !== key) {
          pathCache = { key, pts: posesFor(active, 'after').map((po) => {
            const Q = pointsFor(po, W, H);
            return Q?.[hs.tip] ? { x: Q[hs.tip].x, y: Q[hs.tip].y, T: Q.T } : null;
          }) };
        }
        const pts = pathCache.pts;
        const cur = pts[active.current];
        const tip = P[hs.tip];
        if (cur && tip) {
          const k = P.T / (cur.T || P.T);
          const at = pts.map((q) => (q ? { x: tip.x + (q.x - cur.x) * k, y: tip.y + (q.y - cur.y) * k } : null)).filter(Boolean);
          ctx.strokeStyle = rigMode ? 'rgba(200, 110, 0, .45)' : 'rgba(40, 36, 190, .4)';
          ctx.lineWidth = Math.max(1.5, T * 0.01);
          ctx.setLineDash([T * 0.03, T * 0.03]);
          ctx.beginPath();
          at.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.stroke();
          ctx.setLineDash([]);
          at.forEach((q, i) => {
            const isCur = pts[active.current] && Math.hypot(q.x - tip.x, q.y - tip.y) < 0.5;
            ctx.fillStyle = isCur ? '#fff' : rigMode ? 'rgba(210, 120, 0, .95)' : 'rgba(40, 36, 190, .9)';
            ctx.strokeStyle = rigMode ? 'rgba(210, 120, 0, .95)' : 'rgba(40, 36, 190, .95)';
            ctx.lineWidth = Math.max(1.5, T * 0.012);
            ctx.beginPath();
            ctx.arc(q.x, q.y, T * (isCur ? 0.03 : 0.02), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });
        }
      }
      placeCmd(ctx, P);
      ctx.restore();
    },
    // For tests and the console.
    get state() {
      return { takes, active, panel, sheet, playing, rec: !!rec };
    },
    jumps: () => (active ? jumps(active) : []),
    jumpInfo: () => (active ? jumpInfo(active) : null),
    // Test hook: pose of the active take at time t ('before' or 'after').
    sample: (t, which = 'after') => (active ? poseAtTime(active, t, which) : null),
    openPanel,
    showTips,
    toggleCamera: () => $('btnCam').click(),
    get camOpen() {
      return camOpen;
    },
    handles: null,
  };
  return api;
}
