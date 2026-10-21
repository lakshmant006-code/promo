// Exports a rigged character so it can be edited elsewhere:
//  - Layered SVG (traced vectors, one group per body part with its pivot) for motion tools
//    such as After Effects, Rive, Figma or Illustrator.
//  - Layered PSD (one raster layer per body part) that opens in Procreate with layers intact.
// Uses window.ImageTracer (imagetracerjs) and window.agPsd (ag-psd), both served locally.

export const PART_LABELS = {
  neck: 'Head',
  spine: 'Torso',
  hips: 'Hips',
  upperArmR: 'Upper arm R',
  upperArmL: 'Upper arm L',
  foreArmR: 'Forearm R',
  foreArmL: 'Forearm L',
  thighR: 'Thigh R',
  thighL: 'Thigh L',
  shinR: 'Shin R',
  shinL: 'Shin L',
};
const LABEL_TO_BONE = Object.fromEntries(Object.entries(PART_LABELS).map(([b, l]) => [l.toLowerCase(), b]));

// Joint each part turns around (its pivot), in drawing pixels.
const PIVOT = {
  neck: 'headPivot', spine: 'pelvis', hips: 'pelvis',
  upperArmR: 'shoulderR', upperArmL: 'shoulderL', foreArmR: 'elbowR', foreArmL: 'elbowL',
  thighR: 'hipR', thighL: 'hipL', shinR: 'kneeR', shinL: 'kneeL',
};

const TRACE = {
  // Ink, paper and empty: line art traces cleanly into three layers.
  pal: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }, { r: 0, g: 0, b: 0, a: 0 }],
  colorsampling: 0,
  numberofcolors: 3,
  colorquantcycles: 1,
  ltres: 0.6,
  qtres: 0.6,
  pathomit: 5,
  blurradius: 0,
  strokewidth: 0,
  linefilter: true,
  roundcoords: 1,
  viewbox: true,
  desc: false,
};

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// Trace one piece into SVG <path> markup (offset to its place on the full drawing).
export function tracePiece(piece) {
  const g = piece.canvas.getContext('2d', { willReadFrequently: true });
  const data = g.getImageData(0, 0, piece.canvas.width, piece.canvas.height);
  const svg = window.ImageTracer.imagedataToSVG(data, TRACE);
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const paths = [...doc.querySelectorAll('path')].filter((p) => {
    const op = p.getAttribute('opacity') ?? p.getAttribute('fill-opacity');
    return op === null || Number(op) > 0.01;
  });
  return paths.map((p) => {
    p.removeAttribute('desc');
    p.removeAttribute('stroke');
    p.removeAttribute('stroke-width');
    return p.outerHTML.replace(/ xmlns="[^"]*"/, '');
  }).join('\n      ');
}

export function layeredSVG(puppet) {
  const { img, joints: J } = puppet;
  const groups = puppet.pieces.map((p) => {
    const [px, py] = J[PIVOT[p.bone]];
    return `    <g id="${p.bone}" inkscape:label="${esc(PART_LABELS[p.bone])}" inkscape:groupmode="layer"
       data-bone="${p.bone}" data-pivot="${px.toFixed(1)} ${py.toFixed(1)}" transform-origin="${px.toFixed(1)} ${py.toFixed(1)}">
      <g transform="translate(${p.x0} ${p.y0})">
      ${tracePiece(p)}
      </g>
    </g>`;
  });
  const bone = (a, b) => `<line x1="${J[a][0]}" y1="${J[a][1]}" x2="${J[b][0]}" y2="${J[b][1]}"/>`;
  const rigLines = [
    ['pelvis', 'neck'], ['neck', 'head'], ['shoulderR', 'shoulderL'], ['hipR', 'hipL'],
    ['shoulderR', 'elbowR'], ['elbowR', 'wristR'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
    ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
  ].map(([a, b]) => bone(a, b)).join('');
  const rigDots = Object.entries(J).map(([n, [x, y]]) => `<circle cx="${x}" cy="${y}" r="5"><title>${n}</title></circle>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${img.width}" height="${img.height}" viewBox="0 0 ${img.width} ${img.height}">
  <title>${esc(puppet.name)} – rigged parts</title>
${groups.join('\n')}
    <g id="rig" inkscape:label="Rig guide" inkscape:groupmode="layer" display="none" fill="#1e8bff" stroke="#1e8bff" stroke-width="3">
      ${rigLines}${rigDots}
    </g>
</svg>
`;
}

export function layeredPSD(puppet) {
  const { img, joints: J } = puppet;
  const guide = document.createElement('canvas');
  guide.width = img.width;
  guide.height = img.height;
  const g = guide.getContext('2d');
  g.strokeStyle = g.fillStyle = '#1e8bff';
  g.lineWidth = 3;
  for (const [n, [x, y]] of Object.entries(J)) {
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
    g.fillText(n, x + 8, y - 6);
  }
  const children = puppet.pieces.map((p) => ({ name: PART_LABELS[p.bone], left: p.x0, top: p.y0, canvas: p.canvas }));
  children.push({ name: 'Rig guide', hidden: true, left: 0, top: 0, canvas: guide });
  return window.agPsd.writePsd({ width: img.width, height: img.height, children });
}

// Read a layered PSD back (e.g. after fixing parts in Procreate). Layers are matched by name.
export function readLayeredPSD(buffer) {
  const psd = window.agPsd.readPsd(buffer, { skipThumbnail: true });
  const layers = [];
  const walk = (list) => {
    for (const l of list || []) {
      if (l.children) walk(l.children);
      const bone = LABEL_TO_BONE[(l.name || '').trim().toLowerCase()];
      if (bone && l.canvas) layers.push({ bone, canvas: l.canvas, x0: l.left || 0, y0: l.top || 0 });
    }
  };
  walk(psd.children);
  // Flatten all part layers into one image too (used for joint detection and thumbnails).
  const flat = document.createElement('canvas');
  flat.width = psd.width;
  flat.height = psd.height;
  const f = flat.getContext('2d');
  for (const l of layers) f.drawImage(l.canvas, l.x0, l.y0);
  return { width: psd.width, height: psd.height, layers, flat };
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
