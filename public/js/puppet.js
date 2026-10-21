// Mesh-skinned puppet. A drawing is split into body-part pieces; each piece is covered by a
// fine triangle mesh whose vertices are weighted to their bone and, near a joint, blended with
// the neighbouring bone. Elbows, knees and shoulders then bend smoothly instead of splitting.
//
// A character is described by JSON (see characters/beanie.json):
//   joints  – where each joint sits on the drawing (image pixels)
//   pieces  – optional outline per body part; if missing, parts are cut automatically from the joints
//   face    – optional mouth / eye positions for the blink and mouth-open overlays
import { BONES } from './rig.js';

const BONE = Object.fromEntries(BONES.map(([name, from, to]) => [name, { from, to }]));
const BONE_INDEX = Object.fromEntries(BONES.map(([name], i) => [name, i]));
const DRAW_ORDER = ['shinR', 'shinL', 'hips', 'thighR', 'thighL', 'spine', 'upperArmR', 'upperArmL', 'foreArmR', 'foreArmL', 'neck'];

// Where a child bone hinges on its parent, and how wide the blend is (in torso lengths).
const HINGES = [
  ['upperArmR', 'spine', 'shoulderR', 0.14],
  ['upperArmL', 'spine', 'shoulderL', 0.14],
  ['foreArmR', 'upperArmR', 'elbowR', 0.1],
  ['foreArmL', 'upperArmL', 'elbowL', 0.1],
  ['thighR', 'spine', 'hipR', 0.12],
  ['thighL', 'spine', 'hipL', 0.12],
  ['shinR', 'thighR', 'kneeR', 0.12],
  ['shinL', 'thighL', 'kneeL', 0.12],
  ['neck', 'spine', 'headPivot', 0.07],
];
const GRID = 7; // mesh cell size in drawing pixels (WebGL)
const GRID_2D = 12; // coarser mesh for the plain-canvas fallback

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const DEG = 180 / Math.PI;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---------------------------------------------------------------- building

export async function loadPuppet(url) {
  const def = await (await fetch(url)).json();
  return buildPuppet(def, await loadImage(def.image));
}

// options.overlap: false builds the parts edge to edge, with no hidden artwork under the joints
// (for comparing in the Rig Lab).
export function buildPuppet(def, img, { overlap = true } = {}) {
  const originalImg = img;
  // Boxes of artwork to leave out (for example a hidden second shoe that peeks out in a side view).
  if (def.erase?.length) {
    const c = pieceCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    for (const [x0, y0, x1, y1] of def.erase) g.clearRect(x0, y0, x1 - x0, y1 - y0);
    img = c;
  }
  const J = completeJoints(def.joints);
  const torso = len(J.pelvis, J.neck);

  // Proportions (in torso lengths) and rest angles come straight from the drawing.
  const avg = (a, b) => (a + b) / 2;
  const proportions = {
    spine: 1,
    neck: len(J.neck, J.head) / torso,
    headR: 0.36,
    shoulders: len(J.shoulderR, J.shoulderL) / torso,
    hips: len(J.hipR, J.hipL) / torso,
    upperArm: avg(len(J.shoulderR, J.elbowR), len(J.shoulderL, J.elbowL)) / torso,
    foreArm: avg(len(J.elbowR, J.wristR), len(J.elbowL, J.wristL)) / torso,
    thigh: avg(len(J.hipR, J.kneeR), len(J.hipL, J.kneeL)) / torso,
    shin: avg(len(J.kneeR, J.ankleR), len(J.kneeL, J.ankleL)) / torso,
  };
  const rest = {};
  for (const [name, { from, to }] of Object.entries(BONE)) rest[name] = ang(J[from], J[to]);

  const hinges = HINGES.map(([child, parent, joint, r]) => {
    const target = child === 'neck' ? J.head : J[BONE[child].to];
    const a = ang(J[joint], target);
    return { child, parent, at: J[joint], dir: [Math.cos(a), Math.sin(a)], r: r * torso };
  });
  // The seat of the trousers stretches with the thighs: each half of the hips part blends toward
  // its thigh below the hip joint. (Only the hips part uses these; thighs keep their own hinges.)
  for (const s of ['R', 'L']) {
    const a = ang(J[`hip${s}`], J[`knee${s}`]);
    hinges.push({
      child: `thigh${s}`, parent: 'hips', at: J[`hip${s}`], dir: [Math.cos(a), Math.sin(a)], r: 0.2 * torso, parentOnly: true,
      // Only this thigh's half of the seat (R is on the screen's left), so the crotch opens into a V.
      side: { x: J.pelvis[0], sign: s === 'R' ? -1 : 1, band: 0.05 * torso },
    });
  }

  // Parts come from separate layers (PSD), hand-drawn outlines, or an automatic cut.
  const cut = def.layers
    ? [...def.layers].sort((a, b) => DRAW_ORDER.indexOf(a.bone) - DRAW_ORDER.indexOf(b.bone))
    : def.pieces
      ? cutByOutlines(img, def.pieces)
      : cutAutomatically(img, J, torso, overlap, def.nearSide ? FAR_PARTS[def.nearSide] : null);
  if (overlap) inkHiddenEdges(cut, img, torso, def.edges || 'ink');
  // Parts drawn on top of the body (a sleeve in profile) that distance alone can't separate.
  if (def.regions) applyRegions(cut, img, def.regions);
  // Views that show only one side (a profile): the hidden limbs are darker copies of the visible
  // ones, drawn behind the body, so both arms and legs can swing.
  if (def.nearSide) cut.unshift(...farLimbs(cut, def.nearSide));
  const pieces = cut.map((p) => ({ ...p, mesh: null, mesh2d: null }));

  return { name: def.name, def, img: originalImg, joints: J, torso, proportions, rest, pieces, hinges, face: def.face || null };
}

export function completeJoints(joints) {
  const J = { ...joints };
  J.neck = mid(J.shoulderR, J.shoulderL);
  J.pelvis = mid(J.hipR, J.hipL);
  if (!J.headPivot) J.headPivot = [J.neck[0] + (J.head[0] - J.neck[0]) * 0.45, J.neck[1] + (J.head[1] - J.neck[1]) * 0.45];
  return J;
}

function pieceCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

// Hand-drawn outlines (the sample character).
function cutByOutlines(img, defs) {
  return defs.map((p) => {
    const xs = p.poly.map((v) => v[0]);
    const ys = p.poly.map((v) => v[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(img.width, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(img.height, Math.ceil(Math.max(...ys)));
    const c = pieceCanvas(x1 - x0, y1 - y0);
    const g = c.getContext('2d');
    g.beginPath();
    p.poly.forEach(([x, y], i) => (i ? g.lineTo(x - x0, y - y0) : g.moveTo(x - x0, y - y0)));
    g.closePath();
    g.clip();
    g.drawImage(img, -x0, -y0);
    return { bone: p.bone, canvas: c, x0, y0 };
  });
}

// Automatic cut: every visible pixel goes to the nearest bone (distance minus the bone's
// thickness), then each part is grown a few pixels so neighbours overlap at the joints.
// Which parts meet at a joint (parts only grow into these when overlapping).
const JOINS = Object.fromEntries(Object.entries({
  spine: ['neck', 'hips', 'upperArmR', 'upperArmL', 'thighR', 'thighL'],
  neck: ['spine'],
  hips: ['spine', 'thighR', 'thighL'],
  upperArmR: ['spine', 'foreArmR'],
  upperArmL: ['spine', 'foreArmL'],
  foreArmR: ['upperArmR'],
  foreArmL: ['upperArmL'],
  thighR: ['hips', 'spine', 'shinR', 'thighL'],
  thighL: ['hips', 'spine', 'shinL', 'thighR'],
  shinR: ['thighR'],
  shinL: ['thighL'],
}).map(([k, v]) => [k, new Set(v)]));

// Region polygons give a part its own artwork cut by hand: the part is a copy of that area, and
// the torso underneath is repainted from the body beside it, so nothing is left to ghost on the
// body when the part moves away.
function applyRegions(cut, img, regions) {
  const W = img.width, H = img.height;
  const flat = pieceCanvas(W, H).getContext('2d', { willReadFrequently: true });
  flat.drawImage(img, 0, 0);
  const src = flat.getImageData(0, 0, W, H).data;
  const spine = cut.find((p) => p.bone === 'spine');
  const made = [];
  for (const [bone, poly] of Object.entries(regions)) {
    made.push(...cutByOutlines(img, [{ bone, poly }]));
    if (!spine || bone.startsWith('foreArm') === false && bone.startsWith('upperArm') === false) continue;
    const path = new Path2D();
    poly.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    const xs = poly.map((v) => v[0]), ys = poly.map((v) => v[1]);
    const maxX = Math.max(...xs);
    const sg = spine.canvas.getContext('2d', { willReadFrequently: true });
    const im = sg.getImageData(0, 0, spine.canvas.width, spine.canvas.height);
    const test = pieceCanvas(1, 1).getContext('2d');
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      // The body colour just beyond the part on this row.
      let sx = Math.min(W - 1, maxX + 14);
      const o = (y * W + sx) * 4;
      if (src[o + 3] < 200) continue;
      for (let x = Math.floor(Math.min(...xs)); x <= maxX; x++) {
        if (!test.isPointInPath(path, x, y)) continue;
        const lx = x - spine.x0, ly = y - spine.y0;
        if (lx < 0 || ly < 0 || lx >= spine.canvas.width || ly >= spine.canvas.height) continue;
        const k = (ly * spine.canvas.width + lx) * 4;
        if (im.data[k + 3] === 0) continue;
        im.data[k] = src[o];
        im.data[k + 1] = src[o + 1];
        im.data[k + 2] = src[o + 2];
      }
    }
    sg.putImageData(im, 0, 0);
  }
  // Replace any automatic piece for these parts, and draw them just under the head.
  for (let i = cut.length - 1; i >= 0; i--) if (regions[cut[i].bone]) cut.splice(i, 1);
  const head = cut.findIndex((p) => p.bone === 'neck');
  cut.splice(head < 0 ? cut.length : head, 0, ...made);
}

// Parts that don't exist in the artwork for a profile whose near side is R or L.
const FAR_PARTS = {
  R: new Set(['upperArmL', 'foreArmL', 'thighL', 'shinL']),
  L: new Set(['upperArmR', 'foreArmR', 'thighR', 'shinR']),
};
const FAR_OF = { upperArmR: 'upperArmL', foreArmR: 'foreArmL', thighR: 'thighL', shinR: 'shinL', upperArmL: 'upperArmR', foreArmL: 'foreArmR', thighL: 'thighR', shinL: 'shinR' };

function farLimbs(cut, nearSide) {
  const out = [];
  for (const piece of cut) {
    const far = FAR_OF[piece.bone];
    if (!far || !FAR_PARTS[nearSide].has(far)) continue;
    const c = pieceCanvas(piece.canvas.width, piece.canvas.height);
    const g = c.getContext('2d');
    g.drawImage(piece.canvas, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(20, 10, 30, 0.28)'; // the limb on the far side sits in shade
    g.fillRect(0, 0, c.width, c.height);
    out.push({ bone: far, canvas: c, x0: piece.x0, y0: piece.y0, far: true });
  }
  return out;
}

function cutAutomatically(img, J, torso, overlap = true, excluded = null) {
  const W = img.width;
  const H = img.height;
  const src = pieceCanvas(W, H).getContext('2d', { willReadFrequently: true });
  src.drawImage(img, 0, 0);
  const data = src.getImageData(0, 0, W, H).data;

  const segs = {
    spine: [J.pelvis, J.neck, 0.36],
    neck: [J.headPivot, [J.head[0] + (J.head[0] - J.headPivot[0]) * 0.6, J.head[1] + (J.head[1] - J.headPivot[1]) * 0.6], 0.28],
    upperArmR: [J.shoulderR, J.elbowR, 0.12],
    upperArmL: [J.shoulderL, J.elbowL, 0.12],
    // Forearms run on past the wrist to take in the whole hand.
    foreArmR: [J.elbowR, [J.wristR[0] + (J.wristR[0] - J.elbowR[0]) * 0.9, J.wristR[1] + (J.wristR[1] - J.elbowR[1]) * 0.9], 0.1],
    foreArmL: [J.elbowL, [J.wristL[0] + (J.wristL[0] - J.elbowL[0]) * 0.9, J.wristL[1] + (J.wristL[1] - J.elbowL[1]) * 0.9], 0.1],
    // The seat of the trousers, under both thighs, so nothing opens between the legs: a short
    // segment down the middle from the pelvis to the crotch (it stays clear of the hands).
    hips: [J.pelvis, [J.pelvis[0], J.pelvis[1] + torso * 0.3], 0.14],
    thighR: [J.hipR, J.kneeR, 0.16],
    thighL: [J.hipL, J.kneeL, 0.16],
    shinR: [J.kneeR, [J.ankleR[0], J.ankleR[1] + torso * 0.3], 0.14],
    shinL: [J.kneeL, [J.ankleL[0], J.ankleL[1] + torso * 0.3], 0.14],
  };
  const names = excluded ? DRAW_ORDER.filter((n) => !excluded.has(n)) : DRAW_ORDER;
  const body = bodyColumn(data, W, H, J, torso);
  const owner = new Int8Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (data[i * 4 + 3] < 8) continue;
      let best = -1;
      let bestD = Infinity;
      names.forEach((n, k) => {
        const [a, b, r] = segs[n];
        let d = distToSegment(x, y, a, b) - r * torso;
        // Pixels behind where a part starts belong to its parent: above the hips or inside the
        // armpit go to the body, and below the pelvis to the hips.
        if (n !== 'hips') {
          const behind = -alongSegment(x, y, a, b);
          if (behind > 0) d += behind * 1.5;
        }
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      owner[i] = best;
    }
  }

  // Thin side flare beyond the body line (above the hem) sticks out as a flap once an arm lifts
  // away, so it is dropped from the torso rather than left behind.
  if (body) {
    for (let y = Math.round(J.neck[1]); y < body.y; y++) {
      const l = body.leftAt(y), r = body.rightAt(y);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (owner[i] === names.indexOf('spine') && (x < l || x > r)) owner[i] = -1;
      }
    }
  }
  reassignIslands(owner, data, W, H);

  // Parts grow a little under their neighbours, so a joint has artwork behind it when it opens.
  const grow = overlap ? Math.max(3, Math.round(torso * 0.025)) : 0;
  return names.map((n, k) => {
    // Bounding box of this part's pixels, grown for overlap.
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (owner[y * W + x] === k) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < x0) return null;
    x0 = Math.max(0, x0 - grow);
    y0 = Math.max(0, y0 - grow);
    x1 = Math.min(W - 1, x1 + grow);
    y1 = Math.min(H - 1, y1 + grow);
    const c = pieceCanvas(x1 - x0 + 1, y1 - y0 + 1);
    const g = c.getContext('2d');
    const out = g.createImageData(c.width, c.height);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (data[i * 4 + 3] < 8) continue;
        // Inside the part, or within `grow` pixels of it, growing only into parts it joins.
        if (owner[i] !== k && !JOINS[n].has(names[owner[i]])) continue;
        // The torso never grows outward past the body line (that would bring back armpit flaps).
        if (owner[i] !== k && n === 'spine' && body && y < body.y && (x < body.leftAt(y) || x > body.rightAt(y))) continue;
        let inside = owner[i] === k;
        for (let dy = -grow; grow && !inside && dy <= grow; dy += grow) {
          for (let dx = -grow; !inside && dx <= grow; dx += grow) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && owner[yy * W + xx] === k) inside = true;
          }
        }
        if (!inside) continue;
        const o = ((y - y0) * c.width + (x - x0)) * 4;
        out.data.set(data.subarray(i * 4, i * 4 + 4), o);
      }
    }
    g.putImageData(out, 0, 0);
    return { bone: n, canvas: c, x0, y0 };
  }).filter(Boolean);
}

// A part's cut edges that sit under a part drawn above it (the torso's side under an arm, its
// collar under the head) were never drawn, since they were hidden. Ink them in, so the body
// keeps an outline when a limb moves away. Edges on the drawing's own silhouette are left alone.
// mode 'ink': a black line (line art). 'shade': a slightly darker edge in the part's own colour
// (flat-colour art without outlines).
function inkHiddenEdges(pieces, img, torso, mode) {
  const W = img.width, H = img.height;
  const flat = pieceCanvas(W, H).getContext('2d', { willReadFrequently: true });
  flat.drawImage(img, 0, 0);
  const full = flat.getImageData(0, 0, W, H).data;

  // Which part is on top at each pixel, and each part's own alpha.
  const top = new Int8Array(W * H).fill(-1);
  const alphas = pieces.map((p, i) => {
    const a = p.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, p.canvas.width, p.canvas.height).data;
    for (let y = 0; y < p.canvas.height; y++) for (let x = 0; x < p.canvas.width; x++) {
      if (a[(y * p.canvas.width + x) * 4 + 3] > 40) {
        const X = x + p.x0, Y = y + p.y0;
        if (X < W && Y < H) top[Y * W + X] = i;
      }
    }
    return a;
  });

  const r = Math.max(1.5, torso * 0.008);
  pieces.forEach((p, i) => {
    const { width: w, height: h } = p.canvas;
    const a = alphas[i];
    const g = p.canvas.getContext('2d');
    g.fillStyle = '#111';
    const shade = (x, y) => {
      const o = (y * w + x) * 4;
      g.fillStyle = `rgb(${a[o] * 0.8 | 0},${a[o + 1] * 0.8 | 0},${a[o + 2] * 0.8 | 0})`;
    };
    const mine = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 40;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mine(x, y)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (mine(x + dx, y + dy)) continue;
        const X = x + dx + p.x0, Y = y + dy + p.y0;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        // A cut (the drawing continues there) covered by a part drawn above this one.
        if (full[(Y * W + X) * 4 + 3] > 40 && top[Y * W + X] > i) {
          if (mode === 'shade') shade(x, y);
          g.beginPath();
          g.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2);
          g.fill();
          break;
        }
      }
    }
  });
}

function bodyColumnOf(img, J, torso) {
  const g = pieceCanvas(img.width, img.height).getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return bodyColumn(g.getImageData(0, 0, img.width, img.height).data, img.width, img.height, J, torso);
}

// The torso's own width: the run of drawing on a row just above the hips (below the arms in an
// A- or T-pose) that contains the pelvis. Returns { left, right, y } or null if it can't tell.
function bodyColumn(data, W, H, J, torso) {
  const y = Math.round(J.pelvis[1] - torso * 0.15);
  const cx = Math.round(J.pelvis[0]);
  if (y < 0 || y >= H || cx < 0 || cx >= W) return null;
  const on = (x) => data[(y * W + x) * 4 + 3] > 40;
  if (!on(cx)) return null;
  let left = cx, right = cx;
  while (left > 0 && on(left - 1)) left--;
  while (right < W - 1 && on(right + 1)) right++;
  // If the arms hang into this row the run is too wide to be the torso: skip the rule.
  if (right - left > torso * 1.4) return null;
  // The body narrows from the hem up to the armpits: taper from just outside each shoulder
  // joint down to the measured hem width.
  const margin = 0; // the column edge is the drawn body line; the armpit shading belongs to the sleeve
  const taper = (top, bottom, yy, ty) => top + (bottom - top) * Math.min(1, Math.max(0, (yy - ty) / (y - ty)));
  const l0 = J.shoulderR[0] - torso * 0.04, r0 = J.shoulderL[0] + torso * 0.04;
  return {
    y,
    leftAt: (yy) => taper(l0, left, yy, J.shoulderR[1]) - margin,
    rightAt: (yy) => taper(r0, right, yy, J.shoulderL[1]) + margin,
  };
}

// Distance along segment a→b from a (negative before a), in pixels.
function alongSegment(x, y, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len = Math.hypot(vx, vy) || 1;
  return ((x - a[0]) * vx + (y - a[1]) * vy) / len;
}

// A part should be one connected piece. Any smaller island of a part (a hand that was given to
// the thigh because it hangs beside it, a bit of jacket hem) goes to the part it touches most.
function reassignIslands(owner, data, W, H) {
  const label = new Int32Array(W * H).fill(-1);
  const comps = []; // { part, pixels: [] }
  for (let start = 0; start < W * H; start++) {
    if (owner[start] < 0 || label[start] >= 0) continue;
    const part = owner[start];
    const id = comps.length;
    const pixels = [];
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      const x = p % W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
        if (q < 0 || q >= W * H || label[q] >= 0 || owner[q] !== part) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    comps.push({ part, pixels });
  }
  const biggest = {};
  for (const c of comps) if (!biggest[c.part] || c.pixels.length > biggest[c.part].pixels.length) biggest[c.part] = c;
  for (const c of comps) {
    if (biggest[c.part] === c) continue;
    const touches = {};
    for (const p of c.pixels) {
      const x = p % W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
        if (q < 0 || q >= W * H) continue;
        const o = owner[q];
        if (o >= 0 && o !== c.part) touches[o] = (touches[o] || 0) + 1;
      }
    }
    const best = Object.entries(touches).sort((a, b) => b[1] - a[1])[0];
    if (best) for (const p of c.pixels) owner[p] = Number(best[0]);
  }
}

function distToSegment(x, y, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(x - (a[0] + vx * t), y - (a[1] + vy * t));
}

// Skinning weights for a point on a piece carried by `bone`. Depends only on the position and
// the bone, so two overlapping pieces deform identically near the joint they share.
function weightsAt(x, y, bone, hinges) {
  let w = { [bone]: 1 };
  for (const h of hinges) {
    const dx = x - h.at[0], dy = y - h.at[1];
    const d = dx * h.dir[0] + dy * h.dir[1];
    const t = smooth(-h.r, h.r, d); // 0 = parent side, 1 = child side
    // Blend only around the joint itself. Without this, a strip of a limb that sits beside the
    // body (a sleeve's underarm, below the shoulder) stays half-tied to the body and stretches.
    const near = 1 - smooth(h.r, h.r * 1.8, Math.hypot(dx, dy));
    if (h.child === bone && !h.parentOnly) {
      const share = (1 - t) * near;
      w = scale(w, 1 - share);
      w[h.parent] = (w[h.parent] || 0) + share;
    } else if (h.parent === bone) {
      let c = t * near;
      if (h.side) c *= smooth(-h.side.band, h.side.band, (x - h.side.x) * h.side.sign);
      if (c > 0) {
        w = scale(w, 1 - c);
        w[h.child] = (w[h.child] || 0) + c;
      }
    }
  }
  return w;
}
const scale = (w, k) => Object.fromEntries(Object.entries(w).map(([b, v]) => [b, v * k]));

function buildMesh(piece, hinges, GRID) {
  const { canvas, x0, y0, bone } = piece;
  const w = canvas.width;
  const h = canvas.height;
  const alpha = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const nx = Math.ceil(w / GRID);
  const ny = Math.ceil(h / GRID);

  // Keep only cells with paint in them (plus one cell of margin).
  const filled = new Uint8Array(nx * ny);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (alpha[(y * w + x) * 4 + 3] > 0) filled[Math.floor(y / GRID) * nx + Math.floor(x / GRID)] = 1;
  }
  const use = new Uint8Array(nx * ny);
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
    if (!filled[cy * nx + cx]) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const X = cx + ox, Y = cy + oy;
      if (X >= 0 && Y >= 0 && X < nx && Y < ny) use[Y * nx + X] = 1;
    }
  }

  const vid = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const pos = [];
  const index = [];
  const vert = (gx, gy) => {
    const k = gy * (nx + 1) + gx;
    if (vid[k] < 0) {
      vid[k] = pos.length / 2;
      pos.push(Math.min(gx * GRID, w), Math.min(gy * GRID, h));
    }
    return vid[k];
  };
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
    if (!use[cy * nx + cx]) continue;
    const a = vert(cx, cy), b = vert(cx + 1, cy), c = vert(cx + 1, cy + 1), d = vert(cx, cy + 1);
    index.push(a, b, c, a, c, d);
  }

  const n = pos.length / 2;
  const uv = new Float32Array(n * 2);
  const img = new Float32Array(n * 2); // drawing-pixel coordinates
  const bones = new Uint8Array(n * 3);
  const weights = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const lx = pos[i * 2], ly = pos[i * 2 + 1];
    uv[i * 2] = lx / w;
    uv[i * 2 + 1] = ly / h;
    const X = lx + x0, Y = ly + y0;
    img[i * 2] = X;
    img[i * 2 + 1] = Y;
    const ws = Object.entries(weightsAt(X, Y, bone, hinges)).sort((p, q) => q[1] - p[1]).slice(0, 3);
    const total = ws.reduce((s, [, v]) => s + v, 0) || 1;
    ws.forEach(([b, v], k) => {
      bones[i * 3 + k] = BONE_INDEX[b];
      weights[i * 3 + k] = v / total;
    });
  }
  // Triangles whose three corners follow one bone only can be drawn in one go (2D fallback).
  const rigid = new Map();
  const blend = [];
  const single = (i) => (weights[i * 3] > 0.999 ? bones[i * 3] : -1);
  for (let t = 0; t < index.length; t += 3) {
    const b0 = single(index[t]);
    if (b0 >= 0 && b0 === single(index[t + 1]) && b0 === single(index[t + 2])) {
      if (!rigid.has(b0)) rigid.set(b0, []);
      rigid.get(b0).push(t);
    } else blend.push(t);
  }
  return { uv, img, bones, weights, index: new Uint16Array(index), count: n, out: new Float32Array(n * 2), rigid, blend };
}

function meshFor(puppet, piece, key) {
  if (!piece[key]) piece[key] = buildMesh(piece, puppet.hinges, key === 'mesh' ? GRID : GRID_2D);
  return piece[key];
}

// Linear blend skinning: each vertex is the weighted mix of its bones' transforms.
function skin(mesh, mats) {
  const { img, bones, weights, out, count } = mesh;
  for (let i = 0; i < count; i++) {
    const x = img[i * 2], y = img[i * 2 + 1];
    let ox = 0, oy = 0;
    for (let k = 0; k < 3; k++) {
      const wt = weights[i * 3 + k];
      if (!wt) continue;
      const m = mats[bones[i * 3 + k]];
      ox += wt * (m.a * x + m.c * y + m.e);
      oy += wt * (m.b * x + m.d * y + m.f);
    }
    out[i * 2] = ox;
    out[i * 2 + 1] = oy;
  }
}

// ---------------------------------------------------------------- posing

// Affine matrix (drawing pixels → stage pixels) for every bone in the current pose.
export function boneMatrices(puppet, rig, P) {
  const J = puppet.joints;
  const S = P.T / puppet.torso;
  const m = new Array(BONES.length);
  const make = (bone, anchor, at, angle, stretch) =>
    new DOMMatrix()
      .translate(at.x, at.y)
      .rotate(angle * DEG)
      .scale(S * stretch, S)
      .rotate(-puppet.rest[bone] * DEG)
      .translate(-anchor[0], -anchor[1]);

  for (const [name, from] of BONES.map(([n, f]) => [n, f])) {
    if (name === 'neck') continue;
    const stretch = name === 'spine' || name === 'shoulders' || name === 'hips' ? 1 : rig.ratio[name];
    m[BONE_INDEX[name]] = make(name, J[from], P[from], rig.angle[name], stretch);
  }
  // The head hinges at the base of the neck, carried by the torso.
  const pivot = m[BONE_INDEX.spine].transformPoint(new DOMPoint(J.headPivot[0], J.headPivot[1]));
  m[BONE_INDEX.neck] = make('neck', J.headPivot, { x: pivot.x, y: pivot.y }, rig.angle.neck + rig.face.roll * 0.6, 1);
  return m;
}

// ---------------------------------------------------------------- WebGL renderer

const VS = `#version 300 es
in vec2 a_pos; in vec2 a_uv; uniform vec2 u_res; out vec2 v_uv;
void main() { v_uv = a_uv; vec2 p = a_pos / u_res; gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_tex; uniform float u_alpha; out vec4 o;
void main() { o = texture(u_tex, v_uv) * u_alpha; }`;

export class PuppetRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = (this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: true }));
    if (!gl) throw new Error('WebGL2 is not available');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = (this.prog = gl.createProgram());
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    this.loc = {
      pos: gl.getAttribLocation(prog, 'a_pos'),
      uv: gl.getAttribLocation(prog, 'a_uv'),
      res: gl.getUniformLocation(prog, 'u_res'),
      alpha: gl.getUniformLocation(prog, 'u_alpha'),
    };
    this.uploaded = new WeakMap(); // piece -> GPU buffers
  }

  upload(piece, mesh) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, piece.canvas);
    gl.generateMipmap(gl.TEXTURE_2D); // smooth, flicker-free lines when the drawing is scaled down
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.out.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.loc.pos);
    gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, 0, 0);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.loc.uv);
    gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, 0, 0);
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const gpu = { tex, vao, posBuf };
    this.uploaded.set(piece, gpu);
    return gpu;
  }

  // Draw the posed puppet into this.canvas (same pixel size as the stage).
  render(puppet, mats, W, H) {
    const gl = this.gl;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniform2f(this.loc.res, W, H);
    gl.uniform1f(this.loc.alpha, 1);
    for (const piece of puppet.pieces) {
      const mesh = meshFor(puppet, piece, 'mesh');
      const gpu = this.uploaded.get(piece) || this.upload(piece, mesh);
      const { out, index } = mesh;
      skin(mesh, mats);
      this.post?.(puppet, piece, mesh, mats); // skinning variants and secondary motion, when the app sets it
      gl.bindVertexArray(gpu.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
      gl.bindTexture(gl.TEXTURE_2D, gpu.tex);
      gl.drawElements(gl.TRIANGLES, index.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }
}

// Plain-canvas fallback for browsers without WebGL2. The parts of each piece that follow a
// single bone are drawn with one clipped drawImage; only the joint zones are drawn per triangle.
export class CanvasRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.scaled = new WeakMap(); // piece -> copy resized to the current display scale
  }

  // A copy of the piece close to on-screen size: smoother lines than shrinking on every draw.
  texture(piece, k) {
    let t = this.scaled.get(piece);
    if (!t || Math.abs(t.k - k) / k > 0.15) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(piece.canvas.width * k));
      c.height = Math.max(1, Math.round(piece.canvas.height * k));
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(piece.canvas, 0, 0, c.width, c.height);
      t = { c, k };
      this.scaled.set(piece, t);
    }
    return t.c;
  }

  render(puppet, mats, W, H, S) {
    const ctx = this.ctx;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    const k = Math.min(1, Math.max(0.05, S * 1.25));
    for (const piece of puppet.pieces) {
      const mesh = meshFor(puppet, piece, 'mesh2d');
      skin(mesh, mats);
      this.post?.(puppet, piece, mesh, mats); // skinning variants and secondary motion, when the app sets it
      const tex = this.texture(piece, k);
      const { out, img, index } = mesh;
      const pw = piece.canvas.width;
      const ph = piece.canvas.height;

      for (const [bone, tris] of mesh.rigid) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        for (const t of tris) {
          const a = index[t] * 2, b = index[t + 1] * 2, c = index[t + 2] * 2;
          ctx.moveTo(out[a], out[a + 1]);
          ctx.lineTo(out[b], out[b + 1]);
          ctx.lineTo(out[c], out[c + 1]);
          ctx.closePath();
        }
        ctx.clip();
        ctx.setTransform(mats[bone]);
        ctx.drawImage(tex, piece.x0, piece.y0, pw, ph);
        ctx.restore();
      }

      for (const t of mesh.blend) {
        const ia = index[t] * 2, ib = index[t + 1] * 2, ic = index[t + 2] * 2;
        const d = [out[ia], out[ia + 1], out[ib], out[ib + 1], out[ic], out[ic + 1]];
        const s = [img[ia], img[ia + 1], img[ib], img[ib + 1], img[ic], img[ic + 1]];
        const m = triangleAffine(s, d);
        if (!m) continue;
        // Grow the clip a little so neighbouring triangles overlap and no hairline shows.
        const cx = (d[0] + d[2] + d[4]) / 3;
        const cy = (d[1] + d[3] + d[5]) / 3;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        for (let v = 0; v < 6; v += 2) {
          const dx = d[v] - cx, dy = d[v + 1] - cy;
          const l = Math.hypot(dx, dy) || 1;
          const x = d[v] + (dx / l) * 0.9, y = d[v + 1] + (dy / l) * 0.9;
          if (v) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.clip();
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.drawImage(tex, piece.x0, piece.y0, pw, ph);
        ctx.restore();
      }
    }
  }
}

// Affine transform taking source triangle s onto destination triangle d (flat [x0,y0,x1,y1,x2,y2]).
function triangleAffine(s, d) {
  const sx1 = s[2] - s[0], sy1 = s[3] - s[1], sx2 = s[4] - s[0], sy2 = s[5] - s[1];
  const den = sx1 * sy2 - sx2 * sy1;
  if (Math.abs(den) < 1e-9) return null;
  const dx1 = d[2] - d[0], dy1 = d[3] - d[1], dx2 = d[4] - d[0], dy2 = d[5] - d[1];
  const a = (dx1 * sy2 - dx2 * sy1) / den;
  const c = (dx2 * sx1 - dx1 * sx2) / den;
  const b = (dy1 * sy2 - dy2 * sy1) / den;
  const dd = (dy2 * sx1 - dy1 * sx2) / den;
  return [a, b, c, dd, d[0] - a * s[0] - c * s[1], d[1] - b * s[0] - dd * s[1]];
}

// WebGL2 when the browser has it, plain canvas otherwise.
export function createRenderer() {
  try {
    return new PuppetRenderer();
  } catch {
    return new CanvasRenderer();
  }
}

// Render the puppet onto a 2D stage context, with the face overlays on top.
// flip: mirror the whole character about its centre (a profile or turned view facing the other way).
export function drawPuppet(ctx, puppet, rig, P, renderer, alpha = 1, flip = false) {
  const mats = boneMatrices(puppet, rig, P);
  renderer.render(puppet, mats, ctx.canvas.width, ctx.canvas.height, P.T / puppet.torso);
  ctx.save();
  const mirror = flip ? new DOMMatrix().translate(2 * P.pelvis.x, 0).scale(-1, 1) : new DOMMatrix();
  ctx.setTransform(mirror);
  ctx.globalAlpha = alpha;
  ctx.drawImage(renderer.canvas, 0, 0);
  ctx.setTransform(mirror.multiply(mats[BONE_INDEX.neck]));
  drawFace(ctx, puppet.face, rig.face);
  ctx.restore();
}

// Blink and mouth-open drawn over the face, in drawing pixels. Colours come from the character's
// face settings: lid (eyelid fill), lidLine, mouthCover (null to leave beard/moustache alone)
// and mouthColor; the defaults suit black-and-white line art.
function drawFace(ctx, face, f) {
  if (!face) return;
  const lid = face.lid || '#fff';
  const lidLine = face.lidLine || '#0a0a0a';
  const cover = face.mouthCover === undefined ? '#fff' : face.mouthCover;
  const mouthColor = face.mouthColor || '#0a0a0a';
  const blinks = [f.blinkR, f.blinkL];
  (face.eyes || []).forEach(([x, y, w], i) => {
    if (blinks[i] < 0.5) return;
    ctx.fillStyle = lid;
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.45, Math.max(7, w * 0.28), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = lidLine;
    ctx.lineWidth = Math.max(3, w * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.38, y + 1);
    ctx.quadraticCurveTo(x, y + w * 0.08, x + w * 0.38, y + 1);
    ctx.stroke();
  });
  if (face.mouth && f.jaw > 0.12) {
    const [x, y, w] = face.mouth;
    if (cover) {
      ctx.fillStyle = cover;
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.58, Math.max(8, w * 0.1), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = mouthColor;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, w * (0.22 + f.smile * 0.1), 2 + f.jaw * Math.max(11, w * 0.16), 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
