// Rig check: a guided warm-up when the camera first opens. You hold a few test poses; for each
// one the app finds where the character chops (joints bent far from the drawing), shows it,
// and has the local AI repaint just those spots. The repairs become corrective patches that
// blend in automatically while you animate.
import { gapRegions, fixGapsWithComfy, comfyStatus, hingeBend } from './comfy.js';

const $ = (id) => document.getElementById(id);
// Each step checks that you're really doing that pose before the hold ring starts filling.
// Angles are on screen (y down): pointing up is -90°, so sin(angle) < 0 means above horizontal.
const up = (a) => Math.sin(a);
const STEPS = [
  { id: 'armsUp', text: 'Raise both arms above your head', hint: 'Raise both arms higher, above your head',
    ok: (p) => up(p.angle.upperArmR) < -0.5 && up(p.angle.upperArmL) < -0.5 },
  { id: 'armsOut', text: 'Hold both arms straight out to the sides', hint: 'Hold both arms out level with your shoulders',
    ok: (p) => Math.abs(up(p.angle.upperArmR)) < 0.4 && Math.abs(up(p.angle.upperArmL)) < 0.4 },
  { id: 'tiltA', text: 'Tilt your head to one side', hint: 'Tilt your head further to one side',
    ok: (p, c) => Math.abs(hingeBend(p, 'neck', 'spine', c.rest)) > 0.25 },
  { id: 'tiltB', text: 'Now tilt your head the other way', hint: 'Tilt your head the other way',
    ok: (p, c) => hingeBend(p, 'neck', 'spine', c.rest) * (c.tilt || 1) < -0.25 },
  { id: 'elbows', text: 'Bend both elbows, hands up by your shoulders', hint: 'Bend both elbows more',
    ok: (p, c) => Math.abs(hingeBend(p, 'foreArmR', 'upperArmR', c.rest)) > 0.9 && Math.abs(hingeBend(p, 'foreArmL', 'upperArmL', c.rest)) > 0.9 },
  { id: 'knee', text: 'Lift one knee', hint: 'Step back so your legs are in view, then lift one knee',
    ok: (p, c) => Math.abs(hingeBend(p, 'thighR', 'spine', c.rest)) > 0.45 || Math.abs(hingeBend(p, 'thighL', 'spine', c.rest)) > 0.45 },
];
const JOINT_NAMES = {
  headPivot: 'neck', shoulderR: 'shoulder', shoulderL: 'shoulder', elbowR: 'elbow', elbowL: 'elbow',
  hipR: 'hip', hipL: 'hip', kneeR: 'knee', kneeL: 'knee',
};

export function createRigCheck({ rig, renderPose, correctives, toast, onFinish }) {
  let active = false;
  let step = 0;
  let results = []; // per step: { status, found }
  let work = Promise.resolve(); // AI jobs run one after another, in the background
  let comfy = { ok: false };
  let tilt = 0; // which way the first head tilt went, so the second goes the other way

  function render() {
    $('rcStep').textContent = step < STEPS.length ? `Pose ${step + 1} of ${STEPS.length}` : 'All poses done';
    $('rcText').textContent = step < STEPS.length ? STEPS[step].text : 'Your character is ready to animate.';
    $('rcHint').textContent = step < STEPS.length ? 'Do the pose, then hold still until the ring fills.' : '';
    $('rcList').innerHTML = STEPS.map((s, i) => {
      const r = results[i];
      const cls = r ? r.status : i === step ? 'current' : '';
      const label = !r ? (i === step ? 'now' : '') : r.status === 'clean' ? 'no chops' : r.status === 'fixing' ? `${r.found}, fixing…` : r.status === 'fixed' ? `${r.found}, fixed` : r.status === 'found' ? r.found : r.status === 'failed' ? 'fix failed' : 'skipped';
      return `<li class="${cls}"><span>${s.text}</span><small>${label}</small></li>`;
    }).join('');
    $('rcFinish').textContent = step < STEPS.length ? 'Skip to animating' : 'Start animating';
    const pending = results.some((r) => r?.status === 'fixing');
    $('rcStatus').textContent = !comfy.ok
      ? "ComfyUI isn't running: chops are found, but they won't be fixed until it's started."
      : pending ? 'The AI is repairing chops in the background. You can keep going.' : correctives.count ? `${correctives.count} joint fix${correctives.count > 1 ? 'es' : ''} ready.` : '';
  }

  function describe(regions) {
    const names = [...new Set(regions.map((g) => JOINT_NAMES[g.joint]))];
    return names.length ? `chop at ${names.join(', ')}` : '';
  }

  async function start() {
    active = true;
    step = 0;
    results = [];
    tilt = 0;
    comfy = await comfyStatus();
    $('rigCheck').classList.remove('hidden');
    render();
  }
  function finish() {
    active = false;
    $('rigCheck').classList.add('hidden');
    onFinish?.();
    toast(correctives.count ? 'Rig check done. Joint fixes will blend in as you move.' : 'Rig check done.', 4000);
  }

  // A held pose from the camera.
  function capture(pose) {
    if (!active || step >= STEPS.length) return;
    const i = step;
    if (STEPS[i].id === 'tiltA') tilt = Math.sign(hingeBend(pose, 'neck', 'spine', rig.rest)) || 1;
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 768;
    const P = renderPose(c.getContext('2d'), 1024, 768, pose);
    const regions = gapRegions(pose, P, rig.rest);
    results[i] = { status: regions.length ? (comfy.ok ? 'fixing' : 'found') : 'clean', found: describe(regions) };
    step++;
    render();
    if (regions.length && comfy.ok) {
      work = work.then(() =>
        fixGapsWithComfy({
          poses: [pose], renderPose, rest: rig.rest,
          settings: { denoise: 0.55, fast: comfy.cpu },
          onFrame: (_, frame, regs, PP) => correctives.addFromFrame(frame, regs, PP, pose),
        })
          .then(() => (results[i].status = 'fixed'))
          .catch((err) => {
            console.error(err);
            results[i].status = 'failed';
          })
          .finally(render),
      );
    }
  }

  $('rcSkip').addEventListener('click', () => {
    if (step < STEPS.length) {
      results[step] = { status: 'skipped' };
      step++;
      render();
    }
  });
  $('rcFinish').addEventListener('click', finish);
  $('rcClose').addEventListener('click', finish);

  return {
    get active() {
      return active;
    },
    start,
    capture,
    // Is the current pose the one this step asks for? If not, `hint` says what to change.
    matches(pose) {
      const s = STEPS[step];
      return !!s && s.ok(pose, { rest: rig.rest, tilt });
    },
    get hint() {
      return STEPS[step]?.hint || '';
    },
  };
}
