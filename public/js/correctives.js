// Corrective patches: small AI-repaired pieces of the drawing, one per joint and bend (made by
// the rig check). While animating, when a joint bends close to a bend that was repaired, its
// patch fades in over the joint and follows the parent bone, covering the chop.
import { hingeBend, jointPoint, maskCanvas } from './comfy.js';

const MATCH = 0.4; // radians: how far from the repaired bend a patch still shows
const storeKey = (character) => `rig.correctives.${character}`;
const smooth = (t) => t * t * (3 - 2 * t);

export function createCorrectives() {
  let character = null;
  let patches = [];

  function save() {
    if (!character) return;
    try {
      localStorage.setItem(storeKey(character), JSON.stringify(patches.map(({ canvas, ...p }) => ({ ...p, src: canvas.toDataURL('image/png') }))));
    } catch {
      // Too big for browser storage: keep them for this session only.
    }
  }

  return {
    get count() {
      return patches.length;
    },
    // Switch to the patches saved for a character.
    async load(key) {
      character = key;
      patches = [];
      let saved = [];
      try {
        saved = JSON.parse(localStorage.getItem(storeKey(key)) || '[]');
      } catch {}
      for (const p of saved) {
        const img = new Image();
        img.src = p.src;
        await img.decode().catch(() => {});
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        delete p.src;
        patches.push({ ...p, canvas });
      }
    },
    clear() {
      patches = [];
      save();
    },

    // Cut one patch per repaired region out of a fixed frame. P: joints in that frame; pose: its pose.
    addFromFrame(frame, regions, P, pose) {
      for (const g of regions) {
        const x0 = Math.max(0, Math.floor(g.x - g.r)), y0 = Math.max(0, Math.floor(g.y - g.r));
        const size = Math.ceil(g.r * 2);
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.drawImage(frame, -x0, -y0);
        // Keep only the soft circle around the joint.
        const m = maskCanvas(size, size, [{ x: g.x - x0, y: g.y - y0, r: g.r }]);
        const md = m.getContext('2d').getImageData(0, 0, size, size);
        for (let i = 0; i < md.data.length; i += 4) md.data[i + 3] = md.data[i];
        m.getContext('2d').putImageData(md, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(m, 0, 0);
        // Replace any earlier patch for the same joint bent the same way.
        patches = patches.filter((p) => !(p.joint === g.joint && Math.abs(p.bend - g.bend) < MATCH * 0.5));
        patches.push({
          joint: g.joint, child: g.child, parent: g.parent, bend: g.bend,
          ax: g.x, ay: g.y, x0, y0, T: P.T, parentAngle: pose.angle[g.parent], canvas: c,
        });
      }
      save();
    },

    // Draw the patches that match the rig's current bends. P: solved joints on this canvas.
    draw(ctx, rig, P) {
      if (!patches.length || !P) return;
      const pose = rig.getPose();
      ctx.save();
      for (const p of patches) {
        const bend = hingeBend(pose, p.child, p.parent, rig.rest);
        const w = 1 - Math.abs(bend - p.bend) / MATCH;
        if (w <= 0) continue;
        const at = jointPoint(P, p.joint);
        if (!at) continue;
        const k = P.T / p.T;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(at.x, at.y);
        ctx.rotate(pose.angle[p.parent] - p.parentAngle);
        ctx.scale(k, k);
        ctx.translate(-p.ax, -p.ay);
        ctx.globalAlpha = smooth(Math.min(1, w * 1.6));
        ctx.drawImage(p.canvas, p.x0, p.y0);
      }
      ctx.restore();
    },
  };
}
