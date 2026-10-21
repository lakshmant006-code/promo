// Rig Lab: a prototyping panel beside the iPad for testing deformation and motion. Test poses
// and slow sweeps drive the rig through its springs exactly like tracking would, so you can
// compare skinning methods, overlap and pins, primary springs and cloth on the same extremes.
const $ = (id) => document.getElementById(id);
const PI = Math.PI;
const DEG = PI / 180;

// Each test returns bone-angle overrides (and an optional body offset) for time t (seconds).
// rest: the character's rest angles. Angles are on screen: +90° points down, -90° up.
const TESTS = {
  rest: () => ({}),
  tiltL: (rest) => ({ neck: rest.neck - 45 * DEG }),
  tiltR: (rest) => ({ neck: rest.neck + 45 * DEG }),
  liftR: () => ({ upperArmR: -PI / 2 - 0.35, foreArmR: -PI / 2 - 0.2 }),
  liftL: () => ({ upperArmL: -PI / 2 + 0.35, foreArmL: -PI / 2 + 0.2 }),
  armsUp: () => ({ upperArmR: -PI / 2 - 0.35, foreArmR: -PI / 2 - 0.15, upperArmL: -PI / 2 + 0.35, foreArmL: -PI / 2 + 0.15 }),
  armsDown: () => ({ upperArmR: PI / 2 + 0.15, foreArmR: PI / 2 + 0.1, upperArmL: PI / 2 - 0.15, foreArmL: PI / 2 - 0.1 }),
  cross: () => ({ upperArmR: PI / 2 - 0.55, foreArmR: -0.25, upperArmL: PI / 2 + 0.55, foreArmL: PI + 0.25 }),
  elbows: () => ({ upperArmR: PI / 2 + 0.25, foreArmR: -PI / 2 - 0.2, upperArmL: PI / 2 - 0.25, foreArmL: -PI / 2 + 0.2 }),
  squat: () => ({ thighR: PI / 2 + 0.95, shinR: PI / 2 - 0.45, thighL: PI / 2 - 0.95, shinL: PI / 2 + 0.45, offset: { x: 0, y: 0.45 } }),
  // Slow sweeps, for judging motion rather than still poses.
  sweepTilt: (rest, t) => ({ neck: rest.neck + 45 * DEG * Math.sin((t * TAU) / 4) }),
  sweepArm: (rest, t) => {
    const u = (1 - Math.cos((t * TAU) / 3.5)) / 2; // 0 down .. 1 up
    return { upperArmR: lerpA(PI / 2 + 0.15, -PI / 2 - 0.35, u), foreArmR: lerpA(PI / 2 + 0.1, -PI / 2 - 0.2, u) };
  },
  walk: (rest, t) => walkPose(rest, t, false),
  walkMarch: (rest, t) => walkPose(rest, t, true),
  sweepSquat: (rest, t) => {
    const u = (1 - Math.cos((t * TAU) / 3)) / 2;
    return { thighR: PI / 2 + 0.95 * u, shinR: PI / 2 - 0.45 * u, thighL: PI / 2 - 0.95 * u, shinL: PI / 2 + 0.45 * u, offset: { x: 0, y: 0.45 * u } };
  },
};
const TAU = PI * 2;

// A walk cycle in screen angles (+90° = pointing down), for a character facing right.
// φ is the cycle phase; each leg is half a cycle behind the other, and each arm swings against
// the leg on its own side. The springs in motion.js add the ease-in/out and follow-through.
function walk(t, speed, stride, march = false) {
  const phi = TAU * speed * t;
  const A = (march ? 0.34 : 0.42) * stride; // thigh swing
  const F = (march ? 1.35 : 0.95) * stride; // knee bend on the way through
  const B = 0.34 * stride; // arm swing
  const leg = (psi) => {
    const swing = Math.sin(psi);
    const thigh = PI / 2 - A * swing - (march ? 0.35 * Math.max(0, Math.cos(psi)) : 0);
    const flex = F * Math.pow(Math.max(0, Math.cos(psi)), 1.3) + 0.12 * Math.max(0, -Math.cos(psi));
    return [thigh, thigh + flex];
  };
  const arm = (psi) => {
    const swing = Math.sin(psi + PI); // the arm moves against its own leg
    const upper = PI / 2 - B * swing;
    return [upper, upper - (0.3 + 0.45 * Math.max(0, swing))];
  };
  const [tR, sR] = leg(phi), [tL, sL] = leg(phi + PI);
  const [uR, fR] = arm(phi), [uL, fL] = arm(phi + PI);
  return {
    thighR: tR, shinR: sR, thighL: tL, shinL: sL,
    upperArmR: uR, foreArmR: fR, upperArmL: uL, foreArmL: fL,
    // The body rises as the legs pass under it and dips at full stride, and leans a little into the step.
    spine: null, // set by the caller from the rest angle
    lean: 0.06 + 0.015 * Math.cos(2 * phi),
    offset: { x: 0, y: -0.028 * stride * Math.cos(2 * phi) },
  };
}
const lerpA = (a, b, u) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * u;

// A walk cycle as bone overrides. Walks are drawn in profile, so they ask for the side view.
function walkPose(rest, t, march) {
  const w = walk(t, Number($('labWalk').value), Number($('labStride').value), march);
  const { lean, offset, spine, ...bones } = w;
  return { ...bones, spine: rest.spine + lean, offset, view: 'side' };
}

const PLAN = [
  'Turn primary springs and cloth off',
  'Fix the head, neck and collar: overlap artwork and weighted vertices',
  'Test slow 45° head tilts both ways',
  'Fix the shoulders the same way while lifting each arm',
  'Re-run the poses with shape preservation on',
  'Only then enable secondary springs and tune damping',
];

export function createLab({ onTest, onRebuild, onCorrective, getStatus }) {
  let active = null; // current test id, or null for the camera / demo
  let t0 = 0;

  // ---- open / close ----
  function setOpen(open) {
    document.body.classList.toggle('lab-open', open);
    try { localStorage.setItem('rig.labOpen', open ? '1' : '0'); } catch {}
    dispatchEvent(new Event('resize')); // the iPad refits beside the panel
  }
  $('labToggle').addEventListener('click', () => setOpen(!document.body.classList.contains('lab-open')));
  $('labClose').addEventListener('click', () => setOpen(false));
  let open = true;
  try { open = localStorage.getItem('rig.labOpen') !== '0'; } catch {}
  setOpen(open);

  // ---- segmented skinning method ----
  for (const b of document.querySelectorAll('#labSkin button')) {
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('#labSkin button')) x.classList.toggle('active', x === b);
      try { localStorage.setItem('rig.skin', b.dataset.skin); } catch {}
    });
  }
  let skin = 'mush';
  try { skin = localStorage.getItem('rig.skin') || 'mush'; } catch {}
  skin = new URLSearchParams(location.search).get('skin') || skin; // ?skin=rigid|weighted|mush, for test renders
  for (const x of document.querySelectorAll('#labSkin button')) x.classList.toggle('active', x.dataset.skin === skin);

  $('labOverlap').addEventListener('input', () => onRebuild());

  // ---- character view ----
  const query = new URLSearchParams(location.search); // ?view=side&test=walk&t=0.3&flip=1, for test renders
  let viewMode = 'auto';
  try { viewMode = localStorage.getItem('rig.viewMode') || 'auto'; } catch {}
  viewMode = query.get('view') || viewMode;
  if (query.get('flip')) $('labFlip').checked = true;
  const paintView = () => {
    for (const b of document.querySelectorAll('#labView button')) b.classList.toggle('active', b.dataset.view === viewMode);
    $('labViewNote').textContent = viewMode === 'auto' ? 'Auto follows how far your body turns from the camera.' : `Locked to the ${viewMode === 'threequarter' ? 'three-quarter' : viewMode} view.`;
  };
  for (const b of document.querySelectorAll('#labView button')) {
    b.addEventListener('click', () => {
      viewMode = b.dataset.view;
      try { localStorage.setItem('rig.viewMode', viewMode); } catch {}
      paintView();
    });
  }
  paintView();
  for (const id of ['labWalk', 'labStride']) {
    const el = $(id), out = $(id + 'Out');
    const show = () => (out.textContent = id === 'labWalk' ? `${Number(el.value).toFixed(2)} cycles/s` : `${Math.round(el.value * 100)}%`);
    el.addEventListener('input', show);
    show();
  }

  // ---- test poses ----
  function setTest(id) {
    active = id;
    t0 = performance.now();
    for (const b of document.querySelectorAll('#labTests button[data-test]')) b.classList.toggle('active', b.dataset.test === id);
    $('labRelease').disabled = !id;
    onTest(id);
  }
  for (const b of document.querySelectorAll('#labTests button[data-test]')) {
    b.addEventListener('click', () => setTest(active === b.dataset.test ? null : b.dataset.test));
  }
  $('labRelease').addEventListener('click', () => setTest(null));
  $('labCorrective').addEventListener('click', () => onCorrective());

  // ---- test plan checklist ----
  let done = [];
  try { done = JSON.parse(localStorage.getItem('rig.labPlan') || '[]'); } catch {}
  $('labPlan').innerHTML = PLAN.map((p, i) => `<label class="lab-step"><input type="checkbox" data-i="${i}" ${done[i] ? 'checked' : ''}><span>${i + 1}. ${p}</span></label>`).join('');
  for (const c of document.querySelectorAll('#labPlan input')) {
    c.addEventListener('input', () => {
      done[c.dataset.i] = c.checked;
      try { localStorage.setItem('rig.labPlan', JSON.stringify(done)); } catch {}
    });
  }

  // ---- copy configuration ----
  $('labCopy').addEventListener('click', async () => {
    const text = configText();
    try {
      await navigator.clipboard.writeText(text);
      $('labCopy').textContent = 'Copied';
    } catch {
      $('labConfigOut').textContent = text; // clipboard blocked: show it to copy by hand
      $('labCopy').textContent = 'Shown below';
    }
    setTimeout(() => ($('labCopy').textContent = 'Copy test configuration'), 1500);
  });

  function settings() {
    return {
      skin: document.querySelector('#labSkin button.active')?.dataset.skin || 'mush',
      overlap: $('labOverlap').checked,
      preserve: $('labPreserve').checked,
      springs: $('labSprings').checked,
      secondary: Number($('labSecondary').value),
      view: viewMode,
      flip: $('labFlip').checked,
      turnInvert: $('labTurnInvert').checked,
    };
  }

  function configText() {
    const s = settings();
    const st = getStatus();
    const names = { rigid: 'Rigid cutout pieces', weighted: 'Weighted mesh skinning', mush: 'Weighted mesh + shape preservation (Delta Mush)' };
    return [
      'Motion Rig: rig deformation test',
      `Character: ${st.character}`,
      `Skinning method: ${names[s.skin]}`,
      `Overlapping hidden artwork: ${s.overlap}`,
      `Preserve rigid features: ${s.preserve}`,
      `Primary springs: ${s.springs ? 'on' : 'off'} (smoothing ${$('smoothing').value}, follow-through ${$('follow').value})`,
      `Secondary motion amount: ${Math.round(s.secondary * 100)}% (cloth ${$('optCloth').checked ? 'on' : 'off'}, bounce ${$('bounce').value})`,
      `Test pose: ${active || 'none (live)'}`,
      `Renderer: ${st.renderer}, mesh vertices: ${st.vertices}, joint fixes: ${st.fixes}`,
    ].join('\n');
  }

  // Live readout.
  setInterval(() => {
    const st = getStatus();
    const turn = st.view === 'front' && !st.yaw ? '' : ` · ${st.view === 'threequarter' ? '¾' : st.view} view`;
    $('labStatus').textContent = `${st.fps} fps · ${st.renderer} · ${st.vertices.toLocaleString()} vertices · ${st.fixes} joint fix${st.fixes === 1 ? '' : 'es'}${turn}${st.yaw ? ` · turn ${st.yaw}°` : ''}`;
  }, 500);

  if (query.get('test')) setTimeout(() => setTest(query.get('test')), 2500);
  const fixedT = query.get('t') !== null ? Number(query.get('t')) : null;

  return {
    settings,
    get active() {
      return active;
    },
    // Overrides for this frame, or null when no test is running.
    pose(now, rest) {
      if (!active || !rest) return null;
      const r = TESTS[active](rest, fixedT ?? (now - t0) / 1000);
      const { offset, view, ...override } = r;
      return { override, offset: offset || { x: 0, y: 0 }, view };
    },
  };
}
