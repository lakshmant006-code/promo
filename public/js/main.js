import { Rig, jointAngles, drawSkeleton } from './rig.js';
import { buildPuppet, drawPuppet, createRenderer } from './puppet.js';
import { drawDoodle } from './doodle.js';
import { layeredSVG, layeredPSD, readLayeredPSD, downloadBlob, PART_LABELS } from './export.js';
import { editJoints } from './editor.js';
import { createTimeline } from './timeline.js';
import { gapRegions } from './comfy.js';
import { createCorrectives } from './correctives.js';
import { createRigCheck } from './rigcheck.js';
import { FEELS } from './motion.js';
import { drawRigView } from './rigview.js';
import { createCloth } from './cloth.js';
import { createDeform } from './deform.js';
import { createLab } from './lab.js';
import { fixGapsWithComfy, comfyStatus } from './comfy.js';
import { JointFilter } from './filters.js';
import { createTracker, poseToJoints, faceToExpression, drawOverlay, bodyYaw } from './tracker.js';
import { demoFrame } from './demo.js';
import { Painter } from './paint.js';
import { createTakes } from './take.js';
import { createJointBalls } from './joints.js';
import { createTips, createHints } from './ui.js';

const $ = (id) => document.getElementById(id);
const device = $('device');
const screenEl = $('screen');
const paintCanvas = $('paint');
const stage = $('stage');
const ctx = stage.getContext('2d');
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const painter = new Painter(paintCanvas, $('strokeLayer'));
const rig = new Rig();
const jointFilter = new JointFilter();
const renderer = createRenderer();
// Secondary cloth motion runs only on the live stage renderer (not thumbnails or exports).
const cloth = createCloth();
const deform = createDeform();
let lab = null; // the Rig Lab panel, created below
renderer.post = (puppet, piece, mesh, mats) => {
  const s = lab?.settings();
  if (s) deform.apply(puppet, piece, mesh, mats, { method: s.skin, preserve: s.preserve });
  if (document.getElementById('optCloth')?.checked) cloth.apply(puppet, piece, mesh);
};
const state = { source: 'none', tracker: null, lastVideoTime: -1, joints: null, face: null, scale: 1, yaw: 0 };
const SCREEN_W = 1180;
const SCREEN_H = 820;

// ---------- toast ----------
let toastTimer;
function toast(msg, ms = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- device mockup: scale the iPad screen to fit the laptop window ----------
function fitDevice() {
  const frameW = device.offsetWidth;
  const frameH = device.offsetHeight;
  const room = innerWidth - (document.body.classList.contains('lab-open') ? 340 : 0);
  const s = Math.min((room - 48) / frameW, (innerHeight - 48) / frameH, 1.4);
  state.scale = s;
  device.style.left = `${room / 2}px`;
  device.style.transform = `translate(-50%, -50%) scale(${s})`;
  const dpr = window.devicePixelRatio || 1;
  const ws = $('workspace');
  const w = Math.round(ws.offsetWidth * s * dpr);
  const h = Math.round(ws.offsetHeight * s * dpr);
  painter.resize(w, h);
  stage.width = w;
  stage.height = h;
}
addEventListener('resize', fitDevice);
fitDevice();

// Pointer position in iPad points, relative to the screen.
function toScreen(e) {
  const r = screenEl.getBoundingClientRect();
  return { x: (e.clientX - r.left) / state.scale, y: (e.clientY - r.top) / state.scale };
}

// ---------- persistent settings (survive live reload) ----------
const SETTINGS = ['prefLight', 'prefRightHand', 'prefCursor', 'prefSidebar', 'prefReference', 'optShow', 'optBody', 'optFace', 'optMirror', 'optSkeleton', 'optLegRest', 'optMesh', 'optWeights', 'optCloth', 'prefAnim', 'optHold', 'holdTime', 'optCorrect', 'smoothing', 'bounce', 'follow', 'charScale', 'brushSize', 'brushOpacity'];
try {
  const saved = JSON.parse(localStorage.getItem('rig.settings') || '{}');
  for (const id of SETTINGS) {
    if (!(id in saved)) continue;
    if ($(id).type === 'checkbox') $(id).checked = saved[id];
    else $(id).value = saved[id];
  }
} catch {}
function saveSettings() {
  try {
    const out = {};
    for (const id of SETTINGS) out[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
    localStorage.setItem('rig.settings', JSON.stringify(out));
  } catch {}
}

function applyPrefs() {
  document.body.classList.toggle('light', $('prefLight').checked);
  document.body.classList.toggle('right-hand', $('prefRightHand').checked);
  $('sidebar').classList.toggle('hidden', !$('prefSidebar').checked);
  $('refwin').classList.toggle('hidden', !$('prefReference').checked);
  $('timeline').classList.toggle('hidden', !$('prefAnim').checked);
  document.body.classList.toggle('anim', $('prefAnim').checked);
  document.querySelector('.refwin-body').classList.toggle('mirror', $('optMirror').checked);
  $('layerRig').checked = $('optShow').checked;
  stage.style.visibility = $('optShow').checked ? '' : 'hidden';
  painter.size = Number($('brushSize').value);
  painter.opacity = Number($('brushOpacity').value);
  $('smoothingOut').textContent = `${Math.round($('smoothing').value * 100)}%`;
  $('bounceOut').textContent = `${Math.round($('bounce').value * 100)}%`;
  $('followOut').textContent = `${Math.round($('follow').value * 100)}%`;
  // Highlight the feel preset that matches the sliders, if any.
  for (const b of document.querySelectorAll('#feelBtns button')) {
    const f = FEELS[b.dataset.feel];
    b.classList.toggle('active', Math.abs(f.smooth - $('smoothing').value) < 0.02 && Math.abs(f.bounce - $('bounce').value) < 0.02 && Math.abs(f.follow - $('follow').value) < 0.02);
  }
  $('holdTimeOut').textContent = `${Number($('holdTime').value).toFixed(1)}s`;
  $('charScaleOut').textContent = `${Math.round($('charScale').value * 100)}%`;
}
for (const id of SETTINGS) $(id).addEventListener('input', () => { applyPrefs(); saveSettings(); });
$('optMirror').addEventListener('input', () => rig.recenter());
applyPrefs();

// Generic sliders inside Prefs (visual only)
for (const input of document.querySelectorAll('.slider-row input[data-fmt]')) {
  input.addEventListener('input', () => {
    const v = Number(input.value);
    input.previousElementSibling.textContent = input.dataset.fmt === 's' ? `${v.toFixed(2)}s` : `${v.toFixed(1)}%`;
  });
}

// ---------- popovers ----------
const popovers = [$('actionsPanel'), $('layersPanel')];
function closePopovers() {
  for (const p of popovers) p.classList.add('hidden');
  $('btnActions').classList.remove('active');
  $('btnLayers').classList.remove('active');
}
function togglePopover(panel) {
  const opening = panel.classList.contains('hidden');
  closePopovers();
  if (!opening) return;
  const anchor = $(panel.dataset.anchor);
  const sr = screenEl.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const left = (ar.left - sr.left) / state.scale;
  const right = (ar.right - sr.left) / state.scale;
  panel.classList.remove('hidden');
  const w = panel.offsetWidth;
  panel.style.left = `${Math.max(8, Math.min(SCREEN_W - w - 8, panel.id === 'layersPanel' ? right - w + 6 : left - 18))}px`;
  anchor.classList.add('active');
}
$('btnActions').addEventListener('click', () => togglePopover($('actionsPanel')));
$('btnLayers').addEventListener('click', () => togglePopover($('layersPanel')));
addEventListener('keydown', (e) => e.key === 'Escape' && closePopovers());

function openActionsTab(name) {
  for (const t of document.querySelectorAll('.atab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of document.querySelectorAll('.apane')) p.classList.toggle('hidden', p.dataset.pane !== name);
  try { localStorage.setItem('rig.actionsTab', name); } catch {}
}
for (const t of document.querySelectorAll('.atab')) t.addEventListener('click', () => openActionsTab(t.dataset.tab));
try { openActionsTab(localStorage.getItem('rig.actionsTab') || 'prefs'); } catch { openActionsTab('prefs'); }

for (const b of document.querySelectorAll('.seg-btn')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.seg-btn')) x.classList.toggle('active', x === b);
    for (const p of document.querySelectorAll('.sub')) p.classList.toggle('hidden', p.dataset.subpane !== b.dataset.sub);
  });
}

// ---------- tools, colour, sidebar ----------
for (const b of document.querySelectorAll('.tool')) {
  b.addEventListener('click', () => {
    painter.tool = b.dataset.tool;
    for (const x of document.querySelectorAll('.tool')) x.classList.toggle('active', x === b);
  });
}
$('btnColor').addEventListener('click', () => $('colorInput').click());
function setColor(hex) {
  painter.color = hex;
  $('colorInput').value = hex;
  $('btnColor').style.background = hex;
}
$('colorInput').addEventListener('input', () => setColor($('colorInput').value));
setColor('#000000');

let hudTimer;
function hud(text) {
  $('sliderHud').textContent = text;
  $('sliderHud').classList.remove('hidden');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => $('sliderHud').classList.add('hidden'), 700);
}
$('brushSize').addEventListener('input', () => hud(`${Math.round(($('brushSize').value / 120) * 100)}%`));
$('brushOpacity').addEventListener('input', () => hud(`${Math.round($('brushOpacity').value * 100)}%`));
$('btnModify').addEventListener('click', () => {
  painter.picking = !painter.picking;
  $('btnModify').classList.toggle('active', painter.picking);
  if (painter.picking) toast('Eyedropper: tap the canvas to pick a colour');
});
painter.onPick = (hex) => {
  setColor(hex);
  painter.picking = false;
  $('btnModify').classList.remove('active');
};
// In a take, undo/redo step through rig changes; otherwise through painting.
const undo = () => (typeof takes !== 'undefined' && takes.undo()) || (painter.undo() && toast('Undo', 700));
const redo = () => (typeof takes !== 'undefined' && takes.redo()) || (painter.redo() && toast('Redo', 700));
$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  e.shiftKey ? redo() : undo();
});

// ---------- painting on the canvas ----------
const workspace = $('workspace');
const cursor = $('brushCursor');
workspace.addEventListener('pointerdown', (e) => {
  // Like Procreate, a tap on the canvas while a popover is open just closes it.
  if (popovers.some((p) => !p.classList.contains('hidden'))) return closePopovers();
  workspace.setPointerCapture(e.pointerId);
  painter.down(e);
});
workspace.addEventListener('pointermove', (e) => {
  painter.move(e);
  // Rig mode: no brush circle; the cursor says what a tap or drag will do.
  if (takes.brushActive()) {
    cursor.classList.add('hidden');
    workspace.style.cursor = takes.hover(stagePoint(e)) || 'default';
    return;
  }
  workspace.style.cursor = '';
  if ($('prefCursor').checked && e.pointerType !== 'touch') {
    const p = toScreen(e);
    const d = painter.size;
    Object.assign(cursor.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${d}px`, height: `${d}px` });
    cursor.classList.remove('hidden');
  }
});
workspace.addEventListener('pointerup', () => painter.up());
workspace.addEventListener('pointercancel', () => painter.up());
workspace.addEventListener('pointerleave', () => {
  cursor.classList.add('hidden');
  takes.hover(null);
});

// ---------- Actions › Add / Canvas / Share ----------
function imageFromSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
$('insertPhoto').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  painter.insertImage(await imageFromSrc(URL.createObjectURL(f)));
  e.target.value = '';
  closePopovers();
});
$('btnFlipH').addEventListener('click', () => painter.flip(true));
$('btnFlipV').addEventListener('click', () => painter.flip(false));
$('btnClearCanvas').addEventListener('click', () => painter.clear());

// ---------- Background image layer (the scene the character is placed into) ----------
const bgLayer = $('bgLayer');
const bgImage = new Image();
function setBackground(src) {
  bgImage.src = src;
  bgLayer.style.backgroundImage = `url("${src}")`;
  $('bgThumb').style.backgroundImage = `url("${src}")`;
}
setBackground(localStorage.getItem('rig.bg') || 'backgrounds/playground.jpg');
function applyBgVisibility() {
  bgLayer.style.visibility = $('layerBg').checked ? '' : 'hidden';
  try { localStorage.setItem('rig.bgOn', $('layerBg').checked ? '1' : '0'); } catch {}
}
try { $('layerBg').checked = localStorage.getItem('rig.bgOn') !== '0'; } catch {}
applyBgVisibility();
$('layerBg').addEventListener('input', applyBgVisibility);
$('bgFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    setBackground(reader.result);
    try { localStorage.setItem('rig.bg', reader.result); } catch { toast('Background set, but too large to remember after a reload.'); }
  };
  reader.readAsDataURL(f);
});

// Flatten visible layers (background, painting, character) into one canvas.
const composite = document.createElement('canvas');
function flatten() {
  composite.width = stage.width;
  composite.height = stage.height;
  const c = composite.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, composite.width, composite.height);
  if ($('layerBg').checked && bgImage.complete && bgImage.naturalWidth) {
    // Same as the layer on screen: cover the canvas, centred.
    const k = Math.max(composite.width / bgImage.naturalWidth, composite.height / bgImage.naturalHeight);
    const w = bgImage.naturalWidth * k, h = bgImage.naturalHeight * k;
    c.drawImage(bgImage, (composite.width - w) / 2, (composite.height - h) / 2, w, h);
  }
  if ($('layerPaint').checked) c.drawImage(paintCanvas, 0, 0);
  if ($('optShow').checked) c.drawImage(stage, 0, 0);
  return composite;
}
function download(href, name) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
$('btnSharePng').addEventListener('click', () => download(flatten().toDataURL('image/png'), `artwork-${stamp()}.png`));

// ---------- Layers ----------
$('layerPaint').addEventListener('input', () => (paintCanvas.style.visibility = $('layerPaint').checked ? '' : 'hidden'));
$('layerRig').addEventListener('input', () => {
  $('optShow').checked = $('layerRig').checked;
  applyPrefs();
  saveSettings();
});

// ---------- Reference window ----------
$('refwinClose').addEventListener('click', () => {
  $('prefReference').checked = false;
  applyPrefs();
  saveSettings();
});
{
  const win = $('refwin');
  const bar = $('refwinBar');
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const start = toScreen(e);
    const ox = win.offsetLeft;
    const oy = win.offsetTop;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const p = toScreen(ev);
      win.style.left = `${Math.max(0, Math.min(SCREEN_W - win.offsetWidth, ox + p.x - start.x))}px`;
      win.style.top = `${Math.max(0, Math.min(SCREEN_H - 30, oy + p.y - start.y))}px`;
      win.style.right = 'auto';
      win.style.bottom = 'auto';
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
}
// Make the camera window bigger or smaller (drag the corner), or taller for a full-body view.
{
  const win = $('refwin');
  const grip = $('refwinGrip');
  const tall = $('refwinTall');
  const fit = (w) => {
    const asp = win.classList.contains('tall') ? 3 / 4 : 4 / 3;
    const maxH = SCREEN_H - 100;
    return Math.max(200, Math.min(w, SCREEN_W * 0.6, maxH * asp));
  };
  tall.addEventListener('click', () => {
    const on = !win.classList.contains('tall');
    win.classList.toggle('tall', on);
    tall.setAttribute('aria-pressed', String(on));
    win.style.width = `${fit(on ? 340 : 280)}px`;
    // Back to the corner the stylesheet gives it (clear of the Feel strip and the filmstrip).
    win.style.left = win.style.right = win.style.bottom = win.style.top = '';
    if (on) { win.style.top = '10px'; win.style.bottom = 'auto'; }
  });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const start = toScreen(e);
    const w0 = win.offsetWidth;
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const p = toScreen(ev);
      // the grip is on the bottom-left: dragging left or down makes it bigger
      win.style.width = `${fit(w0 + (start.x - p.x) + (p.y - start.y) * 0.5)}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
}
function showReference() {
  $('prefReference').checked = true;
  applyPrefs();
  saveSettings();
}

// ---------- Motion Rig: capture ----------
function setStatus(text, live = false) {
  $('trackStatus').textContent = text;
  $('trackStatus').classList.toggle('live', live);
}

async function startCamera() {
  if (state.source === 'camera') return stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('The camera only works at http://localhost on this laptop.', 5000);
    return;
  }
  $('btnCamera').disabled = true;
  showReference();
  try {
    setStatus('opening camera…');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    $('refEmpty').classList.add('hidden');
    if (!state.tracker) {
      setStatus('loading models…');
      state.tracker = await createTracker();
    }
    stopDemo();
    state.source = 'camera';
    rig.recenter();
    jointFilter.reset();
    $('btnCamera').textContent = 'Stop camera';
    setStatus('tracking', true);
    let checked = false;
    try { checked = localStorage.getItem(`rig.checkDone.${choice}`) === '1'; } catch {}
    if (!checked && activePuppet()) {
      closePopovers();
      rigCheck.start();
    }
  } catch (err) {
    console.error(err);
    toast(`Couldn't start the camera: ${err.message || err}`, 5000);
    stopCamera();
  } finally {
    $('btnCamera').disabled = false;
  }
}

function stopCamera() {
  video.srcObject?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  if (state.source === 'camera') state.source = 'none';
  octx.clearRect(0, 0, overlay.width, overlay.height);
  $('refEmpty').classList.remove('hidden');
  $('btnCamera').textContent = 'Start camera';
  setStatus('camera off');
}
function stopDemo() {
  if (state.source === 'demo') state.source = 'none';
  $('btnDemo').textContent = 'Demo motion';
}

$('btnCamera').addEventListener('click', startCamera);
$('btnDemo').addEventListener('click', () => {
  if (state.source === 'demo') {
    stopDemo();
    return;
  }
  stopCamera();
  state.source = 'demo';
  rig.recenter();
  $('btnDemo').textContent = 'Stop demo';
  setStatus('demo', true);
});
$('btnRecenter').addEventListener('click', () => {
  rig.recenter();
  toast('Character recentered');
});

// ---------- Motion Rig: character parts ----------
const PARTS = [
  ['head', 'Head', 'neutral'],
  ['headMouthOpen', 'Head', 'mouth open'],
  ['headBlink', 'Head', 'eyes closed'],
  ['torso', 'Torso', 'neck → hips'],
  ['upperArmR', 'Upper arm', 'screen left'],
  ['upperArmL', 'Upper arm', 'screen right'],
  ['foreArmR', 'Forearm + hand', 'screen left'],
  ['foreArmL', 'Forearm + hand', 'screen right'],
  ['thighR', 'Thigh', 'screen left'],
  ['thighL', 'Thigh', 'screen right'],
  ['shinR', 'Shin + foot', 'screen left'],
  ['shinL', 'Shin + foot', 'screen right'],
];
const parts = {};

function renderParts() {
  const list = $('partsList');
  list.innerHTML = '';
  for (const [key, label, sub] of PARTS) {
    const el = document.createElement('label');
    el.className = 'part' + (parts[key] ? ' filled' : '');
    const thumb = document.createElement('span');
    thumb.className = 'part-thumb';
    if (parts[key]) thumb.style.backgroundImage = `url(${parts[key].src})`;
    else thumb.textContent = '+';
    const text = document.createElement('span');
    text.innerHTML = `${label}<small>${sub}</small>`;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/*';
    input.addEventListener('change', () => input.files[0] && loadPart(key, input.files[0]));
    el.append(thumb, text, input);
    list.append(el);
  }
}

// Downscale to keep saved parts small enough for browser storage.
async function loadPart(key, file) {
  const raw = await imageFromSrc(URL.createObjectURL(file));
  const k = Math.min(1, 512 / Math.max(raw.width, raw.height));
  const c = document.createElement('canvas');
  c.width = Math.round(raw.width * k);
  c.height = Math.round(raw.height * k);
  c.getContext('2d').drawImage(raw, 0, 0, c.width, c.height);
  parts[key] = await imageFromSrc(c.toDataURL('image/png'));
  try {
    localStorage.setItem('rig.part.' + key, parts[key].src);
  } catch {
    toast('Part loaded, but too big to remember after a reload.');
  }
  renderParts();
}
(async () => {
  for (const [key] of PARTS) {
    try {
      const src = localStorage.getItem('rig.part.' + key);
      if (src) parts[key] = await imageFromSrc(src);
    } catch {}
  }
  renderParts();
})();
$('btnClearParts').addEventListener('click', () => {
  for (const [key] of PARTS) {
    delete parts[key];
    try { localStorage.removeItem('rig.part.' + key); } catch {}
  }
  renderParts();
});

// ---------- Motion Rig: joints readout ----------
const FACE_KEYS = [['jaw', 'Mouth open'], ['blinkR', 'Blink (left)'], ['blinkL', 'Blink (right)'], ['smile', 'Smile'], ['browUp', 'Brows up']];
$('faceMeters').innerHTML = FACE_KEYS.map(([k, l]) => `<div class="meter"><span>${l}</span><div class="meter-bar"><i data-k="${k}"></i></div></div>`).join('');
function renderJoints() {
  const cell = (v) => (v == null ? '<td class="dim">—</td>' : `<td>${v}°</td>`);
  $('jointsTable').innerHTML =
    '<tr class="dim"><td>Joint</td><td>Left side</td><td>Right side</td></tr>' +
    jointAngles(state.joints).map(([name, r, l]) => `<tr><td>${name}</td>${cell(r)}${cell(l)}</tr>`).join('') +
    `<tr><td>Head tilt</td><td></td><td>${Math.round((rig.face.roll * 180) / Math.PI)}°</td></tr>`;
  for (const i of document.querySelectorAll('.meter-bar i')) i.style.width = `${Math.round(rig.face[i.dataset.k] * 100)}%`;
}
setInterval(() => {
  if (!document.querySelector('[data-subpane="joints"]').classList.contains('hidden')) renderJoints();
}, 120);

// ---------- Motion Rig: record performance ----------
let recorder = null;
$('btnRecord').addEventListener('click', () => {
  if (recorder) return recorder.stop();
  if (!composite.captureStream || !window.MediaRecorder) return toast('Recording is not supported in this browser.');
  flatten();
  const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const chunks = [];
  recorder = new MediaRecorder(composite.captureStream(30), type ? { mimeType: type } : {});
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    download(URL.createObjectURL(blob), `performance-${stamp()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    recorder = null;
    $('btnRecord').classList.remove('recording');
    $('recLabel').textContent = 'Record performance';
    toast('Recording saved');
  };
  recorder.start();
  $('btnRecord').classList.add('recording');
  $('recLabel').textContent = 'Stop recording';
});

// ---------- characters ----------
// "beanie" (sample drawing), "custom" (your own drawing or PSD), or "basic" (shape figure).
// Bundled characters (characters/<key>.json), plus your own drawing or PSD as "custom".
const SAMPLES = ['redcap', 'beanie'];
const characters = { redcap: null, beanie: null, custom: null };
let choice = 'redcap';
try { choice = localStorage.getItem('rig.charChoice3') || 'redcap'; } catch {}
const activePuppet = () => (choice === 'basic' || choice === 'doodle' || choice === 'walk' ? null : characters[choice]);

// ---------- character views (front, three-quarter, side, back) ----------
// A character can carry several drawn views; the rig is shared, and the view in use is chosen
// from the Rig Lab (or from how far the performer's body turns).
const view = { id: 'front', flip: false, yaw: 0, since: 0 };
const viewPuppet = () => {
  const p = activePuppet();
  return p ? p.views?.[view.id] || p : null;
};
const building = new Set();
async function ensureView(p, id) {
  const src = p.viewSources?.[id];
  const key = `${p.name}/${id}`;
  if (!src || p.views[id] || building.has(key)) return;
  building.add(key);
  try {
    const img = await imageFromSrc(src.image);
    p.views[id] = buildPuppet(src.def, img, { overlap: overlapOn() });
  } catch (err) {
    console.error(err);
    toast(`Couldn't build the ${id} view.`);
  } finally {
    building.delete(key);
  }
}
// Set the view in use (and mirror it when it faces left). Returns false if it isn't built yet.
function setView(id, flip) {
  const p = activePuppet();
  if (!p) return false;
  if (!p.views?.[id]) {
    ensureView(p, id);
    return false;
  }
  view.flip = flip && id !== 'front' && id !== 'back';
  if (id !== view.id) {
    view.id = id;
    rig.setCharacter(p.views[id], { keepPose: true }); // this view's proportions, same pose
    cloth.reset();
  }
  return true;
}
// Which view the body turn calls for, with a little hysteresis so it doesn't flicker at the edges.
function viewForYaw(yaw, invert) {
  const a = Math.abs(yaw);
  const order = ['front', 'threequarter', 'side', 'back'];
  const edges = [22, 62, 118]; // between front|¾, ¾|side, side|back
  let i = order.indexOf(view.id);
  if (i < 0) i = 0;
  for (let k = 0; k < 8; k++) {
    if (i < 3 && a > edges[i] + 6) i++;
    else if (i > 0 && a < edges[i - 1] - 6) i--;
    else break;
  }
  const dir = (yaw > 0) !== invert; // which way the performer faces: the drawn views face right
  return { id: order[i], flip: !dir };
}
const correctives = createCorrectives();
const jointBalls = createJointBalls();
const sources = {}; // key → { def, img }, kept for rebuilding
const overlapOn = () => document.getElementById('labOverlap')?.checked !== false;

// remember: false when falling back on load, so a failed load isn't saved as your choice.
function selectCharacter(next, { remember = true } = {}) {
  if (next !== 'basic' && next !== 'doodle' && next !== 'walk' && !characters[next]) next = SAMPLES.find((k) => characters[k]) || 'doodle';
  choice = next;
  if (remember) {
    try { localStorage.setItem('rig.charChoice3', choice); } catch {}
  }
  for (const r of document.querySelectorAll('input[name="charChoice"]')) r.checked = r.value === choice;
  for (const b of document.querySelectorAll('#charSwitch button')) b.classList.toggle('on', b.dataset.char === choice);
  for (const b of document.querySelectorAll('#labChar button')) b.classList.toggle('active', b.dataset.char === choice);
  if (typeof syncWalkLab === 'function') syncWalkLab();
  $('basicParts').classList.toggle('hidden', choice !== 'basic');
  const p = activePuppet();
  view.id = 'front';
  if (p) rig.setCharacter(p);
  else rig.resetCharacter();
  rig.recenter();
  cloth.reset();
  correctives.load(choice === 'custom' && p ? `custom:${p.name}` : choice);
}
for (const r of document.querySelectorAll('input[name="charChoice"]')) r.addEventListener('input', () => selectCharacter(r.value));
const walkLab = $('labWalk');
function syncWalkLab() {
  walkLab.classList.toggle('hidden', choice !== 'walk');
  $('labWalkSpeedOut').textContent = `${walk.speed.toFixed(2)}×`;
  $('labWalkBlendOut').textContent = `${Math.round(walk.blend * 100)}%`;
  $('labWalkSizeOut').textContent = `${Math.round($('charScale').value * 100)}%`;
}
$('labWalkOn').addEventListener('input', (e) => { walk.on = e.target.checked; });
$('labWalkSkel').addEventListener('input', (e) => { walk.skel = e.target.checked; });
$('labWalkArt').addEventListener('input', (e) => { walk.art = e.target.checked; });
$('labWalkTravel').addEventListener('input', (e) => { walk.travel = e.target.checked; });
$('labWalkSpeed').addEventListener('input', (e) => { walk.speed = Number(e.target.value); syncWalkLab(); });
$('labWalkBlend').addEventListener('input', (e) => { walk.blend = Number(e.target.value); syncWalkLab(); });
$('labWalkSize').addEventListener('input', (e) => { $('charScale').value = e.target.value; $('charScale').dispatchEvent(new Event('input', { bubbles: true })); syncWalkLab(); });
$('charScale').addEventListener('input', () => { $('labWalkSize').value = $('charScale').value; syncWalkLab(); });
for (const b of document.querySelectorAll('#charSwitch button, #labChar button')) b.addEventListener('click', () => selectCharacter(b.dataset.char));

function showCustom(p) {
  characters.custom = p;
  $('rowCustom').classList.toggle('hidden', !p);
  if (p) $('customName').textContent = p.name;
}

// Saved custom character: the drawing (or PSD layers) plus its joints, kept in this browser.
function saveCustom(def, img) {
  const toURL = (c) => (c.toDataURL ? c.toDataURL('image/png') : c.src);
  const data = {
    name: def.name, joints: def.joints, face: def.face || null, image: toURL(img),
    layers: def.layers ? def.layers.map((l) => ({ bone: l.bone, x0: l.x0, y0: l.y0, src: toURL(l.canvas) })) : null,
  };
  try {
    localStorage.setItem('rig.custom', JSON.stringify(data));
  } catch {
    toast('Character built, but it is too large to remember after a reload.');
  }
}
async function loadCustom() {
  let data;
  try { data = JSON.parse(localStorage.getItem('rig.custom') || 'null'); } catch {}
  if (!data) return null;
  const img = await imageFromSrc(data.image);
  const def = { name: data.name, joints: data.joints, face: data.face };
  if (data.layers) {
    def.layers = await Promise.all(data.layers.map(async (l) => {
      const im = await imageFromSrc(l.src);
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      c.getContext('2d').drawImage(im, 0, 0);
      return { bone: l.bone, x0: l.x0, y0: l.y0, canvas: c };
    }));
  }
  return buildPuppet(def, img);
}

// Drawings exported with a white background: clear the white that touches the edges,
// keeping white fills that sit inside outlines.
function clearOuterWhite(canvas) {
  const { width: W, height: H } = canvas;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 10) transparent++;
  if (transparent > 20) return; // already has a transparent background
  const white = (i) => d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235;
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || !white(p * 4)) continue;
    seen[p] = 1;
    d[p * 4 + 3] = 0;
    const x = p % W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (p >= W) stack.push(p - W);
    if (p < W * (H - 1)) stack.push(p + W);
  }
  g.putImageData(im, 0, 0);
}

async function drawingToCanvas(file) {
  const raw = await imageFromSrc(URL.createObjectURL(file));
  const k = Math.min(1, 1400 / raw.height, 1400 / raw.width);
  const c = document.createElement('canvas');
  c.width = Math.round(raw.width * k);
  c.height = Math.round(raw.height * k);
  c.getContext('2d').drawImage(raw, 0, 0, c.width, c.height);
  clearOuterWhite(c);
  return c;
}

$('newCharFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  closePopovers();
  const canvas = await drawingToCanvas(file);
  const placed = await editJoints(canvas, { autoDetect: true });
  if (!placed) return;
  const def = { name: file.name.replace(/\.[^.]+$/, '') || 'My drawing', joints: placed.joints, face: placed.face };
  showCustom(buildPuppet(def, canvas));
  saveCustom(def, canvas);
  selectCharacter('custom');
  toast('Character built from your drawing.');
});

$('importPsd').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  closePopovers();
  let psd;
  try {
    psd = readLayeredPSD(await file.arrayBuffer());
  } catch (err) {
    console.error(err);
    return toast("Couldn't read that PSD.");
  }
  if (!psd.layers.length) {
    return toast(`No body-part layers found. Name layers like: ${Object.values(PART_LABELS).join(', ')}.`, 7000);
  }
  // Same canvas size as the current character: keep its joints. Otherwise place them.
  const current = activePuppet();
  let joints = current && current.img.width === psd.width && current.img.height === psd.height ? current.def.joints : null;
  let face = current && joints ? current.face : null;
  const placed = await editJoints(psd.flat, { joints, face, autoDetect: !joints });
  if (!placed) return;
  joints = placed.joints;
  face = placed.face;
  const def = { name: file.name.replace(/\.[^.]+$/, ''), joints, face, layers: psd.layers };
  showCustom(buildPuppet(def, psd.flat));
  saveCustom(def, psd.flat);
  selectCharacter('custom');
  toast(`Imported ${psd.layers.length} part layers.`);
});

$('btnEditJoints').addEventListener('click', async () => {
  const p = activePuppet();
  if (!p) return toast('Choose a drawn character first.');
  closePopovers();
  const placed = await editJoints(p.img, { joints: p.def.joints, face: p.face, autoDetect: false });
  if (!placed) return;
  const def = { ...p.def, joints: placed.joints, face: placed.face || p.face };
  const rebuilt = buildPuppet(def, p.img);
  characters[choice] = rebuilt;
  if (choice === 'custom') {
    showCustom(rebuilt);
    saveCustom(def, p.img);
  } else {
    try { localStorage.setItem(`rig.${choice}.joints`, JSON.stringify(def.joints)); } catch {}
  }
  selectCharacter(choice);
});

$('btnExportSvg').addEventListener('click', () => {
  const p = activePuppet();
  if (!p) return toast('Choose a drawn character first.');
  toast('Tracing vectors…', 1500);
  setTimeout(() => {
    downloadBlob(new Blob([layeredSVG(p)], { type: 'image/svg+xml' }), `${p.name.toLowerCase().replace(/\s+/g, '-')}-rig.svg`);
  }, 30);
});
$('btnExportPsd').addEventListener('click', () => {
  const p = activePuppet();
  if (!p) return toast('Choose a drawn character first.');
  const buf = layeredPSD(p);
  downloadBlob(new Blob([buf], { type: 'image/vnd.adobe.photoshop' }), `${p.name.toLowerCase().replace(/\s+/g, '-')}-parts.psd`);
});

// Remember how to build each extra view; they are built the first time they are needed.
function registerViews(p, def) {
  p.views = { front: p };
  p.viewSources = {};
  for (const [id, v] of Object.entries(def.views || {})) {
    const { views, joints, ...rest } = def;
    p.viewSources[id] = { image: v.image, def: { ...rest, ...v, name: def.name, joints: v.joints, face: v.face || null } };
  }
}

(async () => {
  for (const key of SAMPLES) {
    try {
      const def = await (await fetch(`characters/${key}.json`)).json();
      try {
        const saved = JSON.parse(localStorage.getItem(`rig.${key}.joints`) || 'null');
        if (saved) def.joints = saved;
      } catch {}
      const img = await imageFromSrc(def.image);
      sources[key] = { def, img };
      characters[key] = buildPuppet(def, img, { overlap: overlapOn() });
      registerViews(characters[key], def);
    } catch (err) {
      console.error(err);
      toast(`Couldn't load the ${key} character.`);
    }
  }
  try {
    showCustom(await loadCustom());
  } catch (err) {
    console.error(err);
  }
  selectCharacter(choice, { remember: false });
})();

// ---------- drawing the character ----------
const thumbRenderer = createRenderer();
const basicCanvas = document.createElement('canvas');
const WALK_FRAMES = 12, WALK_W = 162, WALK_H = 386, WALK_FPS = 12;
const WALK_STAND = 11;      // the frame with the legs closest together, shown when walking is off
const WALK_STEP_H = 0.021; // ground covered per frame, in character heights, so the feet don't slide
const walk = { on: true, travel: true, speed: 1, blend: 0.4, phase: 0, dist: 0, last: 0, art: true, skel: true };
// Joint positions for each walk frame (in sprite pixels), from the pose tracker run on the drawings.
let walkJoints = null;
fetch('characters/walk-skeleton.json').then((r) => r.json()).then((j) => { walkJoints = j; }).catch(() => {});
const WALK_BONES = [['head', 'neck'], ['neck', 'hip'], ['neck', 'fElbow'], ['fElbow', 'fWrist'], ['hip', 'fKnee'], ['fKnee', 'fAnkle'], ['fAnkle', 'fToe'],
  ['neck', 'nElbow'], ['nElbow', 'nWrist'], ['hip', 'nKnee'], ['nKnee', 'nAnkle'], ['nAnkle', 'nToe']];
function drawWalkSkeleton(target, i, f, ox, oy, k, alpha) {
  if (!walkJoints) return;
  const A = walkJoints[i], B = walkJoints[(i + 1) % WALK_FRAMES];
  const J = {};
  for (const n of Object.keys(A)) J[n] = [ox + (A[n][0] + (B[n][0] - A[n][0]) * f) * k, oy + (A[n][1] + (B[n][1] - A[n][1]) * f) * k];
  target.save();
  target.globalAlpha = alpha;
  target.lineCap = 'round';
  for (const [a, b] of WALK_BONES) {
    const far = a[0] === 'f' || b[0] === 'f';
    target.strokeStyle = far ? 'rgba(80,190,255,.95)' : 'rgba(255,255,255,.98)';
    target.lineWidth = Math.max(2, 7 * k);
    target.beginPath(); target.moveTo(...J[a]); target.lineTo(...J[b]); target.stroke();
  }
  const r = Math.max(3, 8 * k);
  target.beginPath(); target.arc(J.head[0], J.head[1], 38 * k, 0, Math.PI * 2);
  target.strokeStyle = 'rgba(255,255,255,.9)'; target.lineWidth = Math.max(2, 4 * k); target.stroke();
  for (const [n, p] of Object.entries(J)) {
    target.beginPath(); target.arc(p[0], p[1], n === 'hip' ? r * 1.4 : r, 0, Math.PI * 2);
    target.fillStyle = n === 'hip' ? '#ff5a3c' : '#ffb62e'; target.fill();
    target.lineWidth = Math.max(1.5, 2.5 * k); target.strokeStyle = '#1b1b22'; target.stroke();
  }
  target.restore();
}
// Called once per rendered frame: advances the walk phase and the distance travelled.
function walkTick(now) {
  const dt = walk.last ? Math.min((now - walk.last) / 1000, 0.1) : 0;
  walk.last = now;
  if (choice !== 'walk' || !walk.on) return;
  const adv = dt * WALK_FPS * walk.speed;
  walk.phase = (walk.phase + adv) % WALK_FRAMES;
  walk.dist += adv * WALK_STEP_H;
}
const walkSheet = new Image();
walkSheet.src = 'characters/walk-sheet.png';

// Draw the character in the rig's current pose. Returns the solved joint positions.
// fitH: the height to fit the character into (less than H when the timeline covers the bottom).
function drawCharacter(target, W, H, r, { mul = 1, alpha = 1, fitH = H, shift = null } = {}) {
  const scale = Number($('charScale').value) * mul;
  if (choice === 'doodle') {
    const P = rig.solve(W, fitH, scale * 1.2, shift);
    drawDoodle(target, rig, P, { alpha });
    return P;
  }
  if (choice === 'walk') {
    // Prototype: the 12-frame side-view walk cycle, drawn inside the character's box.
    const P = rig.solve(W, fitH, scale * 1.2, shift);
    if (walkSheet.complete && walkSheet.naturalWidth) {
      // The feet stay on the same ground line; the Size slider grows the walker upward from there.
      const b = charBox(rig.solve(W, fitH, 1.2 * mul, shift));
      const h = (b.y1 - b.y0) * 1.02 * Number($('charScale').value);
      const w = h * (WALK_W / WALK_H);
      let cx = (b.x0 + b.x1) / 2;
      if (walk.on && walk.travel) cx = -w / 2 + ((walk.dist * h) % (W + w)); // enters left, leaves right, comes round again
      const at = (i, a) => {
        target.globalAlpha = a;
        target.drawImage(walkSheet, i * WALK_W, 0, WALK_W, WALK_H, cx - w / 2, b.y1 - h, w, h);
      };
      target.save();
      const i = walk.on ? Math.floor(walk.phase) % WALK_FRAMES : WALK_STAND;
      const f = walk.on ? walk.phase - Math.floor(walk.phase) : 0;
      if (walk.art) {
        at(i, alpha);
        // Fade into the next drawing over the last part of each frame, so slow walks stay smooth.
        const t = walk.on && walk.blend > 0 ? Math.max(0, (f - (1 - walk.blend)) / walk.blend) : 0;
        if (t > 0) at((i + 1) % WALK_FRAMES, alpha * t * t * (3 - 2 * t));
      }
      if (walk.skel) drawWalkSkeleton(target, i, f, cx - w / 2, b.y1 - h, h / WALK_H, alpha);
      target.restore();
    }
    return P;
  }
  const p = viewPuppet();
  if (p) {
    const P = rig.solve(W, fitH, scale * 1.2, shift);
    drawPuppet(target, p, rig, P, r, alpha, view.flip);
    if (alpha === 1 && view.id === 'front' && $('optCorrect').checked) correctives.draw(target, rig, P);
    // Round, colour-matched joints that fade in as a joint bends or stretches.
    if ($('labBalls')?.checked !== false) jointBalls.draw(target, p, rig, P, { alpha, flip: view.flip });
    return P;
  }
  if (basicCanvas.width !== W || basicCanvas.height !== H) {
    basicCanvas.width = W;
    basicCanvas.height = H;
  }
  const bctx = basicCanvas.getContext('2d');
  bctx.clearRect(0, 0, W, H);
  rig.draw(bctx, W, fitH, { scale, parts });
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = alpha;
  target.drawImage(basicCanvas, 0, 0);
  target.restore();
  return rig.points;
}

// Draw a stored pose without disturbing the live one.
function drawPose(target, W, H, pose, opts, r = renderer) {
  const live = rig.getPose();
  rig.setPose(pose);
  const P = drawCharacter(target, W, H, r, opts);
  rig.setPose(live);
  return P;
}

const timeline = createTimeline({
  rig,
  toast,
  character: () => {
    const p = activePuppet();
    return { name: p ? p.name : 'Basic figure', reference: p ? p.img : null };
  },
  renderPose: (target, W, H, pose, mul = 1) => drawPose(target, W, H, pose, { mul }, thumbRenderer),
});
const rigCheck = createRigCheck({
  rig,
  toast,
  correctives,
  renderPose: (target, W, H, pose) => drawPose(target, W, H, pose, {}, thumbRenderer),
  // Each character gets its own check, the first time the camera starts with it.
  onFinish: () => {
    try { localStorage.setItem(`rig.checkDone.${choice}`, '1'); } catch {}
  },
});
// ---------- Transform: select the character, drag to move it, drag a corner to resize ----------
// Applies to the whole character: the live rig and every frame of every take.
// Default: standing on the path in the middle of the scene, at a size that fits it.
const PLACE_DEFAULT = { x: 0, y: 0.13, s: 0.62 };
const place = { ...PLACE_DEFAULT };
try { Object.assign(place, JSON.parse(localStorage.getItem('rig.place') || '{}')); } catch {}
const savePlace = () => { try { localStorage.setItem('rig.place', JSON.stringify(place)); } catch {} };
let stageP = null;
const xform = $('xform');
// The character's box on the canvas, in stage pixels.
function charBox(P) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [k, p] of Object.entries(P)) {
    if (k === 'T') continue;
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const T = P.T;
  return { x0: x0 - T * 0.55, y0: y0 - T * 0.6, x1: x1 + T * 0.55, y1: y1 + T * 0.3 };
}
function placeBox(P) {
  if (!P) return;
  const b = charBox(P);
  const k = stage.width / $('workspace').offsetWidth; // stage pixels per screen point
  const ws = $('workspace');
  const top = ws.offsetTop;
  // Keep the box (and its corner handles) on screen even when the character runs off the edge.
  const m = 14;
  const L = Math.max(m, b.x0 / k), R = Math.min(ws.offsetWidth - m, b.x1 / k);
  const T = Math.max(m, b.y0 / k), B = Math.min(ws.offsetHeight - m, b.y1 / k);
  Object.assign(xform.style, { left: `${L}px`, top: `${top + T}px`, width: `${Math.max(40, R - L)}px`, height: `${Math.max(40, B - T)}px` });
}
function setTransform(on) {
  xform.classList.toggle('hidden', !on);
  $('xformBar').classList.toggle('hidden', !on);
  $('btnTransform').classList.toggle('active', on);
  $('btnTransform').setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('transforming', on);
  if (on) {
    closePopovers();
    placeBox(stageP);
    hints.show('transform', xform, 'Drag inside the box to <b>move</b> the character. Drag a <b>corner</b> to resize. It applies to every frame.', 'right');
  } else hints.hide();
}
$('btnTransform').addEventListener('click', () => setTransform(xform.classList.contains('hidden')));
$('xformDone').addEventListener('click', () => setTransform(false));
$('xformReset').addEventListener('click', () => {
  Object.assign(place, PLACE_DEFAULT);
  savePlace();
});
{
  let drag = null;
  xform.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    hints.hide();
    xform.setPointerCapture(e.pointerId);
    const r = stage.getBoundingClientRect();
    const handle = e.target.dataset.h;
    const b = stageP ? charBox(stageP) : null;
    // Resize around the box centre; move by the drag distance.
    const cx = b ? r.left + (((b.x0 + b.x1) / 2) * r.width) / stage.width : e.clientX;
    const cy = b ? r.top + (((b.y0 + b.y1) / 2) * r.height) / stage.height : e.clientY;
    drag = { handle, x: e.clientX, y: e.clientY, start: { ...place }, cx, cy, d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, rw: r.width, rh: r.height };
  });
  xform.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.handle) {
      const d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
      place.s = Math.max(0.25, Math.min(3, drag.start.s * (d / drag.d0)));
      $('xfSize').textContent = `${Math.round((place.s / PLACE_DEFAULT.s) * 100)}%`;
      $('xfSize').classList.remove('hidden');
    } else {
      place.x = drag.start.x + (e.clientX - drag.x) / drag.rw;
      place.y = drag.start.y + (e.clientY - drag.y) / drag.rh;
    }
  });
  const end = () => {
    if (drag) savePlace();
    drag = null;
    setTimeout(() => $('xfSize').classList.add('hidden'), 700);
  };
  xform.addEventListener('pointerup', end);
  xform.addEventListener('pointercancel', end);
}

// ---------- Takes: capture a pose or motion, land it in Layers, rig it ----------
const previewRenderer = createRenderer();
const tips = createTips(screenEl);
const hints = createHints(screenEl);
const takes = createTakes({
  hints,
  // What the capture bar's status light shows.
  status: () => {
    const live = state.source !== 'none';
    const t = $('trackStatus').textContent;
    if (state.source === 'demo') return { live, ok: true, label: 'Demo performer' };
    if (t === 'tracking') return { live, ok: true, label: 'Tracking you' };
    if (t === 'no one in view') return { live, ok: false, label: 'Step into view' };
    return { live, ok: false, label: t.charAt(0).toUpperCase() + t.slice(1) };
  },
  onStartCamera: () => startCamera(),
  onStartDemo: () => $('btnDemo').click(),
  onStopLive: () => {
    stopCamera();
    stopDemo();
    setStatus('camera off');
  },
  rig,
  toast,
  isLive: () => state.source !== 'none',
  renderPose: (target, W, H, pose, { mul = 1, which = 'thumb' } = {}) =>
    drawPose(target, W, H, pose, { mul }, which === 'preview' ? previewRenderer : thumbRenderer),
  // Joint positions for a pose, in the same layout renderPose uses.
  pointsFor: (pose, W, H) => {
    const live = rig.getPose();
    rig.setPose(pose);
    const P = rig.solve(W, H, Number($('charScale').value) * 1.2);
    rig.setPose(live);
    return P;
  },
  onOpenChange: (open) => open && closePopovers(),
});
window.takes = takes;

// Pose brush: in Rig mode, tap a part on the canvas to select it and drag to bend it.
function stagePoint(e) {
  const r = stage.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * stage.width) / r.width, y: ((e.clientY - r.top) * stage.height) / r.height };
}
let brushing = false;
screenEl.addEventListener('pointerdown', (e) => {
  if (!takes.brushActive() || !e.target.closest('#workspace')) return;
  e.stopPropagation();
  closePopovers();
  if (takes.brushDown(stagePoint(e))) {
    brushing = true;
    workspace.style.cursor = 'grabbing';
    screenEl.setPointerCapture(e.pointerId);
  }
}, true);
screenEl.addEventListener('pointermove', (e) => {
  if (!brushing) return;
  e.stopPropagation();
  takes.brushMove(stagePoint(e));
}, true);
const endBrush = (e) => {
  if (!brushing) return;
  e.stopPropagation();
  brushing = false;
  takes.brushUp();
};
screenEl.addEventListener('pointerup', endBrush, true);
screenEl.addEventListener('pointercancel', endBrush, true);

$('btnRigCheck').addEventListener('click', () => {
  closePopovers();
  if (!activePuppet()) return toast('Choose a drawn character first.');
  if (state.source === 'none') toast('Start the camera (or the demo) so the check can see your poses.', 4000);
  rigCheck.start();
});
$('btnClearFixes').addEventListener('click', () => {
  correctives.clear();
  toast('Joint fixes cleared for this character.');
});

$('btnOpenTimeline').addEventListener('click', () => {
  $('prefAnim').checked = true;
  applyPrefs();
  saveSettings();
  closePopovers();
});

// ---------- hold a pose to capture a frame ----------
// Watches how fast the rig's bones are turning. Holding still for the set time captures a
// frame; you then have to move before the next one, so one held pose gives one frame.
const hold = { prev: null, motion: 0, stillFor: 0, armed: true };
function watchHold(now, dt, live) {
  const hud = $('holdHud');
  const checking = rigCheck.active;
  if ((!$('optHold').checked && !checking) || !live || timeline.playing) {
    hud.classList.add('hidden');
    hold.prev = null;
    return;
  }
  let speed = 0;
  if (hold.prev) {
    for (const [k, a] of Object.entries(rig.angle)) speed += Math.abs(Math.atan2(Math.sin(a - hold.prev[k]), Math.cos(a - hold.prev[k])));
    speed /= Math.max(dt, 1 / 120);
  }
  hold.prev = { ...rig.angle };
  hold.motion += (speed - hold.motion) * Math.min(1, dt * 8); // rad/s summed over bones, eased

  const need = Number($('holdTime').value);
  const STILL = 0.9, MOVED = 2.2;
  if (!hold.armed) {
    if (hold.motion > MOVED) hold.armed = true;
    hold.stillFor = 0;
  } else if (hold.motion < STILL && (!checking || rigCheck.matches(rig.getPose()))) {
    hold.stillFor += dt;
  } else {
    hold.stillFor = 0;
  }

  hud.classList.remove('hidden');
  const k = Math.min(1, hold.stillFor / need);
  $('holdRing').style.strokeDashoffset = String(94.25 * (1 - k));
  hud.classList.toggle('done', !hold.armed);
  const wrongPose = checking && hold.armed && !rigCheck.matches(rig.getPose());
  $('holdText').textContent = !hold.armed ? 'Captured. Move to the next pose' : wrongPose ? rigCheck.hint : k > 0 ? 'Hold…' : 'Strike a pose and hold still';

  if (hold.armed && hold.stillFor >= need) {
    hold.armed = false;
    hold.stillFor = 0;
    const flash = $('captureFlash');
    flash.classList.remove('hidden');
    flash.style.animation = 'none';
    void flash.offsetWidth;
    flash.style.animation = '';
    if (checking) {
      rigCheck.capture(rig.getPose());
      return;
    }
    if ($('timeline').classList.contains('hidden')) {
      $('prefAnim').checked = true;
      applyPrefs();
      saveSettings();
    }
    toast(`Frame ${timeline.capture()} captured`, 1200);
  }
}

function drawGapMarks(target, regions) {
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  for (const { x, y, r } of regions) {
    target.fillStyle = 'rgba(255, 59, 48, 0.18)';
    target.strokeStyle = 'rgba(255, 59, 48, 0.9)';
    target.lineWidth = Math.max(2, r * 0.04);
    target.setLineDash([r * 0.12, r * 0.08]);
    target.beginPath();
    target.arc(x, y, r * 0.8, 0, Math.PI * 2);
    target.fill();
    target.stroke();
  }
  target.restore();
}

// ---------- motion feel presets ----------
for (const b of document.querySelectorAll('#feelBtns button')) {
  b.addEventListener('click', () => {
    const f = FEELS[b.dataset.feel];
    $('smoothing').value = f.smooth;
    $('bounce').value = f.bounce;
    $('follow').value = f.follow;
    applyPrefs();
    saveSettings();
  });
}

// ---------- Rig Lab ----------
function rebuildCharacters() {
  for (const [key, { def, img }] of Object.entries(sources)) {
    characters[key] = buildPuppet(def, img, { overlap: overlapOn() });
    registerViews(characters[key], def);
  }
  if (characters.custom) characters.custom = buildPuppet(characters.custom.def, characters.custom.img, { overlap: overlapOn() });
  selectCharacter(choice, { remember: false });
  toast(overlapOn() ? 'Rebuilt with overlapping hidden artwork.' : 'Rebuilt with parts edge to edge.');
}

async function correctiveForThisPose() {
  const p = activePuppet();
  if (!p) return toast('Choose a drawn character first.');
  const comfy = await comfyStatus();
  if (!comfy.ok) return toast("ComfyUI isn't running. Start it with scripts\\start-comfyui.ps1.", 5000);
  const pose = rig.getPose();
  toast('Making a corrective for this pose…', 4000);
  try {
    let found = 0;
    await fixGapsWithComfy({
      poses: [pose],
      renderPose: (target, W, H, ps) => drawPose(target, W, H, ps, {}, thumbRenderer),
      rest: rig.rest,
      settings: { denoise: 0.55, fast: comfy.cpu },
      onFrame: (_, frameCanvas, regions, P) => {
        found = regions.length;
        if (found) correctives.addFromFrame(frameCanvas, regions, P, pose);
      },
    });
    toast(found ? `Corrective saved for ${found} joint${found > 1 ? 's' : ''}.` : 'No chopped joints in this pose.', 4000);
  } catch (err) {
    console.error(err);
    toast(`Corrective failed: ${err.message}`, 5000);
  }
}

lab = createLab({
  onTest: () => rig.recenter(),
  onRebuild: rebuildCharacters,
  onCorrective: correctiveForThisPose,
  getStatus: () => {
    const p = activePuppet();
    const vertices = p ? p.pieces.reduce((n, pc) => n + ((pc.mesh || pc.mesh2d)?.count || 0), 0) : 0;
    return { view: view.id, yaw: Math.round(state.yaw), fps: Math.round(fps), renderer: renderer.constructor.name.replace('Renderer', '') || 'Canvas', vertices, fixes: correctives.count, character: p ? p.name : 'Basic figure' };
  },
});
$('labSecondary').addEventListener('input', () => ($('labSecondaryOut').textContent = `${Math.round($('labSecondary').value * 100)}%`));
$('labSecondaryOut').textContent = `${Math.round($('labSecondary').value * 100)}%`;

// ---------- main loop ----------
let last = performance.now();
let fps = 60;
function frame(now) {
  walkTick(now);
  const dt = (now - last) / 1000;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  last = now;
  const o = {
    body: $('optBody').checked,
    faceOn: $('optFace').checked,
    mirror: $('optMirror').checked,
    legRest: $('optLegRest').checked,
    smoothing: Number($('smoothing').value),
  };
  // While a take is recording, follow the camera closely; clean-up happens afterwards.
  if (takes.rawCapture) o.smoothing = Math.min(o.smoothing, 0.15);
  // The joint filter does most of the smoothing; the rig only eases the last bit.
  // Springs give every move its ease-in, ease-out and follow-through (motion.js).
  const test = lab?.pose(now, rig.rest);
  {
    // Which drawn view to show: a test's own, a locked one, or the one the body turn calls for.
    const ls = lab?.settings();
    let want = { id: 'front', flip: ls?.flip || false };
    if (ls?.view && ls.view !== 'auto') want = { id: ls.view, flip: ls.flip };
    else if (test?.view) want = { id: test.view, flip: ls?.flip || false };
    else if (state.source === 'camera' && state.joints) want = viewForYaw(state.yaw, ls?.turnInvert || false);
    setView(want.id, want.flip);
  }
  const rigOpts = {
    ...o,
    motion: { enabled: $('labSprings').checked, smooth: o.smoothing, follow: Number($('follow').value) },
    override: test?.override,
    offset: test?.offset,
  };
  let tracked = null;

  if (state.source === 'camera' && state.tracker && video.readyState >= 2) {
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      const raw = state.tracker.detect(video, o);
      const aspect = video.videoWidth / video.videoHeight;
      state.joints = raw.pose ? jointFilter.filter(poseToJoints(raw.pose, aspect, o.mirror), now / 1000, o.smoothing) : null;
      state.face = raw.face ? faceToExpression(raw.face, aspect, o.mirror) : null;
      if (raw.pose) state.yaw += (bodyYaw(raw.pose) * (o.mirror ? -1 : 1) - state.yaw) * 0.25; // smoothed
      if (overlay.width !== video.videoWidth) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }
      drawOverlay(octx, raw.pose, overlay.width, overlay.height);
      setStatus(raw.pose ? 'tracking' : 'no one in view', !!raw.pose);
    }
    tracked = { joints: state.joints, face: state.face };
  } else if (state.source === 'demo') {
    tracked = demoFrame(now / 1000);
    state.joints = tracked.joints;
    state.yaw += (tracked.yaw - state.yaw) * 0.2;
  }

  if (!window.motionRig?.freeze) {
    rig.update(tracked, dt, rigOpts);
    // How far the body is turned reaches the character, so a side or back view keeps your posture.
    const ov = window.motionRig?.turnOverride;
    if (ov != null) rig.face.turn = ov;
    else if (state.source === 'camera' || state.source === 'demo') rig.face.turn = Math.max(-2, Math.min(2, state.yaw / 90));
    else rig.face.turn = 0;
  }
  takes.record(now);
  cloth.frame(dt, Number($('bounce').value), Number($('labSecondary').value));

  const live = state.source !== 'none';
  watchHold(now, dt, live);
  const takeShown = takes.tick(now);
  const shown = takeShown || timeline.tick(now, live);
  const onion = takeShown ? takes.onionPose() : timeline.onionPose(live);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, stage.width, stage.height);
  const ws = $('workspace');
  const tl = $('timeline');
  // The filmstrip covers the bottom of the canvas while a take is open; the character fits above it.
  const covered = !tl.classList.contains('hidden') ? tl.offsetHeight : takes.editing ? 142 : 0;
  const fitH = covered ? stage.height * Math.max(0.5, 1 - covered / ws.offsetHeight) : stage.height;
  // Where the character sits on the canvas (Transform tool). Thumbnails and previews stay centred.
  const placed = { fitH, mul: place.s, shift: place };
  if (onion) drawPose(ctx, stage.width, stage.height, onion, { ...placed, alpha: 0.25 });
  let P;
  if (shown?.image) {
    // An AI-redrawn frame: draw it where the character would be.
    ctx.save();
    ctx.translate(0, 0);
    timeline.drawAI(ctx, stage.width, fitH, shown.image);
    ctx.restore();
    P = null;
  } else if (shown) {
    P = drawPose(ctx, stage.width, stage.height, shown.pose, placed);
  } else {
    P = drawCharacter(ctx, stage.width, stage.height, renderer, placed);
  }
  stageP = P;
  if (!xform.classList.contains('hidden')) placeBox(P);
  if (takeShown) {
    takes.lastP = P;
    takes.drawOverlay(ctx, P);
  }
  if (P && !shown?.image) drawRigView(ctx, activePuppet(), { mesh: $('optMesh').checked, weights: $('optWeights').checked });
  if ($('optSkeleton').checked && P) drawSkeleton(ctx, P);
  // Where the AI would repair this pose (joints bent far from the drawing).
  if (P && activePuppet() && $('tlShowGaps').checked) drawGapMarks(ctx, gapRegions(shown?.pose || rig.getPose(), P, rig.rest));
  if (recorder) flatten();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handle for poking at the rig from the browser console while prototyping.
window.motionRig = { rig, state, renderer: renderer.constructor.name };
document.documentElement.dataset.renderer = renderer.constructor.name;
// ?testpose[=armsup|cross|squat|down|rest]: freeze a test pose, for checking how the drawing bends.
{
  const which = new URLSearchParams(location.search).get('testpose');
  if (which !== null) {
    window.motionRig.freeze = true;
    const P = Math.PI;
    const POSES = {
      '': { upperArmR: -P + 0.5, foreArmR: -P / 2 - 0.3, upperArmL: -0.5, foreArmL: -P / 2 + 0.9, thighR: P / 2 + 0.5, shinR: P / 2 - 0.4, thighL: P / 2 - 0.15, shinL: P / 2 + 0.3 },
      armsup: { upperArmR: -P / 2 - 0.35, foreArmR: -P / 2 - 0.15, upperArmL: -P / 2 + 0.35, foreArmL: -P / 2 + 0.15 },
      cross: { upperArmR: P / 2 - 0.55, foreArmR: -0.25, upperArmL: P / 2 + 0.55, foreArmL: P + 0.25 },
      squat: { thighR: P / 2 + 0.95, shinR: P / 2 - 0.45, thighL: P / 2 - 0.95, shinL: P / 2 + 0.45 },
      down: { upperArmR: P / 2 + 0.15, foreArmR: P / 2 + 0.1, upperArmL: P / 2 - 0.15, foreArmL: P / 2 - 0.1 }, // arms at the sides
      rest: {}, // as drawn
    };
    // After the character has loaded (loading resets the pose).
    setTimeout(() => {
      Object.assign(rig.angle, POSES[which] ?? POSES['']);
      if (which === 'squat') rig.offset.y = 0.45;
    }, 2500);
  }
}
