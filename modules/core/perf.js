/**
 * perf.js — SpaceMR UI tezlik qatlami
 * - rAF batch: bir frame ichida bir nechta paint chaqiruvlarini birlashtirish
 * - idle: past prioritet ishlar
 * - once: bir marta ishlaydigan callback
 *
 * Qoida: og'ir DOM yozish faqat rAF orqali; tarmoq/DB async qoladi.
 */

const _queues = new Map(); // key -> { fn, args }
let _raf = 0;

function _flush() {
  _raf = 0;
  const jobs = [..._queues.values()];
  _queues.clear();
  for (const j of jobs) {
    try { j.fn(...j.args); } catch (e) { console.error('[perf]', e); }
  }
}

/** Bir frame ichida bir key uchun faqat oxirgi chaqiruv ishlaydi. */
export function schedule(key, fn, ...args) {
  _queues.set(key, { fn, args });
  if (!_raf) _raf = requestAnimationFrame(_flush);
}

/** Darhol yoki keyingi frame (agar allaqachon queued bo'lsa — birlashadi). */
export function schedulePaint(key, fn, ...args) {
  schedule(key, fn, ...args);
}

/** Brauzer bo'sh paytda (yoki setTimeout fallback). */
export function scheduleIdle(fn, timeout = 1200) {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(() => { try { fn(); } catch (e) { console.error('[perf-idle]', e); } }, { timeout });
  }
  return setTimeout(() => { try { fn(); } catch (e) { console.error('[perf-idle]', e); } }, Math.min(200, timeout));
}

/** double-rAF — layout/paint keyin o'lchash uchun */
export function afterPaint(fn) {
  requestAnimationFrame(() => requestAnimationFrame(() => { try { fn(); } catch (e) { console.error('[perf-ap]', e); } }));
}

/** Passive pointer/touch listener yordamchisi */
export function onPassive(el, type, handler, opts = {}) {
  if (!el) return () => {};
  const o = { passive: true, ...opts };
  el.addEventListener(type, handler, o);
  return () => el.removeEventListener(type, handler, o);
}
