// Synthetic "performer" so the rig can be tested without a camera.
// Produces joints in the same shape as poseToJoints (tracker space, character sides).
const PI = Math.PI;

export function demoFrame(t) {
  const T = 0.25; // torso length in tracker units
  const go = (p, a, len) => ({ x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len, v: 1 });
  const s = Math.sin;

  const pelvis = { x: 0.667 + s(t * 0.5) * 0.06, y: 0.62 + Math.abs(s(t * 2)) * -0.01, v: 1 };
  const lean = s(t * 0.7) * 0.12;
  const neck = go(pelvis, -PI / 2 + lean, T);
  const shoulderAng = lean + s(t * 1.3) * 0.05;
  const shoulderR = go(neck, shoulderAng + PI, T * 0.39);
  const shoulderL = go(neck, shoulderAng, T * 0.39);
  const hipR = go(pelvis, PI, T * 0.26);
  const hipL = go(pelvis, 0, T * 0.26);

  // Right arm waves overhead, left arm swings
  const elbowR = go(shoulderR, PI + 0.6 + s(t * 1.2) * 0.5, T * 0.62);
  const wristR = go(elbowR, -PI / 2 - 0.4 + s(t * 6) * 0.5, T * 0.58);
  const elbowL = go(shoulderL, PI / 2 - 0.25 + s(t * 2) * 0.35, T * 0.62);
  const wristL = go(elbowL, PI / 2 - 0.6 + s(t * 2) * 0.5, T * 0.58);

  // Marching legs
  const step = s(t * 2);
  const kneeR = go(hipR, PI / 2 - Math.max(0, step) * 0.9, T * 0.88);
  const ankleR = go(kneeR, PI / 2 + Math.max(0, step) * 0.4, T * 0.86);
  const kneeL = go(hipL, PI / 2 + Math.max(0, -step) * 0.9 - 0.02, T * 0.88);
  const ankleL = go(kneeL, PI / 2 - Math.max(0, -step) * 0.4, T * 0.86);

  const head = go(neck, -PI / 2 + lean * 1.4 + s(t * 0.9) * 0.15, T * 0.42);

  const blinkPhase = t % 3.2;
  const blink = blinkPhase < 0.15 ? 1 : 0;
  return {
    joints: { pelvis, neck, head, shoulderR, shoulderL, hipR, hipL, elbowR, wristR, elbowL, wristL, kneeR, ankleR, kneeL, ankleL },
    face: {
      roll: s(t * 0.9) * 0.18,
      yaw: s(t * 0.6) * 0.5,
      blinkL: blink,
      blinkR: blink,
      jaw: Math.max(0, s(t * 5)) * (s(t * 0.8) > 0 ? 0.7 : 0),
      smile: (s(t * 0.4) + 1) / 2,
      browUp: Math.max(0, s(t * 0.33)),
    },
  };
}
