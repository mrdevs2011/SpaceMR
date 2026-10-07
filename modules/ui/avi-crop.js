/* ═══════════════════════════════════════════════════════════════════════
   AVATAR CROP — zoom / pan / circular crop for profile picture
   Usage: openAviCrop(file).then(blob => ...) or null if cancelled
   ═══════════════════════════════════════════════════════════════════════ */

import { lockScroll, unlockScroll } from '../core/utils.js';

const OUT_SIZE = 512; // output square px

let _img = null;
let _natW = 0, _natH = 0;
let _scale = 1;
let _minScale = 1;
let _tx = 0, _ty = 0; // translate in stage px (from center)
let _dragging = false;
let _lastX = 0, _lastY = 0;
let _resolve = null;
let _objectUrl = null;
let _bound = false;

function $(id) { return document.getElementById(id); }

function _stageSize() {
  const stage = $('aviCropStage');
  if (!stage) return 280;
  return stage.clientWidth || 280;
}

/** Circle diameter in stage coords (78% of stage) */
function _circleD() {
  return _stageSize() * 0.78;
}

function _applyTransform() {
  const img = $('aviCropImg');
  if (!img || !_img) return;
  // base display size: image covers the circle at minScale
  const dispW = _natW * _scale;
  const dispH = _natH * _scale;
  img.style.width = dispW + 'px';
  img.style.height = dispH + 'px';
  img.style.transform = `translate(calc(-50% + ${_tx}px), calc(-50% + ${_ty}px))`;
}

function _clampPan() {
  const d = _circleD();
  const half = d / 2;
  const dispW = _natW * _scale;
  const dispH = _natH * _scale;
  // image must fully cover the circle
  const maxX = Math.max(0, dispW / 2 - half);
  const maxY = Math.max(0, dispH / 2 - half);
  _tx = Math.max(-maxX, Math.min(maxX, _tx));
  _ty = Math.max(-maxY, Math.min(maxY, _ty));
}

function _setScale(s) {
  _scale = Math.max(_minScale, Math.min(_minScale * 3, s));
  const slider = $('aviCropZoom');
  if (slider) {
    const pct = Math.round((_scale / _minScale) * 100);
    slider.value = String(Math.max(100, Math.min(300, pct)));
  }
  _clampPan();
  _applyTransform();
}

/* Barmoq (touch), sichqoncha va touchpad: 1 ta ko'rsatkich — surish; 2 ta barmoq — chimchilab kattalashtirish.
   Touchpad: ikki barmoq scroll / chimchilash (ctrl+wheel) = zoom. Sichqoncha g'ildiragi = zoom. */
const _ptrs = new Map();   // aktiv barmoqlar/sichqoncha (pinch uchun)
let _pinchD = 0;
const _pdist = () => { const [a, b] = [..._ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

function _onPointerDown(e) {
  _ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  if (_ptrs.size === 2) { _dragging = false; _pinchD = _pdist(); }
  else { _dragging = true; _lastX = e.clientX; _lastY = e.clientY; }
  e.preventDefault();
}
function _onPointerMove(e) {
  if (!_ptrs.has(e.pointerId)) return;
  _ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (_ptrs.size >= 2) {            // ikki barmoq — pinch zoom
    const d = _pdist();
    if (_pinchD > 0 && d > 0) _setScale(_scale * (d / _pinchD));
    _pinchD = d;
    return;
  }
  if (!_dragging) return;
  const dx = e.clientX - _lastX;
  const dy = e.clientY - _lastY;
  _lastX = e.clientX;
  _lastY = e.clientY;
  _tx += dx;
  _ty += dy;
  _clampPan();
  _applyTransform();
}
function _onPointerUp(e) {
  _ptrs.delete(e.pointerId);
  _pinchD = 0;
  if (_ptrs.size === 1) {           // pinchdan keyin qolgan barmoq bilan siljitishni davom ettirish
    const r = [..._ptrs.values()][0];
    _dragging = true; _lastX = r.x; _lastY = r.y;
  } else _dragging = false;
}

/** g'ildirak / touchpad (ikki barmoq scroll va pinch = ctrl+wheel) — yumshoq, delta'ga mutanosib zoom */
function _onWheel(e) {
  e.preventDefault();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  else if (e.deltaMode === 2) dy *= 100;
  dy = Math.max(-120, Math.min(120, dy));
  _setScale(_scale * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0018)));
}

/** Crop ochiq — orqa fon freeze: Esc oynani yopadi, qolgan barcha klaviatura/shortcutlar bloklanadi */
function _onKey(e) {
  const modal = $('aviCropModal');
  if (!modal || modal.style.display === 'none') return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { e.preventDefault(); _close(null); return; }
  if (e.key !== 'Tab') e.preventDefault();
}

function _bindOnce() {
  if (_bound) return;
  _bound = true;
  const stage = $('aviCropStage');
  if (stage) {
    stage.addEventListener('pointerdown', _onPointerDown);
    stage.addEventListener('pointermove', _onPointerMove);
    stage.addEventListener('pointerup', _onPointerUp);
    stage.addEventListener('pointercancel', _onPointerUp);
    stage.addEventListener('wheel', _onWheel, { passive: false });
    stage.addEventListener('lostpointercapture', _onPointerUp);
  }
  window.addEventListener('keydown', _onKey, true);
  const slider = $('aviCropZoom');
  if (slider) {
    slider.addEventListener('wheel', _onWheel, { passive: false });
    slider.addEventListener('input', () => {
      const pct = Number(slider.value) || 100;
      _setScale(_minScale * (pct / 100));
    });
  }
  $('aviCropClose')?.addEventListener('click', () => _close(null));
  $('aviCropCancel')?.addEventListener('click', () => _close(null));
  $('aviCropUpload')?.addEventListener('click', () => _exportAndClose());
  // backdrop click
  $('aviCropModal')?.addEventListener('click', (e) => {
    if (e.target === $('aviCropModal')) _close(null);
  });
}

function _close(result) {
  const modal = $('aviCropModal');
  if (modal) modal.style.display = 'none';
  unlockScroll('aviCropModal');
  if (_objectUrl) { URL.revokeObjectURL(_objectUrl); _objectUrl = null; }
  _img = null;
  _ptrs.clear(); _dragging = false; _pinchD = 0;
  const r = _resolve;
  _resolve = null;
  if (r) r(result);
}

async function _exportAndClose() {
  if (!_img) return _close(null);
  const btn = $('aviCropUpload');
  if (btn) { btn.disabled = true; btn.textContent = 'Tayyorlanmoqda…'; }

  try {
    const d = _circleD();
    const stage = _stageSize();
    // Map from stage coords to natural image coords
    // Image center in stage is at (stage/2 + _tx, stage/2 + _ty)
    // Circle center is stage center
    // Source rect in natural pixels that maps to the circle
    const scaleToNat = _natW / (_natW * _scale); // = 1/_scale for width... actually:
    // displayed size = nat * _scale  (where _scale is px-per-nat-px on stage)
    // so 1 stage px = 1/_scale natural px
    const natPerStage = 1 / _scale;

    const circleR = d / 2;
    // circle center in stage
    const cx = stage / 2;
    const cy = stage / 2;
    // image top-left in stage
    const imgLeft = cx + _tx - (_natW * _scale) / 2;
    const imgTop  = cy + _ty - (_natH * _scale) / 2;

    // circle top-left in stage
    const circLeft = cx - circleR;
    const circTop  = cy - circleR;

    // source in natural image
    const sx = (circLeft - imgLeft) * natPerStage;
    const sy = (circTop  - imgTop)  * natPerStage;
    const sw = d * natPerStage;
    const sh = d * natPerStage;

    const canvas = document.createElement('canvas');
    canvas.width = OUT_SIZE;
    canvas.height = OUT_SIZE;
    const ctx = canvas.getContext('2d');

    // Circular clip for transparent PNG edges (nice for avatars)
    ctx.beginPath();
    ctx.arc(OUT_SIZE / 2, OUT_SIZE / 2, OUT_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Fon rangi yo'q (shaffof) rasmlar uchun avtomatik qora fon (#000)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);

    ctx.drawImage(_img, sx, sy, sw, sh, 0, 0, OUT_SIZE, OUT_SIZE);

    const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.92));
    if (btn) { btn.disabled = false; btn.textContent = 'Yuklash'; }
    _close(blob || null);
  } catch (e) {
    console.warn('[avi-crop] export failed', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Yuklash'; }
    _close(null);
  }
}

/**
 * Open crop modal for a File/Blob. Resolves with cropped PNG Blob or null.
 */
export function openAviCrop(file) {
  return new Promise((resolve) => {
    _resolve = resolve;
    _bindOnce();

    if (_objectUrl) URL.revokeObjectURL(_objectUrl);
    _objectUrl = URL.createObjectURL(file);

    const imgEl = $('aviCropImg');
    const modal = $('aviCropModal');
    if (!imgEl || !modal) {
      resolve(null);
      return;
    }

    imgEl.onload = () => {
      _img = imgEl;
      _natW = imgEl.naturalWidth;
      _natH = imgEl.naturalHeight;
      if (!_natW || !_natH) {
        _close(null);
        return;
      }

      // Fit image so the shorter side covers the circle
      const d = _circleD();
      _minScale = d / Math.min(_natW, _natH);
      _scale = _minScale;
      _tx = 0;
      _ty = 0;
      _setScale(_minScale);

      modal.style.display = 'flex';
      lockScroll('aviCropModal');
      // re-measure after display (layout)
      requestAnimationFrame(() => {
        const d2 = _circleD();
        _minScale = d2 / Math.min(_natW, _natH);
        _scale = _minScale;
        _tx = 0; _ty = 0;
        _setScale(_minScale);
      });
    };
    imgEl.onerror = () => _close(null);
    imgEl.src = _objectUrl;
  });
}
