/**
 * Umumiy pastki progress kvadrat (upload + download).
 * Surib joylashtirish mumkin; joy mobile / tablet / desktop alohida saqlanadi.
 */
const POS_KEY = 'spacemr_ufb_pos_v1';
const SIZE = 64;

function $(id) { return document.getElementById(id); }

function deviceBucket() {
  const w = window.innerWidth || 0;
  if (w < 768) return 'mobile';
  if (w < 1100) return 'tablet';
  return 'desktop';
}

function loadPosMap() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch (_) { return {}; }
}

function savePos(bucket, left, top) {
  try {
    const map = loadPosMap();
    map[bucket] = { left: Math.round(left), top: Math.round(top) };
    localStorage.setItem(POS_KEY, JSON.stringify(map));
  } catch (_) {}
}

function clamp(left, top) {
  const pad = 8;
  const maxL = Math.max(pad, window.innerWidth - SIZE - pad);
  const maxT = Math.max(pad, window.innerHeight - SIZE - pad);
  return {
    left: Math.min(maxL, Math.max(pad, left)),
    top: Math.min(maxT, Math.max(pad, top)),
  };
}

function defaultCorner() {
  const pad = 12;
  const bottomNav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--content-bottom'))
    || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav'))
    || 0;
  const safeB = 0; // env in CSS default; JS approximates
  return {
    left: window.innerWidth - SIZE - pad,
    top: window.innerHeight - SIZE - pad - bottomNav - 12,
  };
}

function applySavedPos(bar) {
  if (!bar) return;
  const bucket = deviceBucket();
  const map = loadPosMap();
  const p = map[bucket];
  if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
    const c = clamp(p.left, p.top);
    bar.style.left = c.left + 'px';
    bar.style.top = c.top + 'px';
    bar.style.right = 'auto';
    bar.style.bottom = 'auto';
    bar.dataset.ufbPos = 'custom';
  } else {
    bar.style.left = '';
    bar.style.top = '';
    bar.style.right = '';
    bar.style.bottom = '';
    bar.dataset.ufbPos = 'default';
  }
}

let _dragBound = false;
let _hideTimer = 0;

function bindDrag(bar) {
  if (!bar || bar._ufbDrag) return;
  bar._ufbDrag = true;

  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0, origL = 0, origT = 0;
  let pointerId = null;

  const onDown = (e) => {
    if (e.target.closest?.('.ufb-close')) return;
    if (e.button != null && e.button !== 0) return;
    const rect = bar.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origL = rect.left;
    origT = rect.top;
    dragging = true;
    moved = false;
    pointerId = e.pointerId;
    try { bar.setPointerCapture(pointerId); } catch (_) {}
    bar.classList.add('is-dragging');
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    const c = clamp(origL + dx, origT + dy);
    bar.style.left = c.left + 'px';
    bar.style.top = c.top + 'px';
    bar.style.right = 'auto';
    bar.style.bottom = 'auto';
    bar.dataset.ufbPos = 'custom';
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('is-dragging');
    try { if (pointerId != null) bar.releasePointerCapture(pointerId); } catch (_) {}
    pointerId = null;
    if (moved) {
      const rect = bar.getBoundingClientRect();
      const c = clamp(rect.left, rect.top);
      bar.style.left = c.left + 'px';
      bar.style.top = c.top + 'px';
      savePos(deviceBucket(), c.left, c.top);
    }
  };

  bar.addEventListener('pointerdown', onDown);
  bar.addEventListener('pointermove', onMove);
  bar.addEventListener('pointerup', onUp);
  bar.addEventListener('pointercancel', onUp);

  // Resize: custom joy ekrandan chiqib ketmasin; bucket o'zgarsa qayta qo'llash
  let lastBucket = deviceBucket();
  window.addEventListener('resize', () => {
    const b = deviceBucket();
    if (b !== lastBucket) {
      lastBucket = b;
      applySavedPos(bar);
    } else if (bar.dataset.ufbPos === 'custom') {
      const rect = bar.getBoundingClientRect();
      const c = clamp(rect.left, rect.top);
      bar.style.left = c.left + 'px';
      bar.style.top = c.top + 'px';
    }
  });
}

function ensure() {
  const bar = $('uploadFloatBar');
  if (!bar) return null;
  if (!_dragBound) {
    bindDrag(bar);
    const btn = $('ufbClose');
    if (btn && !btn._ufbClose) {
      btn._ufbClose = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hide();
      });
    }
    _dragBound = true;
  }
  return bar;
}

/** @param {'story'|'post'|'download'|'upload'|string} [kind] */
export function show(kind = 'upload') {
  const bar = ensure();
  if (!bar) return;
  clearTimeout(_hideTimer);
  const nameEl = $('ufbName');
  if (nameEl) {
    nameEl.textContent = kind === 'story' ? 'Hikoya'
      : kind === 'post' ? 'Joylash'
      : kind === 'download' ? 'Yuklab olish'
      : 'Yuklash';
  }
  const ring = $('ufbRing');
  if (ring) {
    ring.classList.remove('indeterminate', 'done', 'fail');
    ring.setAttribute('stroke-dasharray', '0 100');
    ring.style.stroke = '';
  }
  const pctEl = $('ufbPct');
  if (pctEl) pctEl.textContent = '0%';
  applySavedPos(bar);
  bar.classList.remove('d-none');
  bar.style.display = 'flex';
}

export function update(pct) {
  const ring = $('ufbRing');
  const pctEl = $('ufbPct');
  if (!ring) return;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  if (p >= 95 && p < 100) {
    ring.classList.add('indeterminate');
    ring.setAttribute('stroke-dasharray', '30 100');
    if (pctEl) pctEl.textContent = '…';
  } else {
    ring.classList.remove('indeterminate');
    ring.setAttribute('stroke-dasharray', Math.round(p) + ' 100');
    if (pctEl) pctEl.textContent = Math.round(p) + '%';
  }
}

export function done(success = true) {
  const bar = ensure();
  if (!bar) return;
  const ring = $('ufbRing');
  if (ring) {
    ring.classList.remove('indeterminate');
    ring.setAttribute('stroke-dasharray', '100 100');
    ring.style.stroke = success ? '#00ba7c' : '#f4212e';
  }
  const pctEl = $('ufbPct');
  if (pctEl) {
    if (success) {
      pctEl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    } else {
      pctEl.textContent = '!';
    }
  }
  clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => hide(), 1400);
}

export function hide() {
  const bar = $('uploadFloatBar');
  if (!bar) return;
  clearTimeout(_hideTimer);
  bar.style.display = 'none';
  bar.classList.add('d-none');
  const ring = $('ufbRing');
  if (ring) {
    ring.classList.remove('indeterminate');
    ring.setAttribute('stroke-dasharray', '0 100');
    ring.style.stroke = '';
  }
  const pctEl = $('ufbPct');
  if (pctEl) pctEl.textContent = '0%';
}

/** fetch + progress (Content-Length bo'lsa %) */
export async function fetchWithProgress(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (!res.body || !len || !res.body.getReader) {
    update(40);
    const blob = await res.blob();
    update(90);
    return blob;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done: d, value } = await reader.read();
    if (d) break;
    chunks.push(value);
    received += value.length;
    update(Math.min(92, Math.round((received / len) * 90)));
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || '' });
}

// Aliases (upload.js bilan mos)
export const floatBarShow = show;
export const floatBarUpdate = update;
export const floatBarDone = done;
export const floatBarHide = hide;

// Early bind
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensure(), { once: true });
  } else {
    ensure();
  }
}
