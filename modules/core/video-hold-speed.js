/**
 * Video hold-to-speed: 0.5s bosib turganda chap/o'ng zona orqali tezlik.
 * Story alohida (stories.js). Bu post + chat videolari uchun.
 *   o'ng hold = 2x oldinga
 *   chap hold  = 2x orqaga (currentTime seek)
 *   markaz hold = pause (qo'yib yuborsa davom)
 */

const HOLD_MS = 500;
const RIGHT_RATE = 2;

let _bound = false;
let _holdTimer = null;
let _holding = false;
let _video = null;
let _zone = null;
let _startX = 0;
let _startY = 0;
let _rewInterval = null;
let _badge = null;
let _wasPlaying = false;

function _ensureBadge() {
  if (_badge && document.body.contains(_badge)) return _badge;
  _badge = document.createElement('div');
  _badge.id = 'mrVidRateBadge';
  _badge.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:calc(env(safe-area-inset-bottom,0px) + 72px)',
    'transform:translateX(-50%)', 'padding:6px 14px', 'border-radius:999px',
    'background:rgba(0,0,0,.55)', 'color:#fff', 'font:600 14px/1 system-ui,sans-serif',
    'pointer-events:none', 'z-index:9999', 'display:none'
  ].join(';');
  document.body.appendChild(_badge);
  return _badge;
}

function _showRate(txt) {
  const b = _ensureBadge();
  if (txt) {
    b.textContent = txt;
    b.style.display = 'block';
  } else {
    b.style.display = 'none';
  }
}

function _isInteractiveTarget(t) {
  if (!t || !t.closest) return false;
  if (t.closest('.cfm-vid-bar, .cvb-progress, .cvb-btn, button, a, input, select, textarea')) return true;
  return false;
}

function _findVideo(el) {
  if (!el || !el.closest) return null;
  const chatWrap = el.closest('.cfm-vid-wrap.playing');
  if (chatWrap) return chatWrap.querySelector('video');
  const post = el.closest('.post-media[data-type="video"]');
  if (post) return post.querySelector('video');
  if (el.tagName === 'VIDEO' && (el.closest('.post-media') || el.closest('.cfm-vid-wrap'))) return el;
  return null;
}

function _zoneFromEvent(e, video) {
  const rect = video.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / (rect.width || 1);
  if (ratio < 0.35) return 'left';
  if (ratio > 0.65) return 'right';
  return 'center';
}

function _startRewind(v) {
  _stopRewind();
  // ~2x orqaga: har 50ms da 0.1s orqaga
  _rewInterval = setInterval(() => {
    try {
      if (!v) return;
      v.currentTime = Math.max(0, (v.currentTime || 0) - 0.1);
    } catch (_) {}
  }, 50);
}

function _stopRewind() {
  if (_rewInterval) {
    clearInterval(_rewInterval);
    _rewInterval = null;
  }
}

function _applyHold(v, zone) {
  if (!v) return;
  _wasPlaying = !v.paused;
  if (zone === 'right') {
    try {
      v.playbackRate = RIGHT_RATE;
      if (v.paused) v.play().catch(() => {});
    } catch (_) {}
    _showRate('2x ▶▶');
  } else if (zone === 'left') {
    try { v.pause(); } catch (_) {}
    _startRewind(v);
    _showRate('◀◀ 2x');
  } else {
    try { if (!v.paused) v.pause(); } catch (_) {}
    _showRate('II');
  }
}

function _endHold() {
  _stopRewind();
  if (_video) {
    try {
      _video.playbackRate = 1;
      if (_zone === 'center' || _zone === 'left') {
        if (_wasPlaying) _video.play().catch(() => {});
      }
    } catch (_) {}
  }
  _showRate('');
  _video = null;
  _zone = null;
  _holding = false;
  _wasPlaying = false;
}

function _onDown(e) {
  if (e.button && e.button !== 0) return;
  if (_isInteractiveTarget(e.target)) return;
  // story viewer o'z logikasi — aralashmasin
  if (e.target.closest && e.target.closest('#storyViewer')) return;
  const v = _findVideo(e.target);
  if (!v) return;
  const inChat = !!(e.target.closest && e.target.closest('.cfm-vid-wrap'));
  if (inChat && !(e.target.closest && e.target.closest('.cfm-vid-wrap.playing'))) return;

  _holding = false;
  _video = v;
  _startX = e.clientX;
  _startY = e.clientY;
  _zone = _zoneFromEvent(e, v);
  clearTimeout(_holdTimer);
  _holdTimer = setTimeout(() => {
    _holding = true;
    _applyHold(v, _zone);
  }, HOLD_MS);
}

function _onMove(e) {
  if (!_holdTimer && !_holding) return;
  if (!_holding && (Math.abs(e.clientX - _startX) > 14 || Math.abs(e.clientY - _startY) > 14)) {
    clearTimeout(_holdTimer);
    _holdTimer = null;
  }
}

function _onUp() {
  clearTimeout(_holdTimer);
  _holdTimer = null;
  if (_holding) _endHold();
}

/** Bir marta documentga bog'lash (post + chat). */
export function bindVideoHoldSpeed() {
  if (_bound) return;
  _bound = true;
  document.addEventListener('pointerdown', _onDown, true);
  document.addEventListener('pointermove', _onMove, true);
  document.addEventListener('pointerup', _onUp, true);
  document.addEventListener('pointercancel', _onUp, true);
}

try { bindVideoHoldSpeed(); } catch (_) {}
