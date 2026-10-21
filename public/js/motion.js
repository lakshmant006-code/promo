// Motion dynamics, in two layers:
//
//  1. PRIMARY (the skeleton): every bone follows its tracked angle through a critically damped
//     spring. That gives each move a soft ease-in and ease-out with no overshoot or wobble, so
//     the anatomy stays faithful to the performer. Forearms, head and shins follow their parent
//     with a slight lag (follow-through), still without bounce.
//  2. SECONDARY (cloth, see cloth.js): loose parts such as the jacket hem and cuffs spring around
//     their skinned rest position. Bounce lives only there, never on the bones.
//
// Both run on a fixed 120 Hz step, independent of the webcam frame rate, and the result is
// interpolated between the last two steps for drawing.
//
// SecondOrder is the classic procedural-animation spring (frequency f, damping zeta, response r):
//   f     how fast it responds (Hz)
//   zeta  <1 bounces, 1 = no overshoot, >1 sluggish
//   r     0 = eases in from rest, 1 = reacts at once, >1 overshoots, <0 anticipates

const TAU = Math.PI * 2;
export const STEP = 1 / 120;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class SecondOrder {
  constructor(x0 = 0) {
    this.reset(x0);
    this.tune(3, 1, 0);
  }
  tune(f, zeta, r) {
    this.k1 = zeta / (Math.PI * f);
    this.k2 = 1 / (TAU * f) ** 2;
    this.k3 = (r * zeta) / (TAU * f);
  }
  reset(x0) {
    this.xp = x0;
    this.y = x0;
    this.prev = x0;
    this.yd = 0;
  }
  update(dt, x) {
    const xd = (x - this.xp) / dt;
    this.xp = x;
    const k2 = Math.max(this.k2, (dt * dt) / 2 + (dt * this.k1) / 2, dt * this.k1); // stays stable
    this.y += dt * this.yd;
    this.yd += (dt * (x + this.k3 * xd - this.y - this.k1 * this.yd)) / k2;
    return this.y;
  }
  // n fixed steps toward x; at(alpha) then reads between the last two steps.
  run(n, x) {
    for (let i = 0; i < n; i++) {
      this.prev = this.y;
      this.update(STEP, x);
    }
  }
  at(alpha) {
    return this.prev + (this.y - this.prev) * alpha;
  }
}

// An angle on a spring: targets are unwrapped so the bone always takes the short way round.
class AngleSpring extends SecondOrder {
  constructor(a0) {
    super(a0);
    this.target = a0;
  }
  aim(a) {
    this.target += wrap(a - this.target);
    return this.target;
  }
}

// Bones further down a limb, sprung relative to their parent so they trail slightly behind it.
export const FOLLOWERS = { foreArmR: 'upperArmR', foreArmL: 'upperArmL', neck: 'spine', shinR: 'thighR', shinL: 'thighL' };

// Named feels for the Rig tab. smooth: 0..0.95 (higher = slower, softer), bounce: cloth only, follow: limb lag.
export const FEELS = {
  snappy: { smooth: 0.2, bounce: 0.15, follow: 0.1 },
  smooth: { smooth: 0.55, bounce: 0.4, follow: 0.35 },
  cinematic: { smooth: 0.78, bounce: 0.3, follow: 0.55 },
  bouncy: { smooth: 0.5, bounce: 0.85, follow: 0.5 },
};

export class MotionSystem {
  constructor() {
    this.reset();
  }
  reset() {
    this.angles = {};
    this.rel = {};
    this.ratios = {};
    this.scalars = {};
    this.acc = 0;
    this.steps = 0;
    this.alpha = 1;
  }

  // Call once per frame: how many fixed steps to run, and where we are between the last two.
  advance(dt) {
    this.acc += Math.min(Math.max(dt, 0), 0.1);
    this.steps = Math.floor(this.acc / STEP);
    this.acc -= this.steps * STEP;
    this.alpha = this.acc / STEP;
  }

  tuning({ smooth = 0.55, follow = 0.35 }) {
    const f = 7.5 - smooth * 6; // 7.5 Hz (snappy) .. ~1.8 Hz (floaty)
    return {
      main: [f, 1, 0.2], // critically damped: eases in and out, never overshoots
      follow: [f * (1 - follow * 0.45), 1, 0], // trails its parent a little, no bounce
      ratio: [f * 1.2, 1, 0],
      fast: [Math.max(10, f * 2.5), 1, 1], // blinks and mouth stay crisp
    };
  }

  // targets: bone → angle; ratioTargets: bone → length ratio. Returns sprung, interpolated values.
  step(targets, ratioTargets, settings) {
    if (settings.enabled === false) {
      // Springs off: the skeleton follows the (filtered) tracking directly.
      this.angles = {};
      this.rel = {};
      this.ratios = {};
      return { angles: { ...targets }, ratios: { ...ratioTargets } };
    }
    const t = this.tuning(settings);
    const n = this.steps;
    const a = this.alpha;
    const out = {};
    for (const [bone, x] of Object.entries(targets)) {
      if (FOLLOWERS[bone]) continue;
      const s = this.angles[bone] || (this.angles[bone] = new AngleSpring(x));
      s.tune(...t.main);
      s.run(n, s.aim(x));
      out[bone] = wrap(s.at(a));
    }
    for (const [bone, parent] of Object.entries(FOLLOWERS)) {
      if (!(bone in targets)) continue;
      const rel = wrap(targets[bone] - targets[parent]);
      const s = this.rel[bone] || (this.rel[bone] = new AngleSpring(rel));
      s.tune(...t.follow);
      s.run(n, s.aim(rel));
      out[bone] = wrap(out[parent] + s.at(a));
    }
    const ratios = {};
    for (const [bone, x] of Object.entries(ratioTargets)) {
      const s = this.ratios[bone] || (this.ratios[bone] = new SecondOrder(x));
      s.tune(...t.ratio);
      s.run(n, x);
      ratios[bone] = s.at(a);
    }
    return { angles: out, ratios };
  }

  // A plain number on a spring (root offset, face values). fast: crisp, for blinks and jaw.
  scalar(key, x, settings, fast = false) {
    if (settings.enabled === false) {
      delete this.scalars[key];
      return x;
    }
    const t = this.tuning(settings);
    const s = this.scalars[key] || (this.scalars[key] = new SecondOrder(x));
    s.tune(...(fast ? t.fast : t.main));
    s.run(this.steps, x);
    return s.at(this.alpha);
  }
}
