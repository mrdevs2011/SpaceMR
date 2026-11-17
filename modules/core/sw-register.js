/**
 * sw-register.js — Service Worker ro'yxatdan o'tkazish + yangi versiyani topish (Telegram kabi to'liq oflayn qobiq).
 *
 * Oqim:
 *  1. Boot'da /sw.js ro'yxatdan o'tadi (push yoqilmagan bo'lsa ham) → butun ilova keshga tushadi → oflayn ishlaydi.
 *  2. Har ochilish / ko'rinish / internet qaytishi / 5 daqiqada reg.update(): egasi yangi versiya deploy qilsa,
 *     yangi SW butun ilovani FONDA o'rnatadi (foydalanuvchi sezmaydi, eski versiya ishlayveradi).
 *  3. Tayyor bo'lgach — xavfsiz paytda (yozmayotgan, yuklamayotgan) avtomatik almashadi va sahifa yangilanadi.
 *     Foydalanuvchi hech qachon eski versiyada qolib ketmaydi.
 */
const CHECK_MS = 5 * 60 * 1000;
let _reg = null;

async function _notifyReady() {
  try { const m = await import('./auto-update.js'); m.notifyUpdateReady?.(); } catch (_) {}
}

function _watch(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) _notifyReady();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) _notifyReady();
    });
  });
}

export async function checkForSwUpdate() {
  try { await (_reg || (await navigator.serviceWorker.getRegistration()))?.update(); } catch (_) {}
}

/** Yangi (kutayotgan) SW ni faollashtiradi va yangi nazoratchi kelishini kutadi. true — almashdi. */
export async function activateWaitingSw(timeoutMs = 4000) {
  try {
    const reg = _reg || (await navigator.serviceWorker.getRegistration());
    if (!reg) return false;
    await reg.update().catch(() => {});
    // o'rnatilayotgan bo'lsa tugashini kutamiz
    if (!reg.waiting && reg.installing) {
      await new Promise(res => {
        const w = reg.installing; const t = setTimeout(res, 25000);
        w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'redundant') { clearTimeout(t); res(); } });
      });
    }
    if (!reg.waiting) return false;
    const changed = new Promise(res => {
      const t = setTimeout(() => res(false), timeoutMs);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(true); }, { once: true });
    });
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    return await changed;
  } catch (_) { return false; }
}

async function init() {
  if (!('serviceWorker' in navigator)) return;
  try {
    _reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    _watch(_reg);
    checkForSwUpdate();
  } catch (e) { console.warn('[sw] register:', e?.message || e); return; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForSwUpdate(); });
  window.addEventListener('online', checkForSwUpdate);
  setInterval(checkForSwUpdate, CHECK_MS);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', () => { (window.requestIdleCallback || setTimeout)(init, 0); }, { once: true });
}
