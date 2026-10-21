// Joint balls: a round "elbow" (or knee, shoulder, hip) painted in the character's own colours,
// so a bend never shows a break. Each ball takes its colour and size from the drawing itself,
// gets the same soft shading and paper grain, and only fades in as the joint bends past what
// was drawn. Standing as drawn, nothing changes; bent hard, the joint stays round and whole.

const JOINTS = [
  // [joint, parent bone, child bone, joint at the far end of the child]
  ['elbowR', 'upperArmR', 'foreArmR', 'wristR'],
  ['elbowL', 'upperArmL', 'foreArmL', 'wristL'],
  ['kneeR', 'thighR', 'shinR', 'ankleR'],
  ['kneeL', 'thighL', 'shinL', 'ankleL'],
  ['shoulderR', 'shoulders', 'upperArmR', 'elbowR'],
  ['shoulderL', 'shoulders', 'upperArmL', 'elbowL'],
  ['hipR', 'hips', 'thighR', 'kneeR'],
  ['hipL', 'hips', 'thighL', 'kneeL'],
];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A small tile of paper grain, like the texture in the drawing.
const grain = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  const im = g.createImageData(96, 96);
  let seed = 11;
  for (let i = 0; i < im.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = seed / 2147483647;
    const light = v > 0.5;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = light ? 255 : 0;
    im.data[i + 3] = Math.abs(v - 0.5) > 0.38 ? 40 : 0;
  }
  g.putImageData(im, 0, 0);
  return c;
})();

export function createJointBalls() {
  const samples = new WeakMap(); // puppet → [{ joint, parent, child, r, off, rgb }]
  const ball = document.createElement('canvas');

  // Read colour and thickness from the drawing, once per character view.
  function sample(p) {
    if (samples.has(p)) return samples.get(p);
    const J = p.joints;
    const img = p.img;
    const W = img.width, H = img.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const at = (x, y) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      const i = (y * W + x) * 4;
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    };
    const out = [];
    for (const [joint, parent, child, tip] of JOINTS) {
      const A = J[joint], B = J[tip];
      if (!A || !B) continue;
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (len < 4) continue;
      const ux = (B[0] - A[0]) / len, uy = (B[1] - A[1]) / len;
      const nx = -uy, ny = ux;
      // Thickness of the limb just past the joint: walk out to each side until the paint ends.
      const m = [A[0] + ux * len * 0.12, A[1] + uy * len * 0.12];
      const reach = p.torso * 0.3;
      const walk = (s) => {
        let k = 0;
        for (; k < reach; k++) {
          const px = at(m[0] + nx * k * s, m[1] + ny * k * s);
          if (!px || px[3] < 100) break;
        }
        return k;
      };
      const a = walk(1), b = walk(-1);
      const r = clamp((a + b) / 2, p.torso * 0.05, p.torso * 0.13);
      // Colour: the middle value of the paint around the joint, so specks and lines don't win.
      const rs = [], gs = [], bs = [];
      const cr = r * 0.55;
      for (let y = -cr; y <= cr; y += 2) {
        for (let x = -cr; x <= cr; x += 2) {
          if (x * x + y * y > cr * cr) continue;
          const px = at(A[0] + x, A[1] + y);
          if (!px || px[3] < 200) continue;
          rs.push(px[0]); gs.push(px[1]); bs.push(px[2]);
        }
      }
      if (rs.length < 6) continue;
      const med = (v) => v.sort((x, y) => x - y)[v.length >> 1];
      out.push({ joint, parent, child, tip, r, off: (a - b) / 2, rgb: [med(rs), med(gs), med(bs)] });
    }
    samples.set(p, out);
    return out;
  }

  // Draw the balls for the pose the rig is in. P: solved joints in stage pixels.
  function draw(ctx, p, rig, P, { alpha = 1, flip = false } = {}) {
    if (!p?.joints || !p.img) return;
    const S = P.T / p.torso;
    const rest = p.rest;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const s of sample(p)) {
      const bend = Math.abs(wrap((rig.angle[s.child] - rig.angle[s.parent]) - (rest[s.child] - rest[s.parent])));
      // Stretching the limb opens the joint too.
      const stretch = Math.abs((rig.ratio[s.child] ?? 1) - 1);
      const k = clamp((bend - 0.22) / 0.45 + stretch * 1.5, 0, 1);
      if (k <= 0.01) continue;
      const A = P[s.joint], B = P[s.tip];
      if (!A || !B) continue;
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      let x = A.x + (-(B.y - A.y) / L) * s.off * S;
      let y = A.y + ((B.x - A.x) / L) * s.off * S;
      if (flip) x = 2 * P.pelvis.x - x;
      const R = s.r * S;
      const size = Math.ceil(R * 2 + 4);
      ball.width = ball.height = size;
      const g = ball.getContext('2d');
      const [r, gg, b] = s.rgb;
      const shade = (f) => `rgb(${Math.round(r * f)},${Math.round(gg * f)},${Math.round(b * f)})`;
      // Soft light from the top left, a slightly darker rim, and a feathered edge.
      const h = size / 2;
      const grad = g.createRadialGradient(h - R * 0.25, h - R * 0.3, R * 0.1, h, h, R);
      grad.addColorStop(0, shade(1.06));
      grad.addColorStop(0.6, shade(1));
      grad.addColorStop(0.88, shade(0.9));
      grad.addColorStop(1, `rgba(${Math.round(r * 0.9)},${Math.round(gg * 0.9)},${Math.round(b * 0.9)},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(h, h, R, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-atop';
      g.drawImage(grain, 0, 0, size, size);
      ctx.globalAlpha = alpha * k;
      ctx.drawImage(ball, x - h, y - h);
    }
    ctx.restore();
  }

  return { draw, sample };
}
