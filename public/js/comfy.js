// Redraw frames with a local ComfyUI (http://127.0.0.1:8188, started with --enable-cors-header).
// For each frame: upload the posed frame, its OpenPose skeleton and its line guide, run
// img2img with two ControlNets (pose + line art), and bring the result back as an image.
import { frameGuides } from './aipack.js';

export const COMFY = 'http://127.0.0.1:8188';
const MODELS = {
  checkpoint: 'DreamShaper_8_pruned.safetensors',
  pose: 'control_v11p_sd15_openpose_fp16.safetensors',
  lineart: 'control_v11p_sd15_lineart_fp16.safetensors',
  lcm: 'lcm-lora-sdv1-5.safetensors', // speed-up for processor-only runs
};
export const DEFAULT_PROMPT =
  'clean black and white ink line art, hand-drawn illustration, consistent bold outlines, pure white background, ' +
  'young person wearing a plain folded beanie, rectangular black glasses, small smile, oversized white sweatshirt, ' +
  'solid black baggy pants, white sneakers, empty open hands, full body';
const NEGATIVE = 'color, grey shading, grey background, gradient, blurry, sketchy double lines, pompom, holding object, cup, phone, no glasses, extra limbs, extra fingers, deformed hands, realistic face, text, watermark, background scenery';

// { ok, cpu }: whether ComfyUI is running, and whether it has only the processor to work with.
export async function comfyStatus() {
  try {
    const r = await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ok: false };
    const stats = await r.json();
    return { ok: true, cpu: (stats.devices || []).every((d) => d.type === 'cpu') };
  } catch {
    return { ok: false };
  }
}

async function upload(blob, name) {
  const form = new FormData();
  form.append('image', blob, name);
  form.append('overwrite', 'true');
  const r = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Upload failed (${r.status})`);
  return (await r.json()).name;
}

// fast: processor mode. Half resolution and LCM-LoRA (6 steps instead of 24): minutes, not an hour.
function workflow({ frame, pose, lineart, seed, denoise, prompt, poseStrength, lineStrength, fast }) {
  const wf = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: MODELS.checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE, clip: ['1', 1] } },
    4: { class_type: 'LoadImage', inputs: { image: frame } },
    5: { class_type: 'LoadImage', inputs: { image: pose } },
    6: { class_type: 'LoadImage', inputs: { image: lineart } },
    7: { class_type: 'ControlNetLoader', inputs: { control_net_name: MODELS.pose } },
    8: { class_type: 'ControlNetLoader', inputs: { control_net_name: MODELS.lineart } },
    9: {
      class_type: 'ControlNetApplyAdvanced',
      inputs: { positive: ['2', 0], negative: ['3', 0], control_net: ['7', 0], image: ['5', 0], strength: poseStrength, start_percent: 0, end_percent: 1 },
    },
    10: {
      class_type: 'ControlNetApplyAdvanced',
      inputs: { positive: ['9', 0], negative: ['9', 1], control_net: ['8', 0], image: ['6', 0], strength: lineStrength, start_percent: 0, end_percent: 0.8 },
    },
    11: { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } },
    12: {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['10', 0], negative: ['10', 1], latent_image: ['11', 0],
        seed, steps: 24, cfg: 6.5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise,
      },
    },
    13: { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['1', 2] } },
    14: { class_type: 'SaveImage', inputs: { images: ['13', 0], filename_prefix: 'motion-rig/redraw' } },
  };
  if (fast) {
    wf[15] = { class_type: 'LoraLoader', inputs: { model: ['1', 0], clip: ['1', 1], lora_name: MODELS.lcm, strength_model: 1, strength_clip: 1 } };
    wf[2].inputs.clip = wf[3].inputs.clip = ['15', 1];
    Object.assign(wf[12].inputs, { model: ['15', 0], steps: 6, cfg: 1.5, sampler_name: 'lcm', scheduler: 'sgm_uniform' });
    // Scale the three guide images down to 512x384 before they're used.
    for (const [id, src] of [[16, '4'], [17, '5'], [18, '6']]) {
      wf[id] = { class_type: 'ImageScale', inputs: { image: [src, 0], upscale_method: 'area', width: 512, height: 384, crop: 'disabled' } };
    }
    wf[11].inputs.pixels = ['16', 0];
    wf[9].inputs.image = ['17', 0];
    wf[10].inputs.image = ['18', 0];
  }
  return wf;
}

async function waitForResult(id, signal) {
  for (;;) {
    if (signal?.aborted) {
      // Stop the job in ComfyUI too, not just our waiting for it.
      await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});
      throw new Error('Cancelled');
    }
    const r = await fetch(`${COMFY}/history/${id}`);
    const h = (await r.json())[id];
    if (h?.status?.status_str === 'error') {
      const msg = h.status.messages?.find((m) => m[0] === 'execution_error')?.[1]?.exception_message;
      throw new Error(msg || 'ComfyUI reported an error');
    }
    const img = h?.outputs?.['14']?.images?.[0];
    if (img) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
      const blob = await (await fetch(`${COMFY}/view?${q}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      return c;
    }
    await new Promise((res) => setTimeout(res, 400));
  }
}

// poses → redrawn canvases (white background), one at a time. onFrame(i, canvas) is called as each finishes.
export async function redrawWithComfy({ poses, renderPose, settings, onFrame, signal }) {
  const seed = settings.seed ?? 20261020; // same seed every frame keeps the frames consistent
  const out = [];
  for (let i = 0; i < poses.length; i++) {
    if (signal?.aborted) throw new Error('Cancelled');
    const g = await frameGuides(poses[i], renderPose);
    const tag = `mr_${Date.now().toString(36)}_${i}`;
    const [frame, pose, lineart] = await Promise.all([
      upload(g.frame, `${tag}_frame.png`),
      upload(g.pose, `${tag}_pose.png`),
      upload(g.lineart, `${tag}_line.png`),
    ]);
    const r = await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow({ frame, pose, lineart, seed, ...settings }) }),
    });
    const body = await r.json();
    if (!r.ok || body.error) {
      const detail = body.error?.message || (body.node_errors && JSON.stringify(body.node_errors)) || `status ${r.status}`;
      throw new Error(`ComfyUI didn't accept the job: ${detail}`);
    }
    const canvas = await waitForResult(body.prompt_id, signal);
    out.push(canvas);
    onFrame?.(i, canvas);
  }
  return out;
}

// ---------------------------------------------------------------- gap fixing (inpainting)
// Keep the drawing exactly as it is and repaint only where the rig bends a joint far from the
// drawn pose (where cut parts show). Each frame: find those joints, paint a soft mask around
// them, inpaint a crop of just that area, and blend the result back through the mask.

// [child bone, parent bone, joint, mask radius in torso lengths]
const GAP_HINGES = [
  ['neck', 'spine', 'headPivot', 0.24],
  ['upperArmR', 'spine', 'shoulderR', 0.3],
  ['upperArmL', 'spine', 'shoulderL', 0.3],
  ['foreArmR', 'upperArmR', 'elbowR', 0.22],
  ['foreArmL', 'upperArmL', 'elbowL', 0.22],
  ['thighR', 'spine', 'hipR', 0.26],
  ['thighL', 'spine', 'hipL', 0.26],
  ['shinR', 'thighR', 'kneeR', 0.22],
  ['shinL', 'thighL', 'kneeL', 0.22],
];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Bend of a hinge relative to the drawing's own pose (0 = as drawn).
export function hingeBend(pose, child, parent, rest) {
  let bend = wrap(pose.angle[child] - pose.angle[parent] - (rest[child] - rest[parent]));
  if (child === 'neck') bend += (pose.face?.roll || 0) * 0.6; // the head also tilts with your face
  return bend;
}
// Where a hinge sits on screen. The neck repair centres on the collar, keeping the face out of it.
export function jointPoint(P, joint) {
  return joint === 'headPivot' ? { x: P.neck.x * 0.8 + P.head.x * 0.2, y: P.neck.y * 0.8 + P.head.y * 0.2 } : P[joint];
}

// Areas to repair for a pose. P: solved joints (pixels) from renderPose; rest: the drawing's rest angles.
export function gapRegions(pose, P, rest, threshold = 0.3) {
  if (!P || !rest) return [];
  const out = [];
  for (const [child, parent, joint, r] of GAP_HINGES) {
    const bend = hingeBend(pose, child, parent, rest);
    if (Math.abs(bend) < threshold) continue;
    // The neck hinge sits between the shoulder line and the head.
    const at = jointPoint(P, joint);
    if (at) out.push({ x: at.x, y: at.y, r: r * P.T * (1 + Math.min(1, Math.abs(bend)) * 0.25), joint, child, parent, bend });
  }
  return out;
}

export function maskCanvas(w, h, regions) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  for (const { x, y, r } of regions) {
    const grad = g.createRadialGradient(x, y, r * 0.55, x, y, r);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

const blobOf = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/png'));

// Repairs describe the linework, not the character, so the AI mends lines instead of drawing someone new.
export const REPAIR_PROMPT = 'black ink line art, clean continuous outlines joining smoothly, solid white fill, ' +
  'simple hand-drawn illustration, seamless clothing seam, same line weight as the surrounding drawing';
const REPAIR_NEGATIVE = 'person, figure, face, character, extra head, extra limbs, new objects, text, colour, grey, shading, gradient, blurry, gap, broken line';

function inpaintWorkflow({ image, mask, seed, denoise, fast }) {
  const wf = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: MODELS.checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: REPAIR_PROMPT, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: REPAIR_NEGATIVE, clip: ['1', 1] } },
    4: { class_type: 'LoadImage', inputs: { image } },
    5: { class_type: 'LoadImage', inputs: { image: mask } },
    6: { class_type: 'ImageToMask', inputs: { image: ['5', 0], channel: 'red' } },
    7: { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } },
    8: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['7', 0], mask: ['6', 0] } },
    9: {
      class_type: 'KSampler',
      inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['8', 0], seed, steps: 20, cfg: 6, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise },
    },
    10: { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['1', 2] } },
    14: { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: 'motion-rig/gapfix' } },
  };
  if (fast) {
    wf[15] = { class_type: 'LoraLoader', inputs: { model: ['1', 0], clip: ['1', 1], lora_name: MODELS.lcm, strength_model: 1, strength_clip: 1 } };
    wf[2].inputs.clip = wf[3].inputs.clip = ['15', 1];
    Object.assign(wf[9].inputs, { model: ['15', 0], steps: 6, cfg: 1.5, sampler_name: 'lcm', scheduler: 'sgm_uniform' });
  }
  return wf;
}

async function queue(prompt, signal) {
  const r = await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
  const body = await r.json();
  if (!r.ok || body.error) {
    const detail = body.error?.message || (body.node_errors && JSON.stringify(body.node_errors)) || `status ${r.status}`;
    throw new Error(`ComfyUI didn't accept the job: ${detail}`);
  }
  return waitForResult(body.prompt_id, signal);
}

// Returns, per pose, the original frame with only its gap areas repainted (or untouched when
// the pose has no gaps). onFrame(i, canvas, regions) is called as each finishes.
export async function fixGapsWithComfy({ poses, renderPose, rest, settings, onFrame, signal }) {
  const W = 1024, H = 768;
  const seed = settings.seed ?? 20261020;
  const out = [];
  for (let i = 0; i < poses.length; i++) {
    if (signal?.aborted) throw new Error('Cancelled');
    // The frame exactly as the rig draws it, on white.
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    const P = renderPose(layer.getContext('2d'), W, H, poses[i]);
    const frame = document.createElement('canvas');
    frame.width = W;
    frame.height = H;
    const fg = frame.getContext('2d');
    fg.fillStyle = '#fff';
    fg.fillRect(0, 0, W, H);
    fg.drawImage(layer, 0, 0);

    const regions = gapRegions(poses[i], P, rest, settings.threshold);
    if (!regions.length) {
      out.push(frame);
      onFrame?.(i, frame, regions, P);
      continue;
    }
    const mask = maskCanvas(W, H, regions);

    // Crop around the repair areas with plenty of the drawing around them for context, and work
    // at up to 512 px: faster, and finer detail.
    const ctxPad = Math.max(...regions.map((g) => g.r)) * 1.3;
    let x0 = Math.min(...regions.map((g) => g.x - g.r)) - ctxPad;
    let y0 = Math.min(...regions.map((g) => g.y - g.r)) - ctxPad;
    let x1 = Math.max(...regions.map((g) => g.x + g.r)) + ctxPad;
    let y1 = Math.max(...regions.map((g) => g.y + g.r)) + ctxPad;
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1));
    y1 = Math.min(H, Math.ceil(y1));
    const cw = x1 - x0, ch = y1 - y0;
    const k = Math.min(2, 512 / Math.max(cw, ch));
    const sw = Math.max(64, Math.round((cw * k) / 8) * 8);
    const sh = Math.max(64, Math.round((ch * k) / 8) * 8);
    const crop = (src) => {
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, x0, y0, cw, ch, 0, 0, sw, sh);
      return c;
    };
    const tag = `mrgap_${Date.now().toString(36)}_${i}`;
    const [image, maskName] = await Promise.all([
      upload(await blobOf(crop(frame)), `${tag}_img.png`),
      upload(await blobOf(crop(mask)), `${tag}_mask.png`),
    ]);
    const fixed = await queue(inpaintWorkflow({ image, mask: maskName, seed, ...settings }), signal);

    // Blend the repaint back only through the soft mask; every other pixel stays as drawn.
    const patch = document.createElement('canvas');
    patch.width = W;
    patch.height = H;
    const pg = patch.getContext('2d');
    pg.drawImage(fixed, 0, 0, fixed.width, fixed.height, x0, y0, cw, ch);
    const alpha = document.createElement('canvas');
    alpha.width = W;
    alpha.height = H;
    const md = mask.getContext('2d').getImageData(0, 0, W, H);
    for (let p = 0; p < md.data.length; p += 4) md.data[p + 3] = md.data[p];
    alpha.getContext('2d').putImageData(md, 0, 0);
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(alpha, 0, 0);
    fg.drawImage(patch, 0, 0);
    out.push(frame);
    onFrame?.(i, frame, regions, P);
  }
  return out;
}
