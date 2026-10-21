// 2D character rig. Tracked joints give each bone an angle (and a foreshortening ratio);
// the character keeps its own proportions and is rebuilt with forward kinematics.
import { MotionSystem } from './motion.js';

const PI = Math.PI;

// Typical human proportions, relative to torso length (shoulder midpoint to hip midpoint).
// Used to tell how foreshortened a tracked bone is (e.g. an arm pointing at the camera).
const ANATOMY = { shoulders: 0.78, hips: 0.52, neck: 0.42, upperArm: 0.62, foreArm: 0.58, thigh: 0.88, shin: 0.86 };

// The character's own proportions, in torso lengths.
const CHAR = { spine: 1, neck: 0.4, headR: 0.36, shoulders: 0.74, hips: 0.46, upperArm: 0.6, foreArm: 0.56, thigh: 0.82, shin: 0.8 };

// [bone, from joint, to joint, rest angle (canvas: +PI/2 points down), proportion key, follows spine lean]
export const BONES = [
  ['spine', 'pelvis', 'neck', -PI / 2, 'spine', false],
  ['neck', 'neck', 'head', -PI / 2, 'neck', true],
  ['shoulders', 'shoulderR', 'shoulderL', 0, 'shoulders', true],
  ['hips', 'hipR', 'hipL', 0, 'hips', false],
  ['upperArmR', 'shoulderR', 'elbowR', PI / 2 + 0.22, 'upperArm', true],
  ['foreArmR', 'elbowR', 'wristR', PI / 2 + 0.12, 'foreArm', true],
  ['upperArmL', 'shoulderL', 'elbowL', PI / 2 - 0.22, 'upperArm', true],
  ['foreArmL', 'elbowL', 'wristL', PI / 2 - 0.12, 'foreArm', true],
  ['thighR', 'hipR', 'kneeR', PI / 2 + 0.05, 'thigh', false],
  ['shinR', 'kneeR', 'ankleR', PI / 2 + 0.02, 'shin', false],
  ['thighL', 'hipL', 'kneeL', PI / 2 - 0.05, 'thigh', false],
  ['shinL', 'kneeL', 'ankleL', PI / 2 - 0.02, 'shin', false],
];
const LEG_BONES = new Set(['thighR', 'shinR', 'thighL', 'shinL', 'hips']);

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const VIS = 0.55;

export class Rig {
  constructor() {
    this.angle = {};
    this.ratio = {};
    this.resetCharacter();
    this.face = { roll: 0, yaw: 0, blinkL: 0, blinkR: 0, jaw: 0, smile: 0, browUp: 0 };
    this.offset = { x: 0, y: 0 };
    this.ref = null; // pelvis position (in torso lengths) that maps to stage centre
    this.points = null;
  }

  // Use a drawn character's own proportions and rest pose (see puppet.js).
  // keepPose: switching between views of one character keeps the current angles and springs.
  setCharacter({ proportions, rest }, { keepPose = false } = {}) {
    this.prop = { ...proportions };
    this.rest = { ...rest };
    if (!keepPose) this.resetPose();
  }
  resetCharacter() {
    this.prop = { ...CHAR };
    this.rest = Object.fromEntries(BONES.map(([name, , , rest]) => [name, rest]));
    this.resetPose();
  }
  resetPose() {
    this.motion?.reset();
    for (const [name] of BONES) {
      this.angle[name] = this.rest[name];
      this.ratio[name] = 1;
    }
  }

  // Pose snapshots, used by the frame timeline.
  getPose() {
    return { angle: { ...this.angle }, ratio: { ...this.ratio }, face: { ...this.face }, offset: { ...this.offset } };
  }
  setPose(p) {
    Object.assign(this.angle, p.angle);
    Object.assign(this.ratio, p.ratio);
    Object.assign(this.face, p.face);
    Object.assign(this.offset, p.offset);
  }

  recenter() {
    this.ref = null;
    this.offset = { x: 0, y: 0 };
  }

  // tracked: { joints, face } in tracker space.
  // opts: { smoothing, legRest, motion: { smooth, bounce, follow } }. Every value reaches the
  // character through a spring (see motion.js): eased starts and stops, optional bounce, and
  // follow-through on forearms, head and shins.
  update(tracked, dt, opts) {
    const feel = opts.motion || { smooth: opts.smoothing, bounce: 0.12, follow: 0.5 };
    const m = this.motion || (this.motion = new MotionSystem());
    m.advance(dt); // fixed 120 Hz physics steps for this frame
    const j = tracked?.joints;
    const ok = (n) => j && j[n] && j[n].v > VIS;

    // Torso length in tracker units, estimated from whatever is visible.
    let torso = null;
    if (ok('neck') && ok('pelvis')) torso = dist(j.neck, j.pelvis);
    else if (ok('shoulderL') && ok('shoulderR')) torso = dist(j.shoulderL, j.shoulderR) / ANATOMY.shoulders;

    const lean = this.angle.spine - this.rest.spine;
    const targets = {};
    const ratios = {};
    for (const [name, from, to, , key, followsLean] of BONES) {
      let target = this.rest[name] + (followsLean ? lean : 0);
      let ratio = 1;
      // With "hold rest pose" off, legs follow the model's best guess even when out of frame.
      const guess = LEG_BONES.has(name) && !opts.legRest;
      const seen = (n) => (guess ? j && j[n] && j[n].v > 0.02 : ok(n));
      if (torso && seen(from) && seen(to)) {
        target = Math.atan2(j[to].y - j[from].y, j[to].x - j[from].x);
        if (key !== 'spine') ratio = clamp(dist(j[from], j[to]) / torso / ANATOMY[key], 0.3, 1.15);
      }
      // Test poses from the Rig Lab replace the tracked angle for the bones they set.
      if (opts.override && name in opts.override) {
        target = opts.override[name];
        ratio = 1;
      }
      targets[name] = target;
      ratios[name] = ratio;
    }
    const sprung = m.step(targets, ratios, feel);
    Object.assign(this.angle, sprung.angles);
    Object.assign(this.ratio, sprung.ratios);

    if (opts.offset) {
      this.offset.x = m.scalar('offsetX', opts.offset.x, feel);
      this.offset.y = m.scalar('offsetY', opts.offset.y, feel);
    }
    // Move the whole body when you step around (only when hips are visible).
    if (!opts.offset && torso && ok('pelvis')) {
      const p = { x: j.pelvis.x / torso, y: j.pelvis.y / torso };
      if (!this.ref) this.ref = p;
      const tx = clamp(p.x - this.ref.x, -1.6, 1.6);
      const ty = clamp(p.y - this.ref.y, -0.8, 0.8);
      this.offset.x = m.scalar('offsetX', tx, feel);
      this.offset.y = m.scalar('offsetY', ty, feel);
    }

    const f = tracked?.face;
    if (f) {
      for (const k of Object.keys(this.face)) {
        const fast = k.startsWith('blink') || k === 'jaw'; // keep blinks and speech crisp
        const v = m.scalar(`face.${k}`, f[k], feel, fast);
        this.face[k] = k === 'roll' ? v : Math.max(0, Math.min(1, v));
      }
    }
  }

  // Forward kinematics into stage pixels.
  // shift: where the character sits on the canvas, as a fraction of W and H (Transform tool).
  solve(W, H, scale, shift = null) {
    const T = H * 0.19 * scale;
    const a = this.angle;
    const C = this.prop;
    const r = this.ratio;
    const go = (p, ang, len) => ({ x: p.x + Math.cos(ang) * len, y: p.y + Math.sin(ang) * len });
    const pelvis = { x: W / 2 + (shift?.x || 0) * W + this.offset.x * T, y: H * 0.56 + (shift?.y || 0) * H + this.offset.y * T };
    const neck = go(pelvis, a.spine, C.spine * T);
    const sh = (C.shoulders / 2) * T * r.shoulders;
    const hp = (C.hips / 2) * T * r.hips;
    const shoulderR = go(neck, a.shoulders + PI, sh);
    const shoulderL = go(neck, a.shoulders, sh);
    const hipR = go(pelvis, a.hips + PI, hp);
    const hipL = go(pelvis, a.hips, hp);
    const limb = (start, bone, key) => go(start, a[bone], C[key] * T * r[bone]);
    const elbowR = limb(shoulderR, 'upperArmR', 'upperArm');
    const wristR = limb(elbowR, 'foreArmR', 'foreArm');
    const elbowL = limb(shoulderL, 'upperArmL', 'upperArm');
    const wristL = limb(elbowL, 'foreArmL', 'foreArm');
    const kneeR = limb(hipR, 'thighR', 'thigh');
    const ankleR = limb(kneeR, 'shinR', 'shin');
    const kneeL = limb(hipL, 'thighL', 'thigh');
    const ankleL = limb(kneeL, 'shinL', 'shin');
    const head = go(neck, a.neck, C.neck * T * Math.max(0.6, r.neck));
    this.points = { T, pelvis, neck, head, shoulderR, shoulderL, hipR, hipL, elbowR, wristR, elbowL, wristL, kneeR, ankleR, kneeL, ankleL };
    return this.points;
  }

  draw(ctx, W, H, { scale = 1, parts = {}, skeleton = false } = {}) {
    const P = this.solve(W, H, scale);
    const { T } = P;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    ctx.beginPath();
    ctx.ellipse(P.pelvis.x, Math.max(P.ankleL.y, P.ankleR.y) + T * 0.08, T * 0.7, T * 0.1, 0, 0, PI * 2);
    ctx.fill();

    const seg = (part, a, b, w, color) => {
      if (parts[part]) return drawImageBone(ctx, parts[part], a, b);
      // Ink outline first, then the fill, like a line-art drawing.
      for (const [c, lw] of [[INK, w * T + LINE], [color, w * T]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    };
    const dot = (p, rx, ry, color) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = LINE / 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, ry, 0, 0, PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    const INK = '#111', PANTS = '#111', SHIRT = '#fff', SKIN = '#fff', SHOE = '#fff';
    const LINE = T * 0.035;
    // Legs
    for (const s of ['R', 'L']) {
      seg('thigh' + s, P['hip' + s], P['knee' + s], 0.25, PANTS);
      seg('shin' + s, P['knee' + s], P['ankle' + s], 0.21, PANTS);
      if (!parts['shin' + s]) {
        dot({ x: P['ankle' + s].x + (s === 'R' ? -1 : 1) * T * 0.06, y: P['ankle' + s].y + T * 0.05 }, T * 0.15, T * 0.08, SHOE);
      }
    }
    // Torso
    if (parts.torso) drawImageBone(ctx, parts.torso, P.neck, P.pelvis);
    else {
      const torsoPath = () => {
        ctx.beginPath();
        ctx.moveTo(P.shoulderR.x, P.shoulderR.y);
        ctx.lineTo(P.shoulderL.x, P.shoulderL.y);
        ctx.lineTo(P.hipL.x, P.hipL.y);
        ctx.lineTo(P.hipR.x, P.hipR.y);
        ctx.closePath();
      };
      for (const [c, lw] of [[INK, T * 0.16 + LINE], [SHIRT, T * 0.16]]) {
        ctx.fillStyle = c;
        ctx.strokeStyle = c;
        ctx.lineWidth = lw;
        torsoPath();
        ctx.fill();
        ctx.stroke();
      }
    }
    // Neck
    if (!parts.torso) seg('_neck', P.neck, P.head, 0.14, SKIN);
    // Arms
    for (const s of ['R', 'L']) {
      seg('upperArm' + s, P['shoulder' + s], P['elbow' + s], 0.2, SHIRT);
      seg('foreArm' + s, P['elbow' + s], P['wrist' + s], 0.15, SKIN);
      if (!parts['foreArm' + s]) {
        dot(P['wrist' + s], T * 0.1, T * 0.11, SKIN);
      }
    }
    this.drawHead(ctx, P, parts);
    if (skeleton) drawSkeleton(ctx, P);
  }

  drawHead(ctx, P, parts) {
    const { T, head } = P;
    const f = this.face;
    const R = this.prop.headR * T;
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(this.face.roll);

    const variant =
      (f.jaw > 0.35 && parts.headMouthOpen) ||
      ((f.blinkL + f.blinkR) / 2 > 0.55 && parts.headBlink) ||
      parts.head;
    if (variant) {
      const h = R * 2.6;
      const w = (h * variant.width) / variant.height;
      ctx.drawImage(variant, -w / 2 + f.yaw * R * 0.15, -h * 0.55, w, h);
      ctx.restore();
      return;
    }

    // Default head
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = T * 0.03;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.92, R, 0, 0, PI * 2);
    ctx.fill();
    ctx.stroke();
    // Beanie
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.42, R * 0.95, R * 0.72, 0, PI, PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-R * 0.95, -R * 0.42);
    ctx.lineTo(R * 0.95, -R * 0.42);
    ctx.lineWidth = R * 0.16;
    ctx.stroke();

    const fx = f.yaw * R * 0.35;
    const eye = (x, blink) => {
      const h = Math.max(0.02, (1 - clamp(blink * 1.3, 0, 1))) * R * 0.17;
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.ellipse(x + fx, R * 0.02, R * 0.09, h, 0, 0, PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = R * 0.06;
      ctx.beginPath();
      const by = -R * 0.24 - f.browUp * R * 0.12;
      ctx.moveTo(x + fx - R * 0.13, by);
      ctx.lineTo(x + fx + R * 0.13, by);
      ctx.stroke();
    };
    eye(-R * 0.36, f.blinkR);
    eye(R * 0.36, f.blinkL);

    // Mouth: jaw opens it, smile curves it
    const mw = R * (0.34 + f.smile * 0.18);
    const mh = R * (0.03 + f.jaw * 0.32);
    const my = R * 0.5;
    ctx.fillStyle = '#111';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = R * 0.06;
    ctx.beginPath();
    if (f.jaw > 0.08) ctx.ellipse(fx, my, mw / 2, mh, 0, 0, PI * 2), ctx.fill();
    else {
      ctx.moveTo(fx - mw / 2, my - f.smile * R * 0.08);
      ctx.quadraticCurveTo(fx, my + R * (0.04 + f.smile * 0.14), fx + mw / 2, my - f.smile * R * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Draw an image so its vertical axis runs from joint a (top) to joint b (bottom).
function drawImageBone(ctx, img, a, b) {
  const len = dist(a, b);
  if (len < 1) return;
  const h = len * 1.18; // overlap so joints don't show gaps
  const w = (h * img.width) / img.height;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x) - PI / 2);
  ctx.drawImage(img, -w / 2, -len * 0.09, w, h);
  ctx.restore();
}

export function drawSkeleton(ctx, P) {
  const links = [['pelvis', 'neck'], ['neck', 'head'], ['shoulderR', 'shoulderL'], ['hipR', 'hipL'],
    ['shoulderR', 'elbowR'], ['elbowR', 'wristR'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
    ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['hipL', 'kneeL'], ['kneeL', 'ankleL']];
  ctx.strokeStyle = 'rgba(30,144,255,.85)';
  ctx.lineWidth = 2;
  for (const [a, b] of links) {
    ctx.beginPath();
    ctx.moveTo(P[a].x, P[a].y);
    ctx.lineTo(P[b].x, P[b].y);
    ctx.stroke();
  }
  ctx.fillStyle = '#1e90ff';
  for (const [k, p] of Object.entries(P)) {
    if (k === 'T') continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, PI * 2);
    ctx.fill();
  }
}

// Joint angles (degrees) for the readout. Returns null where joints aren't visible.
export function jointAngles(j) {
  if (!j) return [];
  const ang = (a, b, c) => {
    if (![a, b, c].every((n) => j[n] && j[n].v > VIS)) return null;
    const v1 = { x: j[a].x - j[b].x, y: j[a].y - j[b].y };
    const v2 = { x: j[c].x - j[b].x, y: j[c].y - j[b].y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    return Math.round((Math.acos(clamp(cos, -1, 1)) * 180) / PI);
  };
  return [
    ['Shoulder', ang('hipR', 'shoulderR', 'elbowR'), ang('hipL', 'shoulderL', 'elbowL')],
    ['Elbow', ang('shoulderR', 'elbowR', 'wristR'), ang('shoulderL', 'elbowL', 'wristL')],
    ['Hip', ang('shoulderR', 'hipR', 'kneeR'), ang('shoulderL', 'hipL', 'kneeL')],
    ['Knee', ang('hipR', 'kneeR', 'ankleR'), ang('hipL', 'kneeL', 'ankleL')],
  ];
}

// Blend two poses (u = 0 → a, 1 → b). Angles take the short way round.
export function lerpPose(a, b, u) {
  const mix = (x, y) => x + (y - x) * u;
  const out = { angle: {}, ratio: {}, face: {}, offset: {} };
  for (const k of Object.keys(a.angle)) out.angle[k] = a.angle[k] + wrap(b.angle[k] - a.angle[k]) * u;
  for (const k of Object.keys(a.ratio)) out.ratio[k] = mix(a.ratio[k], b.ratio[k]);
  for (const k of Object.keys(a.face)) out.face[k] = k === 'roll' ? a.face[k] + wrap(b.face[k] - a.face[k]) * u : mix(a.face[k], b.face[k]);
  for (const k of Object.keys(a.offset)) out.offset[k] = mix(a.offset[k], b.offset[k]);
  return out;
}

// Catmull-Rom curve through four poses: the motion passes through p1 and p2 and carries its
// momentum on, instead of stopping at every pose. t runs 0..1 from p1 to p2.
export function splinePose(p0, p1, p2, p3, t) {
  const cr = (a, b, c, d) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  // Angles: unwrap the neighbours around p1 so the curve takes the short way.
  const ang = (k, src) => {
    const b = p1[src][k];
    const a = b + wrap(p0[src][k] - b), c = b + wrap(p2[src][k] - b);
    const d = c + wrap(p3[src][k] - c);
    return wrap(cr(a, b, c, d));
  };
  const out = { angle: {}, ratio: {}, face: {}, offset: {} };
  for (const k of Object.keys(p1.angle)) out.angle[k] = ang(k, 'angle');
  for (const k of Object.keys(p1.ratio)) out.ratio[k] = cr(p0.ratio[k], p1.ratio[k], p2.ratio[k], p3.ratio[k]);
  for (const k of Object.keys(p1.face)) {
    out.face[k] = k === 'roll' ? ang(k, 'face') : Math.max(0, Math.min(1, cr(p0.face[k], p1.face[k], p2.face[k], p3.face[k])));
  }
  for (const k of Object.keys(p1.offset)) out.offset[k] = cr(p0.offset[k], p1.offset[k], p2.offset[k], p3.offset[k]);
  return out;
}
