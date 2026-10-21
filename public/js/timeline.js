// Frame timeline modelled on Procreate's Animation Assist. Frames are rig poses: capture them
// while performing (one at a time or automatically), play them back with optional smooth
// in-betweens, and export them as a frame-per-layer PSD (opens straight into Procreate's
// Animation Assist), a sprite sheet, or a video.
import { lerpPose, splinePose } from './rig.js';
import { downloadBlob } from './export.js';
import { buildAIPack } from './aipack.js';
import { comfyStatus, redrawWithComfy, fixGapsWithComfy, DEFAULT_PROMPT } from './comfy.js';

const $ = (id) => document.getElementById(id);
const ease = (u) => u * u * (3 - 2 * u);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export function createTimeline({ rig, renderPose, toast, character }) {
  const frames = []; // { pose, thumb, ai (redrawn canvas), aiInk (its ink as alpha) }
  let selected = -1;
  let playing = false;
  let playStart = 0;
  let lastAuto = 0;
  const fps = () => Number($('tlFps').value);
  const tween = () => $('tlTween').checked;
  // AI redraws are shown (and exported) instead of the rig render when every frame has one.
  const useAI = () => $('tlShowAI').checked && frames.length > 0 && frames.every((f) => f.aiInk);

  // AI frames are 1024x768 on white. Draw them as ink only, scaled the way the rig scales the
  // character (by height, centred), so they line up with the live character.
  function drawAI(ctx, w, h, ink) {
    const k = h / ink.height;
    ctx.drawImage(ink, w / 2 - (ink.width * k) / 2, 0, ink.width * k, h);
  }
  function inkOnly(src) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    const im = g.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      d[i + 3] = Math.max(0, Math.min(255, (235 - lum) * 1.25));
      d[i] = d[i + 1] = d[i + 2] = 10;
    }
    g.putImageData(im, 0, 0);
    return c;
  }
  // Draw export item i (an AI frame, or a rig pose) at w x h.
  function drawItem(ctx, w, h, item) {
    if (item.aiInk) drawAI(ctx, w, h, item.aiInk);
    else renderPose(ctx, w, h, item.pose);
  }

  const strip = $('tlFrames');
  function renderStrip() {
    strip.innerHTML = '';
    frames.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = 'tl-frame' + (i === selected ? ' active' : '');
      b.title = `Frame ${i + 1}`;
      b.append(f.thumb);
      const n = document.createElement('span');
      n.textContent = i + 1;
      b.append(n);
      b.addEventListener('click', () => {
        selected = selected === i ? -1 : i;
        stop();
        renderStrip();
      });
      strip.append(b);
    });
    $('tlCount').textContent = frames.length ? `${frames.length} frame${frames.length > 1 ? 's' : ''}` : 'No frames yet';
    strip.scrollLeft = strip.scrollWidth;
  }

  function thumbnail(pose) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 64;
    renderPose(c.getContext('2d'), c.width, c.height, pose, 1.15);
    return c;
  }

  function capture() {
    const pose = rig.getPose();
    const at = selected >= 0 ? selected + 1 : frames.length;
    const appended = at === frames.length;
    frames.splice(at, 0, { pose, thumb: thumbnail(pose), ai: null, aiInk: null });
    selected = -1;
    renderStrip();
    if (folder) appended ? saveFrame(at) : saveAll();
    return at + 1;
  }

  // ---- saving into a folder (e.g. iCloud Drive, so Procreate on the iPad can open it) ----
  let folder = null;
  let psdTimer = null;
  const pad = (n) => String(n).padStart(4, '0');

  async function chooseFolder() {
    if (!window.showDirectoryPicker) return toast('Saving into a folder needs Chrome or Edge.');
    try {
      folder = await window.showDirectoryPicker({ id: 'motion-rig-frames', mode: 'readwrite' });
    } catch {
      return; // picker cancelled
    }
    $('tlFolderName').textContent = folder.name;
    toast(`New frames will be saved to "${folder.name}".`, 4000);
    if (frames.length) saveAll();
  }
  async function writeFile(name, blob) {
    const handle = await folder.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
  }
  function framePNG(f) {
    const c = document.createElement('canvas');
    c.width = EXPORT_W;
    c.height = EXPORT_H;
    if (f.aiInk && $('tlShowAI').checked) drawAI(c.getContext('2d'), EXPORT_W, EXPORT_H, f.aiInk);
    else renderPose(c.getContext('2d'), EXPORT_W, EXPORT_H, f.pose);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }
  async function guarded(job) {
    try {
      await job();
    } catch (err) {
      console.error(err);
      toast("Couldn't write to that folder. Choose it again in Settings.", 5000);
      folder = null;
      $('tlFolderName').textContent = 'Not set';
    }
  }
  function saveFrame(i) {
    guarded(async () => {
      await writeFile(`frame_${pad(i + 1)}.png`, await framePNG(frames[i]));
      savePSDSoon();
    });
  }
  function saveAll() {
    guarded(async () => {
      for (let i = 0; i < frames.length; i++) await writeFile(`frame_${pad(i + 1)}.png`, await framePNG(frames[i]));
      savePSDSoon();
    });
  }
  // One PSD with a layer per frame, rewritten shortly after the last capture.
  function savePSDSoon() {
    clearTimeout(psdTimer);
    psdTimer = setTimeout(() => guarded(() => writeFile('animation.psd', new Blob([framesPSD(exportItems())]))), 700);
  }

  // What to show at time t of playback: an AI frame, or a (blended) pose.
  function frameAt(t) {
    if (useAI()) {
      const f = frames[Math.floor(t * fps()) % frames.length];
      return { image: f.aiInk, pose: f.pose };
    }
    return { pose: poseAt(t) };
  }

  // Pose shown at time t (seconds) of playback.
  function poseAt(t) {
    const n = frames.length;
    const pos = t * fps();
    const i = Math.floor(pos) % n;
    if (!tween() || n < 2) return frames[i].pose;
    return between(i, pos - Math.floor(pos));
  }

  // The pose a fraction u of the way from frame i to the next, using the chosen curve.
  function between(i, u) {
    const n = frames.length;
    const at = (k) => frames[((k % n) + n) % n].pose;
    const curve = $('tlCurve').value;
    if (curve === 'linear') return lerpPose(at(i), at(i + 1), u);
    if (curve === 'ease') return lerpPose(at(i), at(i + 1), ease(u));
    return splinePose(at(i - 1), at(i), at(i + 1), at(i + 2), u); // smooth curve through every pose
  }

  function play() {
    if (frames.length < 2) return toast('Add at least two frames to play.');
    playing = true;
    playStart = performance.now();
    selected = -1;
    $('tlPlay').textContent = 'Pause';
    renderStrip();
  }
  function stop() {
    playing = false;
    $('tlPlay').textContent = 'Play';
  }

  $('tlPlay').addEventListener('click', () => (playing ? stop() : play()));
  $('tlFolder').addEventListener('click', chooseFolder);
  $('tlAdd').addEventListener('click', capture);
  $('tlFps').addEventListener('input', () => ($('tlFpsOut').textContent = `${fps()} fps`));
  $('tlFpsOut').textContent = `${fps()} fps`;
  $('tlBetweens').addEventListener('input', () => ($('tlBetweensOut').textContent = $('tlBetweens').value));
  $('tlSettingsBtn').addEventListener('click', () => $('tlSettings').classList.toggle('hidden'));
  $('tlExportBtn').addEventListener('click', () => $('tlExport').classList.toggle('hidden'));
  $('tlDelete').addEventListener('click', () => {
    if (selected < 0) return toast('Tap a frame first, then delete it.');
    frames.splice(selected, 1);
    selected = Math.min(selected, frames.length - 1);
    renderStrip();
  });
  $('tlClear').addEventListener('click', () => {
    frames.length = 0;
    selected = -1;
    stop();
    renderStrip();
  });
  addEventListener('keydown', (e) => {
    if ($('timeline').classList.contains('hidden') || e.target.closest('input, textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      capture();
    }
  });

  // ---- export ----
  // Frames to export: the keys, plus in-betweens when smoothing is on.
  function exportItems() {
    if (useAI()) return frames.map((f) => ({ pose: f.pose, aiInk: f.aiInk })); // AI frames can't be blended
    return exportPoses().map((pose) => ({ pose }));
  }
  function exportPoses() {
    if (!tween() || frames.length < 2) return frames.map((f) => f.pose);
    const steps = Number($('tlBetweens').value);
    const out = [];
    for (let i = 0; i < frames.length; i++) {
      const a = frames[i].pose;
      for (let s = 0; s <= steps; s++) out.push(s === 0 ? a : between(i, s / (steps + 1)));
    }
    return out;
  }
  const EXPORT_W = 1180, EXPORT_H = 776;

  function framesPSD(items) {
    const bg = document.createElement('canvas');
    bg.width = EXPORT_W;
    bg.height = EXPORT_H;
    const bgc = bg.getContext('2d');
    bgc.fillStyle = '#fff';
    bgc.fillRect(0, 0, EXPORT_W, EXPORT_H);
    // Procreate's Animation Assist plays layers bottom-up: the bottom layer is frame 1.
    const children = [{ name: 'Background', left: 0, top: 0, canvas: bg }];
    items.forEach((item, i) => {
      const c = document.createElement('canvas');
      c.width = EXPORT_W;
      c.height = EXPORT_H;
      drawItem(c.getContext('2d'), EXPORT_W, EXPORT_H, item);
      children.push({ name: `Frame ${i + 1}`, left: 0, top: 0, canvas: c });
    });
    return window.agPsd.writePsd({ width: EXPORT_W, height: EXPORT_H, children });
  }

  $('tlExportPsd').addEventListener('click', () => {
    if (!frames.length) return toast('No frames to export yet.');
    const items = exportItems();
    const buf = framesPSD(items);
    downloadBlob(new Blob([buf], { type: 'image/vnd.adobe.photoshop' }), `animation-${stamp()}.psd`);
    toast(`Exported ${items.length} frames as layers. In Procreate, turn on Animation Assist.`, 5000);
  });

  $('tlExportSheet').addEventListener('click', () => {
    if (!frames.length) return toast('No frames to export yet.');
    const items = exportItems();
    const cw = 400, ch = Math.round((400 * EXPORT_H) / EXPORT_W);
    const cols = Math.ceil(Math.sqrt(items.length));
    const rows = Math.ceil(items.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * cw;
    sheet.height = rows * ch;
    const s = sheet.getContext('2d');
    items.forEach((item, i) => {
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      drawItem(c.getContext('2d'), cw, ch, item);
      s.drawImage(c, (i % cols) * cw, Math.floor(i / cols) * ch);
    });
    sheet.toBlob((b) => downloadBlob(b, `sprite-sheet-${cols}x${rows}-${stamp()}.png`), 'image/png');
  });

  $('tlExportVideo').addEventListener('click', async () => {
    if (frames.length < 2) return toast('Add at least two frames first.');
    const c = document.createElement('canvas');
    c.width = EXPORT_W;
    c.height = EXPORT_H;
    const g = c.getContext('2d');
    const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(c.captureStream(30), type ? { mimeType: type } : {});
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    const loop = frames.length / fps();
    const length = Math.max(loop * 2, 2); // two loops, at least two seconds
    toast(`Rendering video… ${length.toFixed(1)}s`, length * 1000 + 800);
    rec.start();
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        const t = (now - t0) / 1000;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        const layer = document.createElement('canvas');
        layer.width = c.width;
        layer.height = c.height;
        const shown = frameAt(t);
        if (shown.image) drawAI(layer.getContext('2d'), c.width, c.height, shown.image);
        else renderPose(layer.getContext('2d'), c.width, c.height, shown.pose);
        g.drawImage(layer, 0, 0);
        if (t < length) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: rec.mimeType });
    downloadBlob(blob, `animation-${stamp()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  });

  $('tlExportAI').addEventListener('click', async () => {
    if (!frames.length) return toast('No frames to export yet.');
    $('tlExport').classList.add('hidden');
    const poses = exportPoses();
    const { name, reference } = character();
    const blob = await buildAIPack({
      poses, renderPose, reference, name, fps: fps() * (tween() && frames.length > 1 ? Number($('tlBetweens').value) + 1 : 1),
      onProgress: (i, n) => toast(`Preparing AI pack… ${i}/${n}`, 1500),
    });
    downloadBlob(blob, `ai-pack-${name.toLowerCase().replace(/\s+/g, '-')}-${stamp()}.zip`);
    toast(`AI pack ready: ${poses.length} frames. See README.txt inside.`, 5000);
  });

  // ---- redraw every frame with a local AI model (ComfyUI) ----
  let redrawing = null;
  $('tlDenoise').addEventListener('input', () => ($('tlDenoiseOut').textContent = Number($('tlDenoise').value).toFixed(2)));
  $('tlDenoiseOut').textContent = Number($('tlDenoise').value).toFixed(2);
  $('tlShowAI').addEventListener('input', renderAIThumbs);

  function renderAIThumbs() {
    for (const f of frames) {
      const g = f.thumb.getContext('2d');
      g.clearRect(0, 0, f.thumb.width, f.thumb.height);
      if (f.aiInk && $('tlShowAI').checked) drawAI(g, f.thumb.width, f.thumb.height, f.aiInk);
      else renderPose(g, f.thumb.width, f.thumb.height, f.pose, 1.15);
    }
  }

  // mode 'redraw': repaint whole frames. mode 'gaps': repaint only the chopped joints, keep the rest as drawn.
  async function runAI(mode) {
    $('tlExport').classList.add('hidden');
    const button = mode === 'gaps' ? $('tlFixGaps') : $('tlRedraw');
    const idle = mode === 'gaps' ? 'Fix gaps with AI' : 'Redraw with AI';
    if (redrawing) {
      redrawing.abort();
      return;
    }
    if (!frames.length) return toast('Capture some frames first.');
    const comfy = await comfyStatus();
    if (!comfy.ok) {
      return toast("ComfyUI isn't running. Start it with scripts\\start-comfyui.ps1, then try again.", 6000);
    }
    if (comfy.cpu) toast('ComfyUI is on the processor (no GPU): using fast mode, about a minute per frame.', 5000);
    redrawing = new AbortController();
    button.firstChild.textContent = 'Stop AI';
    stop();
    const onFrame = (i, canvas) => {
      frames[i].ai = canvas;
      frames[i].aiInk = inkOnly(canvas);
      renderAIThumbs();
      toast(`AI ${mode === 'gaps' ? 'gap fix' : 'redraw'}: frame ${i + 1} of ${frames.length}`, 2500);
    };
    try {
      const poses = frames.map((f) => f.pose);
      if (mode === 'gaps') {
        await fixGapsWithComfy({
          poses, renderPose, rest: rig.rest, signal: redrawing.signal, onFrame,
          settings: { denoise: Number($('tlFixStrength').value), prompt: DEFAULT_PROMPT, fast: comfy.cpu },
        });
      } else {
        await redrawWithComfy({
          poses, renderPose, signal: redrawing.signal, onFrame,
          settings: { denoise: Number($('tlDenoise').value), prompt: DEFAULT_PROMPT, poseStrength: 0.9, lineStrength: 0.75, fast: comfy.cpu },
        });
      }
      $('tlShowAI').checked = true;
      renderAIThumbs();
      toast(mode === 'gaps' ? 'Gaps fixed. Everything else is untouched.' : 'AI redraw finished. Play to see it, or export.', 4000);
      if (folder) saveAll();
    } catch (err) {
      console.error(err);
      toast(err.message === 'Cancelled' ? 'AI stopped.' : `AI failed: ${err.message}`, 6000);
    } finally {
      redrawing = null;
      button.firstChild.textContent = idle;
    }
  }
  $('tlRedraw').addEventListener('click', () => runAI('redraw'));
  $('tlFixGaps').addEventListener('click', () => runAI('gaps'));
  $('tlFixStrength').addEventListener('input', () => ($('tlFixStrengthOut').textContent = Number($('tlFixStrength').value).toFixed(2)));
  $('tlFixStrengthOut').textContent = Number($('tlFixStrength').value).toFixed(2);

  renderStrip();

  return {
    capture,
    get playing() {
      return playing;
    },
    drawAI,
    // Called every animation frame. Returns { pose } or { image } to show, or null for the live rig.
    tick(now, live) {
      if ($('timeline').classList.contains('hidden')) return null;
      if (live && $('tlAuto').checked && !playing && now - lastAuto > 1000 / fps()) {
        lastAuto = now;
        capture();
      }
      if (playing && frames.length) return frameAt((now - playStart) / 1000);
      if (!live && selected >= 0) {
        const f = frames[selected];
        return f.aiInk && $('tlShowAI').checked ? { image: f.aiInk, pose: f.pose } : { pose: f.pose };
      }
      return null;
    },
    // The faint previous frame drawn under the current one.
    onionPose(live) {
      if ($('timeline').classList.contains('hidden') || !$('tlOnion').checked || playing || !frames.length) return null;
      if (live || selected < 0) return frames[frames.length - 1].pose;
      return selected > 0 ? frames[selected - 1].pose : null;
    },
  };
}
