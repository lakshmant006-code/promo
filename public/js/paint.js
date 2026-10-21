// Minimal Procreate-like painting: brush, smudge, eraser, opacity, pressure, eyedropper, undo/redo.
export class Painter {
  constructor(paint, strokeLayer) {
    this.canvas = paint;
    this.ctx = paint.getContext('2d', { willReadFrequently: true });
    this.layer = strokeLayer;
    this.lctx = strokeLayer.getContext('2d');
    this.tool = 'brush';
    this.color = '#000000';
    this.size = 18;
    this.opacity = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
    this.onPick = null; // eyedropper callback
    this.picking = false;
  }

  resize(w, h) {
    const keep = this.canvas.width ? this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height) : null;
    for (const c of [this.canvas, this.layer]) {
      c.width = w;
      c.height = h;
    }
    if (keep) this.ctx.putImageData(keep, 0, 0);
  }

  // Convert a pointer event into canvas pixels (works with the scaled iPad frame).
  toCanvas(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * this.canvas.width) / r.width,
      y: ((e.clientY - r.top) * this.canvas.height) / r.height,
      p: e.pointerType === 'mouse' ? 1 : e.pressure || 0.5,
      k: this.canvas.width / this.canvas.offsetWidth, // canvas px per iPad point
    };
  }

  snapshot() {
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    this.ctx.putImageData(this.undoStack.pop(), 0, 0);
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    this.ctx.putImageData(this.redoStack.pop(), 0, 0);
    return true;
  }

  down(e) {
    const pt = this.toCanvas(e);
    if (this.picking) {
      const [r, g, b, a] = this.ctx.getImageData(Math.round(pt.x), Math.round(pt.y), 1, 1).data;
      const hex = a ? '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') : '#ffffff';
      this.onPick?.(hex);
      return;
    }
    this.snapshot();
    this.stroke = { last: pt, smudge: null };
    this.dab(pt, pt);
  }
  move(e) {
    if (!this.stroke) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const pt = this.toCanvas(ev);
      this.dab(this.stroke.last, pt);
      this.stroke.last = pt;
    }
  }
  up() {
    if (!this.stroke) return;
    if (this.tool === 'brush') {
      // Commit the stroke at the chosen opacity in one go, so overlapping segments don't darken.
      this.ctx.globalAlpha = this.opacity;
      this.ctx.drawImage(this.layer, 0, 0);
      this.ctx.globalAlpha = 1;
      this.lctx.clearRect(0, 0, this.layer.width, this.layer.height);
      this.layer.style.opacity = '';
    }
    this.stroke = null;
  }

  dab(a, b) {
    const width = this.size * b.k * (0.35 + 0.65 * b.p);
    if (this.tool === 'brush') {
      this.layer.style.opacity = this.opacity;
      line(this.lctx, a, b, width, this.color);
    } else if (this.tool === 'eraser') {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.globalAlpha = this.opacity;
      line(this.ctx, a, b, width, '#000');
      this.ctx.restore();
    } else {
      // Smudge: drag a little of the colour under the brush along the stroke.
      const [r, g, bl, al] = this.ctx.getImageData(Math.round(a.x), Math.round(a.y), 1, 1).data;
      if (!al) return;
      this.ctx.save();
      this.ctx.globalAlpha = 0.25 * this.opacity;
      line(this.ctx, a, b, width, `rgb(${r},${g},${bl})`);
      this.ctx.restore();
    }
  }

  clear() {
    this.snapshot();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  flip(horizontal) {
    this.snapshot();
    const tmp = document.createElement('canvas');
    tmp.width = this.canvas.width;
    tmp.height = this.canvas.height;
    tmp.getContext('2d').drawImage(this.canvas, 0, 0);
    this.ctx.save();
    this.ctx.clearRect(0, 0, tmp.width, tmp.height);
    if (horizontal) this.ctx.setTransform(-1, 0, 0, 1, tmp.width, 0);
    else this.ctx.setTransform(1, 0, 0, -1, 0, tmp.height);
    this.ctx.drawImage(tmp, 0, 0);
    this.ctx.restore();
  }

  insertImage(img) {
    this.snapshot();
    const k = Math.min(1, (this.canvas.width * 0.8) / img.width, (this.canvas.height * 0.8) / img.height);
    const w = img.width * k;
    const h = img.height * k;
    this.ctx.drawImage(img, (this.canvas.width - w) / 2, (this.canvas.height - h) / 2, w, h);
  }
}

function line(ctx, a, b, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
