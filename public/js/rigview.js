// Rig debug views, like the SETUP / MESH / WEIGHTS views in rigging tools: the deforming mesh
// wireframe, and each vertex coloured by the bones that move it (blended near joints).
import { BONES } from './rig.js';

// One colour per bone, in BONES order. Right side blues, left side reds, body yellow/green.
const BONE_COLORS = {
  spine: [255, 214, 10], neck: [52, 199, 89], shoulders: [255, 159, 10], hips: [0, 199, 190],
  upperArmR: [10, 132, 255], foreArmR: [94, 92, 230], upperArmL: [255, 69, 58], foreArmL: [255, 55, 95],
  thighR: [50, 173, 230], shinR: [88, 86, 214], thighL: [255, 105, 97], shinL: [191, 90, 242],
};
const COLORS = BONES.map(([name]) => BONE_COLORS[name] || [200, 200, 200]);

// The mesh whose vertex positions were updated by the last render (WebGL or canvas fallback).
const liveMesh = (piece) => piece.mesh || piece.mesh2d;

export function drawRigView(ctx, puppet, { mesh = false, weights = false } = {}) {
  if (!puppet || (!mesh && !weights)) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const px = Math.max(1, ctx.canvas.width / 900);

  if (mesh) {
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.35)';
    ctx.lineWidth = px * 0.6;
    ctx.beginPath();
    for (const piece of puppet.pieces) {
      const m = liveMesh(piece);
      if (!m) continue;
      const { out, index } = m;
      // Every other triangle is enough to read the grid and keeps it light.
      for (let t = 0; t < index.length; t += 6) {
        const a = index[t] * 2, b = index[t + 1] * 2, c = index[t + 2] * 2;
        ctx.moveTo(out[a], out[a + 1]);
        ctx.lineTo(out[b], out[b + 1]);
        ctx.lineTo(out[c], out[c + 1]);
      }
    }
    ctx.stroke();
  }

  if (weights) {
    const r = px * 1.6;
    for (const piece of puppet.pieces) {
      const m = liveMesh(piece);
      if (!m) continue;
      const { out, bones, weights: w, count } = m;
      // Sample vertices so dots don't merge into a solid fill.
      const step = Math.max(1, Math.round(count / 220));
      for (let i = 0; i < count; i += step) {
        let R = 0, G = 0, B = 0;
        for (let k = 0; k < 3; k++) {
          const wt = w[i * 3 + k];
          if (!wt) continue;
          const c = COLORS[bones[i * 3 + k]];
          R += c[0] * wt;
          G += c[1] * wt;
          B += c[2] * wt;
        }
        ctx.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
        ctx.beginPath();
        ctx.arc(out[i * 2], out[i * 2 + 1], r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}
