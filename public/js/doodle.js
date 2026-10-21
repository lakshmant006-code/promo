// "Doodle": the red-beanie character, rebuilt as separate hand-built vector parts instead of one
// cropped picture. Every limb is a tapered shape drawn along its bone with round joints, so an
// arm or a leg can swing anywhere (side, back, lifted knee) and nothing tears.
// The body turn (rig.face.turn: 0 = facing you, ±1 = side on, ±2 = back to you) changes the
// shapes: the jacket narrows, the far arm hides behind it, the shoes point the way you face, and
// the head turns with its profile, glasses and beard. Colours match the original artwork.
const PI = Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const DOODLE_COLORS = {
  skin: '#F49640', skinHi: '#FAAE5C', skinSh: '#DB8035',
  red: '#D82840', redHi: '#EA3A50', redSh: '#B01B33', redDk: '#961530',
  hat: '#CD2040', hatHi: '#E43350', hatSh: '#A9142F',
  hair: '#23253B', glass: '#1B2B6B', lens: 'rgba(252,176,98,.38)',
  jeans: '#2063B9', jeansHi: '#2F76CF', jeansSh: '#164E9E', cuff: '#5B91D3', cuffSh: '#4A7FC3',
  shoe: '#F8ECD9', shoeSh: '#E3D0B2', navy: '#123E8C', tee: '#FBF1E7', collar: '#1D3F94', ink: '#3A1F26',
};
const C = DOODLE_COLORS;

const lin = (ctx, a, b, stops) => {
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
};
const unit = (a, b) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d, d };
};

// A tapered limb: round at both ends, so joints never open.
function limb(ctx, a, b, ra, rb, stops) {
  const u = unit(a, b);
  const ang = Math.atan2(u.y, u.x);
  const k = Math.acos(clamp((ra - rb) / Math.max(u.d, 1e-6), -1, 1));
  const n = { x: -u.y, y: u.x };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const r = Math.max(ra, rb);
  ctx.beginPath();
  ctx.arc(a.x, a.y, ra, ang + k, ang - k + 2 * PI, false);
  ctx.arc(b.x, b.y, rb, ang - k, ang + k, false);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, { x: m.x + n.x * r, y: m.y + n.y * r }, { x: m.x - n.x * r, y: m.y - n.y * r }, stops);
  ctx.fill();
}
const blob = (ctx, x, y, rx, ry, rot, fill) => {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, 2 * PI);
  ctx.fillStyle = fill;
  ctx.fill();
};

export function drawDoodle(ctx, rig, P, { alpha = 1 } = {}) {
  const T = P.T;
  const f = rig.face;
  const turn = clamp(f.turn || 0, -2, 2);
  const th = (turn * PI) / 2; // body turn in radians
  const c = Math.cos(th); // 1 front, 0 side, -1 back
  const ac = Math.abs(c);
  const facing = turn >= 0 ? 1 : -1; // which way the character faces when seen side on (+1 = screen right)
  const near = facing > 0 ? 'R' : 'L';
  const far = near === 'R' ? 'L' : 'R';

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Ground shadow
  ctx.fillStyle = 'rgba(30,30,60,.12)';
  ctx.beginPath();
  ctx.ellipse(P.pelvis.x, Math.max(P.ankleL.y, P.ankleR.y) + T * 0.1, T * (0.5 + 0.2 * ac), T * 0.09, 0, 0, 2 * PI);
  ctx.fill();

  // ---- legs ----
  const hipR = (s) => P['hip' + s], knee = (s) => P['knee' + s], ankle = (s) => P['ankle' + s];
  const legRad = T * (0.225 - 0.03 * ac);
  const drawLeg = (s) => {
    const h = hipR(s), k = knee(s), a = ankle(s);
    limb(ctx, h, k, legRad, legRad * 0.84, [C.jeansHi, C.jeans, C.jeansSh]);
    limb(ctx, k, a, legRad * 0.84, legRad * 0.7, [C.jeansHi, C.jeans, C.jeansSh]);
    // rolled cuff
    const u = unit(k, a);
    const cs = { x: a.x - u.x * T * 0.13, y: a.y - u.y * T * 0.13 };
    limb(ctx, cs, a, legRad * 0.74, legRad * 0.74, [C.cuff, C.cuff, C.cuffSh]);
    // shoe: points the way the body faces, tilts with the shin
    const tilt = Math.atan2(u.y, u.x) - PI / 2;
    const outward = s === 'R' ? -1 : 1;
    const side = 1 - ac;
    const len = T * (0.13 + 0.12 * side + (c < 0 ? 0.0 : 0.02));
    const off = facing * side * T * 0.1 * (c >= 0 ? 1 : 1) + outward * ac * T * 0.045;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(tilt * 0.8);
    ctx.translate(off, T * 0.07);
    blob(ctx, 0, 0, len, T * 0.085, 0, lin(ctx, { x: 0, y: -T * 0.09 }, { x: 0, y: T * 0.09 }, [C.shoe, C.shoe, C.shoeSh]));
    // soles and the navy side patch
    ctx.beginPath();
    ctx.ellipse(0, T * 0.045, len, T * 0.04, 0, 0, PI);
    ctx.fillStyle = C.shoeSh;
    ctx.fill();
    if (c >= -0.2) blob(ctx, -facing * side * len * 0.1 + outward * ac * len * 0.2, -T * 0.005, len * 0.22, T * 0.045, 0.5 * outward, C.navy);
    ctx.restore();
  };
  drawLeg(far);
  drawLeg(near);

  // hips: closes the gap between the two legs
  limb(ctx, P.hipR, P.hipL, legRad * 1.02, legRad * 1.02, [C.jeansHi, C.jeans, C.jeansSh]);

  // ---- torso frame ----
  const N = P.neck, Pm = P.pelvis;
  const u = unit(N, Pm); // down the spine
  const nSpine = { x: u.y, y: -u.x };
  const nShoulder = unit(P.shoulderR, P.shoulderL);
  const w = clamp(ac * 1.5, 0, 1);
  let nx = nSpine.x * (1 - w) + nShoulder.x * w, ny = nSpine.y * (1 - w) + nShoulder.y * w;
  if (nx * nSpine.x + ny * nSpine.y < 0) { nx = -nx; ny = -ny; } // keep it pointing the same way as the spine's side
  const nl = Math.hypot(nx, ny) || 1;
  const n = { x: nx / nl, y: ny / nl };
  const hwTop = T * (0.3 + 0.17 * ac);
  const hwBot = hwTop * 1.1;
  const top = { x: N.x - u.x * T * 0.02, y: N.y - u.y * T * 0.02 };
  const bot = { x: Pm.x + u.x * T * 0.16, y: Pm.y + u.y * T * 0.16 };
  const TL = { x: top.x - n.x * hwTop, y: top.y - n.y * hwTop }, TR = { x: top.x + n.x * hwTop, y: top.y + n.y * hwTop };
  const BL = { x: bot.x - n.x * hwBot, y: bot.y - n.y * hwBot }, BR = { x: bot.x + n.x * hwBot, y: bot.y + n.y * hwBot };

  // ---- neck ----
  limb(ctx, N, P.head, T * 0.1, T * 0.1, [C.skinHi, C.skin, C.skinSh]);

  // ---- arms ----
  const upR = T * 0.14, fR = T * 0.115;
  const drawArm = (s) => {
    const sh = P['shoulder' + s], el = P['elbow' + s], wr = P['wrist' + s];
    limb(ctx, sh, el, upR, upR * 0.92, [C.redHi, C.red, C.redSh]);
    limb(ctx, el, wr, fR * 1.05, fR * 0.9, [C.redHi, C.red, C.redSh]);
    const uf = unit(el, wr);
    // ribbed cuff
    limb(ctx, { x: wr.x - uf.x * T * 0.07, y: wr.y - uf.y * T * 0.07 }, wr, fR * 0.95, fR * 0.95, [C.redSh, C.redDk, C.redDk]);
    // hand, unless it is tucked into a pocket
    const hp = P['hip' + s];
    const tucked = Math.hypot(wr.x - hp.x, wr.y - hp.y) < T * 0.26 && wr.y > P.pelvis.y - T * 0.25;
    if (!tucked) {
      const hx = wr.x + uf.x * T * 0.09, hy = wr.y + uf.y * T * 0.09;
      const ang = Math.atan2(uf.y, uf.x);
      const side = s === 'R' ? -1 : 1;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(ang - PI / 2);
      const sq = 0.7 + 0.3 * ac; // a hand seen edge-on is narrower
      blob(ctx, 0, 0, T * 0.075 * sq, T * 0.1, 0, lin(ctx, { x: -T * 0.07, y: 0 }, { x: T * 0.07, y: 0 }, [C.skinHi, C.skin, C.skinSh]));
      blob(ctx, side * T * 0.07 * sq, -T * 0.01, T * 0.032, T * 0.065, side * 0.5, C.skin); // thumb
      ctx.restore();
    }
  };

  const sideOn = ac < 0.55;
  if (sideOn) drawArm(far); // the far arm hides behind the body

  // ---- torso (jacket) ----
  const bodyFill = lin(ctx, TL, TR, [C.redHi, C.red, C.redSh]);
  const mid = { x: (top.x + bot.x) / 2, y: (top.y + bot.y) / 2 };
  const bulge = hwTop * 1.14;
  const sl = (p, k) => ({ x: p.x + u.x * T * k, y: p.y + u.y * T * k });
  ctx.beginPath();
  ctx.moveTo(top.x - n.x * hwTop * 0.5, top.y - n.y * hwTop * 0.5);
  ctx.quadraticCurveTo(TL.x, TL.y, sl(TL, 0.12).x, sl(TL, 0.12).y);
  ctx.quadraticCurveTo(mid.x - n.x * bulge * 1.1, mid.y - n.y * bulge * 1.1, BL.x, BL.y);
  ctx.lineTo(BR.x, BR.y);
  ctx.quadraticCurveTo(mid.x + n.x * bulge * 1.1, mid.y + n.y * bulge * 1.1, sl(TR, 0.12).x, sl(TR, 0.12).y);
  ctx.quadraticCurveTo(TR.x, TR.y, top.x + n.x * hwTop * 0.5, top.y + n.y * hwTop * 0.5);
  ctx.closePath();
  ctx.fillStyle = bodyFill;
  ctx.strokeStyle = bodyFill;
  ctx.lineWidth = T * 0.08;
  ctx.fill();
  ctx.stroke();
  // ribbed hem
  const hemA = { x: bot.x - u.x * T * 0.07 - n.x * hwBot, y: bot.y - u.y * T * 0.07 - n.y * hwBot };
  const hemB = { x: bot.x - u.x * T * 0.07 + n.x * hwBot, y: bot.y - u.y * T * 0.07 + n.y * hwBot };
  ctx.beginPath();
  ctx.moveTo(hemA.x, hemA.y);
  ctx.lineTo(hemB.x, hemB.y);
  ctx.lineTo(BR.x, BR.y);
  ctx.lineTo(BL.x, BL.y);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, BL, BR, [C.redSh, C.redDk, C.redDk]);
  ctx.fill();
  // front: tee, collar, zip. back: collar only.
  if (c > 0.15) {
    const a = clamp((c - 0.15) / 0.5, 0, 1);
    ctx.globalAlpha = alpha * a;
    const ctr = { x: top.x + u.x * T * 0.04, y: top.y + u.y * T * 0.04 };
    ctx.beginPath();
    ctx.moveTo(ctr.x - n.x * T * 0.12, ctr.y - n.y * T * 0.12);
    ctx.lineTo(ctr.x + n.x * T * 0.12, ctr.y + n.y * T * 0.12);
    ctx.lineTo(ctr.x + u.x * T * 0.34, ctr.y + u.y * T * 0.34);
    ctx.closePath();
    ctx.fillStyle = C.tee;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = T * 0.018;
    ctx.beginPath();
    ctx.moveTo(ctr.x + u.x * T * 0.34, ctr.y + u.y * T * 0.34);
    ctx.lineTo(hemA.x * 0.5 + hemB.x * 0.5, hemA.y * 0.5 + hemB.y * 0.5);
    ctx.stroke();
    blob(ctx, ctr.x + u.x * T * 0.4, ctr.y + u.y * T * 0.4, T * 0.022, T * 0.03, 0, '#fff');
    ctx.globalAlpha = alpha;
  }
  // collar: two navy flaps around the neck
  for (const sgn of [-1, 1]) {
    const base = { x: top.x + n.x * sgn * T * 0.05, y: top.y + n.y * sgn * T * 0.05 };
    const tip = { x: top.x + n.x * sgn * T * (0.16 * (0.5 + 0.5 * ac)) + u.x * T * 0.16 * Math.max(c, 0.1), y: top.y + n.y * sgn * T * (0.16 * (0.5 + 0.5 * ac)) + u.y * T * 0.16 * Math.max(c, 0.1) };
    limb(ctx, base, tip, T * 0.045, T * 0.03, [C.collar, C.collar, C.navy]);
  }
  // pocket hint on the jeans side view not needed; far leg already drawn.

  // ---- head ----
  drawHead(ctx, rig, P, th, c, facing, alpha);

  // ---- near arms in front ----
  if (sideOn) drawArm(near);
  else {
    drawArm(far);
    drawArm(near);
  }
  ctx.restore();
}

// Head with beanie, curly hair, glasses, moustache and goatee. Features are placed on a sphere and
// turned by the body turn plus a little of the face turn, so profile and back views come for free.
function drawHead(ctx, rig, P, bodyTh, c, facing, alpha) {
  const { T } = P;
  const f = rig.face;
  const R = T * 0.37;
  const th = bodyTh + (f.yaw || 0) * 0.45;
  const ct = Math.cos(th), st = Math.sin(th);
  const proj = (x, y, z) => ({ x: x * ct + z * st - 0.0, y, z: -x * st + z * ct });
  const sx = (v) => v * R;
  const hx = P.head.x, hy = P.head.y;
  const tiltBase = Math.atan2(P.head.x - P.neck.x, -(P.head.y - P.neck.y));

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate((tiltBase + (f.roll || 0)) * 0.9);

  const front = ct; // > 0 face toward us
  // ears (behind the face)
  for (const s of [-1, 1]) {
    const e = proj(0.84 * s, 0.14, 0);
    if (e.z > -0.35) {
      blob(ctx, sx(e.x), sx(e.y), sx(0.13), sx(0.19), 0, C.skin);
      blob(ctx, sx(e.x), sx(e.y), sx(0.07), sx(0.11), 0, C.skinSh);
    }
  }
  // hair behind the head
  blob(ctx, sx(-0.16 * st), sx(-0.05), sx(0.9), sx(1.0), 0, C.hair);
  // skin: in profile the face sits forward of the back of the head
  const rx = 0.8 - 0.1 * Math.abs(st);
  const skx = 0.3 * st;
  blob(ctx, sx(skx), sx(0.05), sx(rx), sx(0.93), 0, lin(ctx, { x: sx(skx - rx), y: 0 }, { x: sx(skx + rx), y: 0 }, [C.skinHi, C.skin, C.skinSh]));
  // chin and jaw roundness
  // curly hair at the sides and under the beanie
  for (const s of [-1, 1]) {
    const p = proj(0.78 * s, -0.12, 0.2);
    blob(ctx, sx(p.x), sx(p.y), sx(0.2), sx(0.3), 0.15 * s, C.hair);
    blob(ctx, sx(p.x * 1.02), sx(p.y + 0.3), sx(0.15), sx(0.14), 0, C.hair);
  }
  if (front < -0.1) {
    // back of the head: hair covers the face area
    ctx.globalAlpha = alpha * clamp((-front - 0.1) * 3, 0, 1);
    blob(ctx, 0, sx(0.05), sx(0.86), sx(0.96), 0, C.hair);
    blob(ctx, 0, sx(0.62), sx(0.62), sx(0.3), 0, C.hair);
    ctx.globalAlpha = alpha;
  }

  if (front > -0.5) {
    // nose
    const nz = proj(0, 0.2, 1.02);
    if (nz.z > -0.1) blob(ctx, sx(nz.x), sx(nz.y), sx(0.13), sx(0.15), 0, C.skinHi);
    // brows, eyes, glasses
    const lensW = 0.2, lensH = 0.17;
    const eyes = [];
    for (const s of [-1, 1]) {
      const p = proj(0.34 * s, -0.04, 0.82);
      if (p.z < 0.02) continue;
      eyes.push({ p, s });
      const w = lensW * Math.max(0.35, Math.abs(ct)) * (p.z > 0.2 ? 1 : p.z / 0.2 + 0.4);
      const blink = s === 1 ? f.blinkL : f.blinkR;
      // lens
      ctx.beginPath();
      ctx.ellipse(sx(p.x), sx(p.y), sx(w * 1.05), sx(lensH * 1.0), 0, 0, 2 * PI);
      ctx.fillStyle = C.lens;
      ctx.fill();
      ctx.lineWidth = R * 0.075;
      ctx.strokeStyle = C.glass;
      ctx.stroke();
      // eye
      const open = Math.max(0.08, 1 - clamp(blink * 1.3, 0, 1));
      blob(ctx, sx(p.x), sx(p.y), sx(0.055 * Math.max(0.5, Math.abs(ct))), sx(0.075 * open), 0, C.ink);
      // brow
      const by = p.y - 0.27 - (f.browUp || 0) * 0.1;
      ctx.strokeStyle = C.hair;
      ctx.lineWidth = R * 0.085;
      ctx.beginPath();
      ctx.moveTo(sx(p.x - w * 1.1), sx(by + 0.02));
      ctx.lineTo(sx(p.x + w * 1.1), sx(by - 0.01));
      ctx.stroke();
    }
    if (eyes.length === 2) {
      ctx.strokeStyle = C.glass;
      ctx.lineWidth = R * 0.07;
      ctx.beginPath();
      ctx.moveTo(sx(eyes[0].p.x + lensW * Math.max(0.35, Math.abs(ct))), sx(eyes[0].p.y - 0.02));
      ctx.lineTo(sx(eyes[1].p.x - lensW * Math.max(0.35, Math.abs(ct))), sx(eyes[1].p.y - 0.02));
      ctx.stroke();
    }
    if (eyes.length === 1 || Math.abs(st) > 0.45) {
      // temple arm from the near lens toward the ear
      const e = eyes.reduce((a, b) => (a && a.p.z > b.p.z ? a : b), null);
      if (e) {
        const ear = proj(0.84 * e.s, 0.1, 0);
        ctx.strokeStyle = C.glass;
        ctx.lineWidth = R * 0.07;
        ctx.beginPath();
        ctx.moveTo(sx(e.p.x + (ear.x > e.p.x ? 1 : -1) * 0.1), sx(e.p.y));
        ctx.lineTo(sx(ear.x), sx(ear.y - 0.04));
        ctx.stroke();
      }
    }
    // moustache, mouth, goatee
    const mo = proj(0, 0.4, 0.97);
    const mw = 0.3 * Math.max(0.4, Math.abs(ct)) + 0.07 * Math.abs(st);
    if (mo.z > -0.05) {
      const jaw = f.jaw || 0;
      const smile = f.smile || 0;
      const my = mo.y + 0.17;
      // mouth
      if (jaw > 0.08) {
        blob(ctx, sx(mo.x), sx(my + jaw * 0.05), sx(mw * 0.55), sx(0.05 + jaw * 0.22), 0, '#3B1D22');
        blob(ctx, sx(mo.x), sx(my + jaw * 0.14), sx(mw * 0.35), sx(jaw * 0.1), 0, '#C5505B');
      } else {
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = R * 0.05;
        ctx.beginPath();
        ctx.moveTo(sx(mo.x - mw * 0.55), sx(my - smile * 0.05));
        ctx.quadraticCurveTo(sx(mo.x), sx(my + 0.04 + smile * 0.1), sx(mo.x + mw * 0.55), sx(my - smile * 0.05));
        ctx.stroke();
      }
      // moustache
      ctx.fillStyle = C.hair;
      ctx.beginPath();
      ctx.ellipse(sx(mo.x - mw * 0.42), sx(mo.y), sx(mw * 0.5), sx(0.085), -0.25, 0, 2 * PI);
      ctx.ellipse(sx(mo.x + mw * 0.42), sx(mo.y), sx(mw * 0.5), sx(0.085), 0.25, 0, 2 * PI);
      ctx.fill();
      // goatee
      const gt = proj(0, 0.8, 0.86);
      blob(ctx, sx(gt.x), sx(gt.y + jaw * 0.12), sx(0.16 * Math.max(0.5, Math.abs(ct)) + 0.05), sx(0.17), 0, C.hair);
    }
    ctx.globalAlpha = alpha;
  }

  // beanie
  const hatOff = st * R * 0.1;
  const domeW = 0.98, cuffTop = -0.5, cuffBot = -0.16;
  ctx.beginPath();
  ctx.moveTo(sx(-domeW) + hatOff, sx(cuffTop));
  ctx.bezierCurveTo(sx(-1.12) + hatOff, sx(-1.5), sx(1.12) + hatOff, sx(-1.5), sx(domeW) + hatOff, sx(cuffTop));
  ctx.closePath();
  ctx.fillStyle = lin(ctx, { x: -sx(1), y: -sx(1.3) }, { x: sx(1), y: sx(-0.3) }, [C.hatHi, C.hat, C.hatSh]);
  ctx.fill();
  // cuff band
  ctx.beginPath();
  ctx.moveTo(sx(-1.0) + hatOff, sx(cuffTop));
  ctx.lineTo(sx(1.0) + hatOff, sx(cuffTop));
  ctx.quadraticCurveTo(sx(1.06) + hatOff, sx((cuffTop + cuffBot) / 2), sx(0.98) + hatOff, sx(cuffBot));
  ctx.quadraticCurveTo(sx(0) + hatOff, sx(cuffBot + 0.08 * Math.max(0, front)), sx(-0.98) + hatOff, sx(cuffBot));
  ctx.quadraticCurveTo(sx(-1.06) + hatOff, sx((cuffTop + cuffBot) / 2), sx(-1.0) + hatOff, sx(cuffTop));
  ctx.closePath();
  ctx.fillStyle = lin(ctx, { x: 0, y: sx(cuffTop) }, { x: 0, y: sx(cuffBot) }, [C.hat, C.hatSh]);
  ctx.fill();
  // knit ribs
  ctx.strokeStyle = 'rgba(120,10,35,.35)';
  ctx.lineWidth = R * 0.03;
  for (let i = -4; i <= 4; i++) {
    const x = i * 0.2;
    ctx.beginPath();
    ctx.moveTo(sx(x) + hatOff, sx(cuffTop + 0.03));
    ctx.lineTo(sx(x) + hatOff, sx(cuffBot - 0.02));
    ctx.stroke();
  }
  ctx.restore();
}
