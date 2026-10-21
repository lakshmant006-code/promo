// Tooltips and first-use hints.
//
// Tooltips: any element with data-tip="…" (and optionally data-key="R") explains itself
// after a short hover with a mouse or Pencil, or a long press with a finger.
// Hints: short callouts shown once per feature, the first time it appears ("Got it" hides
// them for good, remembered in this browser).

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createTips(screen) {
  const tip = document.createElement('div');
  tip.className = 'tip hidden';
  tip.setAttribute('role', 'tooltip');
  screen.append(tip);
  let timer = null;
  let current = null;
  const scale = () => screen.getBoundingClientRect().width / screen.offsetWidth || 1;

  function place(el) {
    const s = scale();
    const sr = screen.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = (r.left + r.width / 2 - sr.left) / s;
    const top = (r.top - sr.top) / s;
    const bottom = (r.bottom - sr.top) / s;
    tip.classList.remove('hidden', 'below');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const below = top - h - 10 < 50;
    tip.classList.toggle('below', below);
    const left = Math.max(8, Math.min(screen.offsetWidth - w - 8, x - w / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? bottom + 10 : top - h - 10}px`;
    tip.style.setProperty('--arrow', `${Math.max(12, Math.min(w - 12, x - left))}px`);
  }
  function show(el) {
    const text = el.dataset.tip;
    if (!text || !document.contains(el)) return;
    current = el;
    tip.innerHTML = esc(text) + (el.dataset.key ? ` <kbd>${esc(el.dataset.key)}</kbd>` : '');
    place(el);
  }
  function hide() {
    clearTimeout(timer);
    current = null;
    tip.classList.add('hidden');
  }

  screen.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || el === current || e.pointerType === 'touch') return;
    hide();
    timer = setTimeout(() => show(el), 450);
  });
  screen.addEventListener('pointerout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  // A long press with a finger shows the tip; the next touch hides it.
  screen.addEventListener('pointerdown', (e) => {
    hide();
    if (e.pointerType !== 'touch') return;
    const el = e.target.closest('[data-tip]');
    if (el) timer = setTimeout(() => show(el), 550);
  }, true);
  screen.addEventListener('pointerup', () => clearTimeout(timer), true);
  addEventListener('keydown', (e) => e.key === 'Escape' && hide());

  return { hide };
}

export function createHints(screen) {
  const box = document.createElement('div');
  box.className = 'hint-callout hidden';
  box.setAttribute('role', 'status');
  screen.append(box);
  let showing = null;
  let anchor = null; // the element (or panel state) the hint belongs to
  const seen = (id) => {
    try { return localStorage.getItem(`rig.hint.${id}`) === '1'; } catch { return false; }
  };
  const remember = (id) => {
    try { localStorage.setItem(`rig.hint.${id}`, '1'); } catch {}
  };
  const scale = () => screen.getBoundingClientRect().width / screen.offsetWidth || 1;

  function hide() {
    box.classList.add('hidden');
    showing = null;
    anchor = null;
  }
  // Called every frame: a hint goes away (unread, so it can come back) when the thing it
  // points at is no longer on screen.
  function check() {
    if (!showing || !anchor) return;
    const gone = anchor instanceof Element ? !document.contains(anchor) || anchor.offsetParent === null || anchor.classList.contains('hidden') : !anchor();
    if (gone) hide();
  }
  // Show hint `id` once, pointing at `target` (an element, or { x, y } in screen points).
  // side: where the callout sits relative to the target ('left', 'right', 'above', 'below').
  // keep: for a hint placed at a point, a function that says whether it still applies.
  function show(id, target, html, side = 'left', keep = null) {
    if (seen(id) || showing === id) return;
    showing = id;
    anchor = target instanceof Element ? target : keep;
    box.innerHTML = `<div class="hc-body">${html}</div><button class="hc-ok">Got it</button>`;
    box.dataset.side = side;
    box.classList.remove('hidden');
    let x, y;
    if (target instanceof Element) {
      const s = scale();
      const sr = screen.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const L = (r.left - sr.left) / s, T = (r.top - sr.top) / s, R = (r.right - sr.left) / s, B = (r.bottom - sr.top) / s;
      ({ x, y } = { left: { x: L, y: (T + B) / 2 }, right: { x: R, y: (T + B) / 2 }, above: { x: (L + R) / 2, y: T }, below: { x: (L + R) / 2, y: B } }[side]);
    } else ({ x, y } = target);
    const w = box.offsetWidth, h = box.offsetHeight, gap = 14;
    let left = side === 'left' ? x - w - gap : side === 'right' ? x + gap : x - w / 2;
    // A hint for something inside the side panel sits out on the canvas, never over the panel.
    const panel = target instanceof Element ? target.closest('.take-panel') : null;
    if (panel && side === 'left') left = Math.min(left, panel.offsetLeft - w - gap);
    let top = side === 'above' ? y - h - gap : side === 'below' ? y + gap : y - h / 2;
    left = Math.max(10, Math.min(screen.offsetWidth - w - 10, left));
    top = Math.max(54, Math.min(screen.offsetHeight - h - 10, top));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.querySelector('.hc-ok').onclick = () => {
      remember(id);
      hide();
    };
  }
  return { show, hide, check, get showing() { return showing; } };
}
