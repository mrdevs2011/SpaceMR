/** auto-update.js — yangi versiya deploy bo'lganda ochiq turgan foydalanuvchilar avtomatik yangilanadi.
 *  Qanday: /sw.js (no-store) dagi CACHE_VERSION har deployda o'zgaradi (bump-sw.mjs). Sahifa ochilganidan beri
 *  o'zgarsa — hard refresh (SW + cache tozalanadi, force-reload.js dagi executeHardFullReload).
 *  Himoya: yozayotgan matn / yuklash / oyna yashirin bo'lsa kutadi; 60 soniyada ko'pi bilan 1 marta (loop yo'q);
 *  lokalda CACHE_VERSION o'zgarmaydi — hech narsa qilmaydi. */
const POLL_MS = 30 * 1000;
const RETRY_MS = 10 * 1000;
const GUARD_KEY = 'spacemr_autoupdate_ts';

let _started = false;
let _base = '';
let _pending = false;
let _timer = null;

async function _remoteVersion() {
  try {
    const r = await fetch('/sw.js', { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return '';
    const m = /CACHE_VERSION\s*=\s*'([^']+)'/.exec(await r.text());
    return m ? m[1] : '';
  } catch (_) { return ''; }
}

/** Foydalanuvchi hozir nimadir yozyapti / yuklayapti — uning ishini uzmaymiz */
function _isBusy() {
  try {
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/i.test(a.type || '')) || a.isContentEditable)) {
      const v = a.isContentEditable ? (a.textContent || '') : (a.value || '');
      if (String(v).trim()) return true;
    }
    if (document.getElementById('uploadOverlay')?.classList.contains('show')) return true;
    if (document.querySelector('.recording, .is-recording, [data-recording="1"]')) return true;
  } catch (_) {}
  return false;
}

async function _apply() {
  if (!_pending) return;
  clearTimeout(_timer);
  if (document.visibilityState !== 'visible' || _isBusy()) {
    _timer = setTimeout(_apply, RETRY_MS);
    return;
  }
  try {
    const last = Number(sessionStorage.getItem(GUARD_KEY) || 0);
    if (Date.now() - last < 60 * 1000) return;   // loop himoyasi
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch (_) {}
  _pending = false;
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => /^spacemr-(static|runtime)-/.test(k)).map(k => caches.delete(k)));
    }
    const reg = await navigator.serviceWorker?.getRegistration?.();
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  } catch (_) {}
  try { location.reload(); } catch (_) {}
}

async function _check() {
  const v = await _remoteVersion();
  if (!v) return;
  if (!_base) { _base = v; return; }
  if (v !== _base) { _pending = true; _apply(); }
}

export function startAutoUpdateWatcher() {
  if (_started) return;
  _started = true;
  _check();
  setInterval(_check, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (_pending) _apply(); else _check();
  });
  window.addEventListener('online', _check);
}
