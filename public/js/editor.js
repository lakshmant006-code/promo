// Joint editor: shows a drawing with its joints as draggable dots. Joints can be detected
// with the pose model, reset to a template, or placed by hand, then the character is built.
import { detectJoints, templateJoints } from './tracker.js';

const $ = (id) => document.getElementById(id);
const ORDER = ['head', 'headPivot', 'shoulderR', 'shoulderL', 'elbowR', 'elbowL', 'wristR', 'wristL', 'hipR', 'hipL', 'kneeR', 'kneeL', 'ankleR', 'ankleL'];
const LABEL = {
  head: 'Head', headPivot: 'Neck', shoulderR: 'Shoulder', shoulderL: 'Shoulder', elbowR: 'Elbow', elbowL: 'Elbow',
  wristR: 'Wrist', wristL: 'Wrist', hipR: 'Hip', hipL: 'Hip', kneeR: 'Knee', kneeL: 'Knee', ankleR: 'Ankle', ankleL: 'Ankle',
};
const LINKS = [['headPivot', 'head'], ['shoulderR', 'shoulderL'], ['hipR', 'hipL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['hipL', 'kneeL'], ['kneeL', 'ankleL']];

// image: canvas or image of the drawing. Resolves with { joints, face } or null if cancelled.
export function editJoints(image, { joints = null, face = null, autoDetect = true } = {}) {
  const sheet = $('jointEditor');
  const canvas = $('jeCanvas');
  const ctx = canvas.getContext('2d');
  const src = document.createElement('canvas');
  src.width = image.width;
  src.height = image.height;
  src.getContext('2d').drawImage(image, 0, 0);

  return new Promise((resolve) => {
    const s = ({ joints: joints ? structuredClone(joints) : templateJoints(src), face, drag: null, view: null });
    sheet.classList.remove('hidden');

    function layout() {
      const box = $('jeStage').getBoundingClientRect();
      const scaleCss = box.width / $('jeStage').offsetWidth || 1; // iPad frame scaling
      const w = $('jeStage').offsetWidth, h = $('jeStage').offsetHeight;
      const dpr = (window.devicePixelRatio || 1) * scaleCss;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const k = Math.min((canvas.width * 0.92) / src.width, (canvas.height * 0.92) / src.height);
      s.view = { k, ox: (canvas.width - src.width * k) / 2, oy: (canvas.height - src.height * k) / 2, dpr };
      draw();
    }

    function draw() {
      if (!s.view || s.closed) return; // not laid out yet, or already closed
      const { k, ox, oy, dpr } = s.view;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, ox, oy, src.width * k, src.height * k);
      const P = (n) => [ox + s.joints[n][0] * k, oy + s.joints[n][1] * k];
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = 'rgba(30,139,255,.85)';
      for (const [a, b] of LINKS) {
        const [x1, y1] = P(a), [x2, y2] = P(b);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.font = `${11 * dpr}px -apple-system, system-ui, sans-serif`;
      for (const n of ORDER) {
        const [x, y] = P(n);
        ctx.fillStyle = s.drag === n ? '#ff9f0a' : '#1e8bff';
        ctx.beginPath();
        ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        const side = n.endsWith('R') ? -1 : 1;
        ctx.fillStyle = '#0a5fc2';
        ctx.textAlign = side < 0 ? 'right' : 'left';
        ctx.fillText(LABEL[n], x + side * 12 * dpr, y + 4 * dpr);
      }
    }

    const toImage = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * canvas.width) / r.width;
      const y = ((e.clientY - r.top) * canvas.height) / r.height;
      return { x, y, ix: (x - s.view.ox) / s.view.k, iy: (y - s.view.oy) / s.view.k };
    };
    const onDown = (e) => {
      const p = toImage(e);
      let best = null, bestD = 22 * s.view.dpr;
      for (const n of ORDER) {
        const d = Math.hypot(s.view.ox + s.joints[n][0] * s.view.k - p.x, s.view.oy + s.joints[n][1] * s.view.k - p.y);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (!best) return;
      s.drag = best;
      canvas.setPointerCapture(e.pointerId);
      draw();
    };
    const onMove = (e) => {
      if (!s.drag) return;
      const p = toImage(e);
      s.joints[s.drag] = [Math.max(0, Math.min(src.width, p.ix)), Math.max(0, Math.min(src.height, p.iy))];
      draw();
    };
    const onUp = () => {
      s.drag = null;
      draw();
    };

    async function detect() {
      $('jeStatus').textContent = 'Looking for a body in the drawing…';
      try {
        const r = await detectJoints(src);
        if (s.closed) return;
        s.joints = r.joints;
        s.face = r.face;
        $('jeStatus').textContent = r.detected
          ? 'Joints found. Drag any that are off.'
          : "Couldn't find a body, so joints were placed from a template. Drag them into place.";
      } catch (err) {
        console.error(err);
        $('jeStatus').textContent = "Detection failed, so a template was used. Drag the joints into place.";
        s.joints = templateJoints(src);
      }
      draw();
    }

    function close(result) {
      s.closed = true;
      sheet.classList.add('hidden');
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      $('jeDetect').onclick = $('jeTemplate').onclick = $('jeCancel').onclick = $('jeDone').onclick = null;
      removeEventListener('resize', layout);
      resolve(result);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    addEventListener('resize', layout);
    $('jeDetect').onclick = detect;
    $('jeTemplate').onclick = () => {
      s.joints = templateJoints(src);
      $('jeStatus').textContent = 'Template placed. Drag the joints onto your drawing.';
      draw();
    };
    $('jeCancel').onclick = () => close(null);
    $('jeDone').onclick = () => close({ joints: s.joints, face: s.face });
    $('jeStatus').textContent = '';
    requestAnimationFrame(layout);
    if (autoDetect) detect();
  });
}
