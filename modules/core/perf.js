/**
 * perf.js — SpaceMR UI tezlik qatlami
 * - rAF batch: bir frame ichida bir nechta paint chaqiruvlarini birlashtirish
 * - idle: past prioritet ishlar
 * - once: bir marta ishlaydigan callback
 * - Phase 0: boot marks + flash detector (?perf=1 / ?flash=1)
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

/* ══ Phase 0.1 — Boot / surface marks ═══════════════════════════════════ */
const _marks = [];
const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

export function mark(name) {
  try {
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark('spacemr:' + name);
    }
  } catch (_) {}
  const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  _marks.push({ name, t, dt: Math.round(t - _t0) });
  if (_perfOn) console.debug('[perf]', name, Math.round(t - _t0) + 'ms');
}

export function getMarks() { return _marks.slice(); }


/* ══ Phase 7 — Counters / measure / report ══════════════════════════════ */
const _counters = Object.create(null);
const _timings = [];

export function count(name, n = 1) {
  _counters[name] = (_counters[name] || 0) + n;
}

export function getCounters() { return { ..._counters }; }

export function cacheHit(surface) { count('cache-hit' + (surface ? ':' + surface : '')); }
export function cacheMiss(surface) { count('cache-miss' + (surface ? ':' + surface : '')); }
export function syncPath(kind) { count('sync:' + (kind || 'unknown')); }

export function measure(name, fn) {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const done = () => {
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const ms = Math.round(t1 - t0);
    _timings.push({ name, ms, t: t1 });
    if (_timings.length > 200) _timings.splice(0, _timings.length - 200);
    mark(name + ':' + ms + 'ms');
    return ms;
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(v => { done(); return v; }, e => { done(); throw e; });
    }
    done();
    return r;
  } catch (e) {
    done();
    throw e;
  }
}

export function getTimings() { return _timings.slice(); }

export function report() {
  const hits = Object.keys(_counters).filter(k => k.startsWith('cache-hit')).reduce((a, k) => a + _counters[k], 0);
  const miss = Object.keys(_counters).filter(k => k.startsWith('cache-miss')).reduce((a, k) => a + _counters[k], 0);
  const rate = (hits + miss) ? Math.round(100 * hits / (hits + miss)) : null;
  return { marks: getMarks(), counters: getCounters(), timings: getTimings().slice(-40), cacheHitRate: rate, t0: _t0 };
}

try {
  if (typeof window !== 'undefined') {
    window.__spacemrPerf = { mark, getMarks, count, getCounters, measure, report, cacheHit, cacheMiss, syncPath, getTimings };
  }
} catch (_) {}

const _perfOn = (() => {
  try {
    const q = new URLSearchParams(location.search);
    return q.has('perf') || q.has('flash') || localStorage.getItem('spacemr_perf') === '1';
  } catch { return false; }
})();

/* ══ Phase 0.2 — Flash detector (dev) ═══════════════════════════════════
 * Surface ochilgandan keyin 2 s ichida foydalanuvchi harakati / realtime
 * bo'lmasa DOM mazmuni o'zgarsa → console warn (flash).
 */
let _flashObs = null;
let _flashTimer = null;
let _flashArmed = false;

export function armFlashDetector(root, label = 'surface') {
  if (!_perfOn || !root || typeof MutationObserver === 'undefined') return () => {};
  disarmFlashDetector();
  _flashArmed = true;
  let userTouched = false;
  const onUser = () => { userTouched = true; };
  const types = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  types.forEach(t => document.addEventListener(t, onUser, { once: true, passive: true, capture: true }));

  let flashes = 0;
  _flashObs = new MutationObserver((muts) => {
    if (!_flashArmed || userTouched) return;
    // faqat mazmun o'zgarishi (class/style emas)
    const meaningful = muts.some(m =>
      m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)
    );
    if (!meaningful) return;
    flashes++;
    console.warn('[flash]', label, 'unexpected DOM change without user input', { flashes });
  });
  _flashObs.observe(root, { childList: true, subtree: true });
  _flashTimer = setTimeout(() => {
    disarmFlashDetector();
    if (flashes === 0 && _perfOn) console.debug('[flash]', label, 'clean (0 flashes in 2s)');
  }, 2000);
  return disarmFlashDetector;
}

export function disarmFlashDetector() {
  _flashArmed = false;
  if (_flashObs) { try { _flashObs.disconnect(); } catch (_) {} _flashObs = null; }
  if (_flashTimer) { clearTimeout(_flashTimer); _flashTimer = null; }
}

/* Long task observer (faqat ?perf=1) */
if (_perfOn && typeof PerformanceObserver !== 'undefined') {
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration >= 50) console.warn('[longtask]', Math.round(e.duration) + 'ms', e.name || '');
      }
    });
    po.observe({ type: 'longtask', buffered: true });
  } catch (_) {}
  // panel
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const box = document.createElement('div');
      box.id = 'spacemr-perf-panel';
      box.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;max-width:280px;max-height:40vh;overflow:auto;background:rgba(0,0,0,.82);color:#8fe;font:11px/1.35 monospace;padding:8px 10px;border-radius: 16px;pointer-events:none';
      const tick = () => {
        const lines = _marks.map(m => m.dt + 'ms  ' + m.name);
        const hits = Object.keys(_counters).filter(k => k.startsWith('cache-hit')).reduce((a, k) => a + _counters[k], 0);
        const miss = Object.keys(_counters).filter(k => k.startsWith('cache-miss')).reduce((a, k) => a + _counters[k], 0);
        if (hits || miss) lines.push('---', 'hit ' + hits + ' / miss ' + miss + (hits + miss ? ' (' + Math.round(100 * hits / (hits + miss)) + '%)' : ''));
        for (const [k, v] of Object.entries(_counters).filter(([k]) => !k.startsWith('cache-')).slice(0, 8)) lines.push(k + ': ' + v);
        box.textContent = lines.join(String.fromCharCode(10)) || 'perf…';
      };
      tick();
      setInterval(tick, 500);
      document.body.appendChild(box);
    });
  }
}

// Boot mark as early as this module loads
mark('perf-module');
