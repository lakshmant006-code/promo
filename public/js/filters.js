// One Euro filter (Casiez et al.): removes jitter when you hold still, stays responsive when you
// move fast. Applied to every tracked joint before it reaches the rig.
const alpha = (dt, cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

class OneEuro {
  constructor() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
  filter(x, t, minCutoff, beta, dCutoff = 1) {
    if (this.x === null) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const rawDx = (x - this.x) / dt;
    this.dx += alpha(dt, dCutoff) * (rawDx - this.dx);
    const cutoff = minCutoff + beta * Math.abs(this.dx);
    this.x += alpha(dt, cutoff) * (x - this.x);
    return this.x;
  }
}

export class JointFilter {
  constructor() {
    this.f = {};
  }
  reset() {
    this.f = {};
  }
  // smoothing 0..1 (the Smoothing slider): higher holds steadier.
  filter(joints, t, smoothing) {
    if (!joints) return joints;
    const minCutoff = 3.2 - smoothing * 3; // Hz
    const beta = 1.6;
    const out = {};
    for (const [name, j] of Object.entries(joints)) {
      const f = this.f[name] || (this.f[name] = { x: new OneEuro(), y: new OneEuro() });
      out[name] = { x: f.x.filter(j.x, t, minCutoff, beta), y: f.y.filter(j.y, t, minCutoff, beta), v: j.v };
    }
    return out;
  }
}
