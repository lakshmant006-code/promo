// Secondary motion for loose clothing. After the skeleton has posed the mesh (primary motion),
// each loose vertex springs around its skinned position: it lags on fast moves, swings a little
// and settles. The springs pull toward the animated rest position, never toward raw camera
// landmarks, so tracking noise doesn't turn into wobble.
//
// Rigidity (1 = moves only with the bones) comes from where a vertex sits on the body:
//   head, torso, upper arms, hands, shoes  100% (not simulated)
//   jacket hem 38%, sleeve cuffs 50%, trouser cuffs 35%
import { STEP } from './motion.js';

const RIGID = 0.97; // at or above this, a vertex just follows the skeleton
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
// 1 inside [a, b], easing to 0 over `soft` on either side.
const band = (x, a, b, soft) => smooth(a - soft, a, x) * (1 - smooth(b, b + soft, x));

function along(J, from, to, x, y) {
  const [ax, ay] = J[from], [bx, by] = J[to];
  const vx = bx - ax, vy = by - ay;
  return ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1); // 0 at `from`, 1 at `to`
}

// Rigidity of a drawing point (image pixels) on a piece carried by `bone`.
export function rigidityAt(puppet, bone, x, y) {
  const J = puppet.joints;
  const T = puppet.torso;
  if (bone === 'spine') {
    // Jacket hem: the band just above and below the hip line.
    return 1 - 0.62 * smooth(J.pelvis[1] - T * 0.28, J.pelvis[1] + T * 0.02, y);
  }
  if (bone === 'foreArmR' || bone === 'foreArmL') {
    const s = bone.endsWith('R') ? 'R' : 'L';
    return 1 - 0.5 * band(along(J, `elbow${s}`, `wrist${s}`, x, y), 0.72, 1.0, 0.12); // cuff, not hand
  }
  if (bone === 'shinR' || bone === 'shinL') {
    const s = bone.endsWith('R') ? 'R' : 'L';
    return 1 - 0.65 * band(along(J, `knee${s}`, `ankle${s}`, x, y), 0.72, 0.96, 0.1); // cuff, not shoe
  }
  if (bone === 'thighR' || bone === 'thighL' || bone === 'hips') return 0.9; // baggy, but mostly follows
  return 1;
}

export function createCloth() {
  let acc = 0;
  let steps = 0;
  let alpha = 1;
  let settings = { bounce: 0.4 };
  let state = new WeakMap(); // mesh → { rig, loose, x, v, prev }

  function prepare(puppet, piece, mesh) {
    let st = state.get(mesh);
    if (st) return st;
    const n = mesh.count;
    const rig = new Float32Array(n);
    let loose = 0;
    for (let i = 0; i < n; i++) {
      rig[i] = rigidityAt(puppet, piece.bone, mesh.img[i * 2], mesh.img[i * 2 + 1]);
      if (rig[i] < RIGID) loose++;
    }
    st = { rig, loose, x: null, v: null, prev: null };
    state.set(mesh, st);
    return st;
  }

  return {
    // Once per frame, before drawing: fixed 120 Hz steps, plus the cloth bounce setting (0..1).
    // amount: secondary motion amount (0..1); 0.3 is the designed looseness, higher loosens further.
    frame(dt, bounce, amount = 0.3) {
      acc += Math.min(Math.max(dt, 0), 0.1);
      steps = Math.floor(acc / STEP);
      acc -= steps * STEP;
      alpha = acc / STEP;
      settings = { bounce, amount };
    },
    // Start every mesh again from its skinned pose (new character, recentre).
    reset() {
      acc = 0;
      state = new WeakMap();
    },

    // Called by the renderer right after skinning: `out` holds the skinned positions (pixels).
    apply(puppet, piece, mesh) {
      const st = prepare(puppet, piece, mesh);
      if (!st.loose) return;
      const out = mesh.out;
      const n = mesh.count;
      if (!st.x || st.x.length !== out.length) {
        st.x = Float32Array.from(out);
        st.prev = Float32Array.from(out);
        st.v = new Float32Array(out.length);
      }
      const zeta = 0.9 - settings.bounce * 0.65; // 0.9 (settles) .. 0.25 (swings)
      const snap = puppet.torso * 0.6; // a big jump (resize, recentre) restarts instead of swinging
      const scale = settings.amount / 0.3;
      for (let i = 0; i < n; i++) {
        const r = Math.max(0.1, 1 - (1 - st.rig[i]) * scale);
        const ix = i * 2, iy = ix + 1;
        if (r >= RIGID) {
          st.x[ix] = st.prev[ix] = out[ix];
          st.x[iy] = st.prev[iy] = out[iy];
          st.v[ix] = st.v[iy] = 0;
          continue;
        }
        const w = (2 * Math.PI) * (2.5 + 9 * r); // looser = slower, swingier
        if (Math.abs(out[ix] - st.x[ix]) > snap || Math.abs(out[iy] - st.x[iy]) > snap) {
          st.x[ix] = st.prev[ix] = out[ix];
          st.x[iy] = st.prev[iy] = out[iy];
          st.v[ix] = st.v[iy] = 0;
        }
        for (let s = 0; s < steps; s++) {
          st.prev[ix] = st.x[ix];
          st.prev[iy] = st.x[iy];
          // Damped spring toward the skinned position (semi-implicit Euler, stable at 120 Hz).
          st.v[ix] += STEP * (w * w * (out[ix] - st.x[ix]) - 2 * zeta * w * st.v[ix]);
          st.v[iy] += STEP * (w * w * (out[iy] - st.x[iy]) - 2 * zeta * w * st.v[iy]);
          st.x[ix] += STEP * st.v[ix];
          st.x[iy] += STEP * st.v[iy];
        }
        // Blend by rigidity so the transition from stiff to loose cloth stays seamless.
        const k = (1 - r) / (1 - 0.35);
        const sx = st.prev[ix] + (st.x[ix] - st.prev[ix]) * alpha;
        const sy = st.prev[iy] + (st.x[iy] - st.prev[iy]) * alpha;
        out[ix] += (sx - out[ix]) * Math.min(1, k);
        out[iy] += (sy - out[iy]) * Math.min(1, k);
      }
    },
  };
}
