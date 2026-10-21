// Skinning variants, applied right after the standard weighted (linear blend) skinning:
//
//   rigid    Every vertex follows only its strongest bone, like separate cut-out pieces.
//            Useful as a "before" picture: joints open and overlap.
//   weighted Leave the blended skinning as it is (the default).
//   mush     Weighted + shape preservation (Delta Mush): smooth the deformed mesh, then add back
//            each vertex's own detail, rotated and scaled with its bones. Rigidly moved areas come
//            out exactly as skinned, while joints keep their volume instead of pinching or
//            collapsing. A cheap, real-time cousin of As-Rigid-As-Possible deformation.
//
// Before either of the last two, vertices shared by two bones are re-skinned by blending the
// rotation *angle* around their joint instead of averaging the two bones' matrices (the 2D
// equivalent of dual-quaternion skinning). Plain averaging collapses at large bends, such as
// raising an arm about 150° from an open-arms rest pose: the underarm turns into spikes.
//
// "Preserve rigid features" pins the face, hands and shoes to their skinned shape, so smoothing
// never warps glasses, fingers or soles.

import { BONES } from './rig.js';

const ITER = 6; // smoothing passes
const LAMBDA = 0.5;

function along(J, from, to, x, y) {
  const [ax, ay] = J[from], [bx, by] = J[to];
  const vx = bx - ax, vy = by - ay;
  return ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1);
}
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// 1 = keep this vertex's skinned shape exactly (face, hands, shoes).
function pinAt(puppet, bone, x, y) {
  const J = puppet.joints;
  if (bone === 'neck') return 1; // head, face, glasses
  if (bone === 'foreArmR' || bone === 'foreArmL') {
    const s = bone.slice(-1);
    return smooth(0.95, 1.08, along(J, `elbow${s}`, `wrist${s}`, x, y)); // hand beyond the wrist
  }
  if (bone === 'shinR' || bone === 'shinL') {
    const s = bone.slice(-1);
    return smooth(0.95, 1.05, along(J, `knee${s}`, `ankle${s}`, x, y)); // shoe below the ankle
  }
  return 0;
}

// Neighbour lists (compressed rows) from the mesh's triangles.
function neighbours(mesh) {
  const n = mesh.count;
  const sets = Array.from({ length: n }, () => new Set());
  const ix = mesh.index;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t], b = ix[t + 1], c = ix[t + 2];
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + sets[i].size;
  const list = new Uint32Array(start[n]);
  for (let i = 0; i < n; i++) list.set([...sets[i]], start[i]);
  return { start, list };
}

function laplacianSmooth(src, nb, n, iterations, tmp) {
  let a = src, b = tmp;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const s = nb.start[i], e = nb.start[i + 1];
      if (s === e) {
        b[i * 2] = a[i * 2];
        b[i * 2 + 1] = a[i * 2 + 1];
        continue;
      }
      let sx = 0, sy = 0;
      for (let k = s; k < e; k++) {
        const j = nb.list[k];
        sx += a[j * 2];
        sy += a[j * 2 + 1];
      }
      const m = e - s;
      b[i * 2] = a[i * 2] + LAMBDA * (sx / m - a[i * 2]);
      b[i * 2 + 1] = a[i * 2 + 1] + LAMBDA * (sy / m - a[i * 2 + 1]);
    }
    [a, b] = [b, a];
  }
  return a;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// For each vertex blended between two bones that meet at a hinge: the two bones, and the joint.
function hingePairs(puppet, mesh, boneIndex) {
  const n = mesh.count;
  const pairs = new Int16Array(n * 2).fill(-1);
  const pivot = new Float32Array(n * 2);
  const byPair = new Map();
  for (const h of puppet.hinges) {
    byPair.set(`${boneIndex[h.parent]}:${boneIndex[h.child]}`, h);
    byPair.set(`${boneIndex[h.child]}:${boneIndex[h.parent]}`, h);
  }
  for (let i = 0; i < n; i++) {
    if (!(mesh.weights[i * 3 + 1] > 0.001)) continue;
    const a = mesh.bones[i * 3], b = mesh.bones[i * 3 + 1];
    const h = byPair.get(`${a}:${b}`);
    if (!h) continue;
    pairs[i * 2] = a;
    pairs[i * 2 + 1] = b;
    pivot[i * 2] = h.at[0];
    pivot[i * 2 + 1] = h.at[1];
  }
  return { pairs, pivot };
}

export function createDeform() {
  const cache = new WeakMap(); // mesh → precomputed data
  const rot = new WeakMap(); // mesh → hinge pairs
  let boneIndex = null;

  // Re-skin two-bone vertices by rotating around their joint by the blended angle.
  function rotationBlend(puppet, mesh, mats) {
    if (!boneIndex) boneIndex = Object.fromEntries(BONES.map(([name], i) => [name, i]));
    let r = rot.get(mesh);
    if (!r) rot.set(mesh, (r = hingePairs(puppet, mesh, boneIndex)));
    const { img, weights, out, count: n } = mesh;
    for (let i = 0; i < n; i++) {
      const a = r.pairs[i * 2];
      if (a < 0) continue;
      const b = r.pairs[i * 2 + 1];
      const wa = weights[i * 3], wb = weights[i * 3 + 1];
      const total = wa + wb || 1;
      const ma = mats[a], mb = mats[b];
      // The joint, as both bones carry it (the same point, since the rig is connected).
      const px = r.pivot[i * 2], py = r.pivot[i * 2 + 1];
      const ja = [ma.a * px + ma.c * py + ma.e, ma.b * px + ma.d * py + ma.f];
      const jb = [mb.a * px + mb.c * py + mb.e, mb.b * px + mb.d * py + mb.f];
      const jx = (ja[0] * wa + jb[0] * wb) / total, jy = (ja[1] * wa + jb[1] * wb) / total;
      // Blend the angle (short way round) and the scale, not the matrices.
      const ta = Math.atan2(ma.b, ma.a), tb = Math.atan2(mb.b, mb.a);
      const t = ta + wrap(tb - ta) * (wb / total);
      const sa = Math.hypot(ma.a, ma.b), sb = Math.hypot(mb.a, mb.b);
      const sc = (sa * wa + sb * wb) / total;
      const dx = img[i * 2] - px, dy = img[i * 2 + 1] - py;
      const c = Math.cos(t) * sc, sn = Math.sin(t) * sc;
      out[i * 2] = jx + c * dx - sn * dy;
      out[i * 2 + 1] = jy + sn * dx + c * dy;
    }
  }

  function prepare(puppet, piece, mesh) {
    let c = cache.get(mesh);
    if (c) return c;
    const n = mesh.count;
    const nb = neighbours(mesh);
    // Each vertex's detail: its rest position minus its smoothed rest position.
    const rest = Float32Array.from(mesh.img);
    const tmp = new Float32Array(n * 2);
    const sm = Float32Array.from(laplacianSmooth(rest, nb, n, ITER, tmp));
    const delta = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) delta[i] = rest[i] - sm[i];
    const pin = new Float32Array(n);
    for (let i = 0; i < n; i++) pin[i] = pinAt(puppet, piece.bone, mesh.img[i * 2], mesh.img[i * 2 + 1]);
    c = { nb, delta, pin, skinned: new Float32Array(n * 2), a: new Float32Array(n * 2), b: new Float32Array(n * 2) };
    cache.set(mesh, c);
    return c;
  }

  return {
    // method: 'rigid' | 'weighted' | 'mush'. preserve: pin face, hands and shoes.
    apply(puppet, piece, mesh, mats, { method = 'weighted', preserve = true } = {}) {
      if (!mats) return;
      if (method !== 'rigid') rotationBlend(puppet, mesh, mats);
      if (method === 'weighted') return;
      const { img, bones, weights, out, count: n } = mesh;

      if (method === 'rigid') {
        for (let i = 0; i < n; i++) {
          const m = mats[bones[i * 3]]; // strongest bone only
          const x = img[i * 2], y = img[i * 2 + 1];
          out[i * 2] = m.a * x + m.c * y + m.e;
          out[i * 2 + 1] = m.b * x + m.d * y + m.f;
        }
        return;
      }

      // Delta Mush.
      const c = prepare(puppet, piece, mesh);
      c.skinned.set(out);
      c.a.set(out);
      const sm = laplacianSmooth(c.a, c.nb, n, ITER, c.b);
      for (let i = 0; i < n; i++) {
        // Blend of the bones' linear parts (rotation + scale) carries the detail along.
        let A = 0, B = 0, C = 0, D = 0;
        for (let k = 0; k < 3; k++) {
          const w = weights[i * 3 + k];
          if (!w) continue;
          const m = mats[bones[i * 3 + k]];
          A += w * m.a;
          B += w * m.b;
          C += w * m.c;
          D += w * m.d;
        }
        const dx = c.delta[i * 2], dy = c.delta[i * 2 + 1];
        let x = sm[i * 2] + A * dx + C * dy;
        let y = sm[i * 2 + 1] + B * dx + D * dy;
        if (preserve && c.pin[i] > 0) {
          const p = c.pin[i];
          x += (c.skinned[i * 2] - x) * p;
          y += (c.skinned[i * 2 + 1] - y) * p;
        }
        out[i * 2] = x;
        out[i * 2 + 1] = y;
      }
    },
  };
}
