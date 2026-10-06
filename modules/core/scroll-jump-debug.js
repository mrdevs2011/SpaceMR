/* scroll-jump-debug.js — "pastga scroll qilsam o'zi tepaga chiqib ketadi" sababini topish uchun.
 * Faqat yoqilganda ishlaydi: manzilga ?dbgscroll=1 qo'shing (o'chirish: ?dbgscroll=0).
 * Sakrash (>200px tepaga, ~0 gacha) aniqlansa — faqat console'da (ekranga chiqmaydi; window.__scrollJumps ham bor): kim scrollTo chaqirdi
 * yoki qaysi DOM bo'laklari o'zgardi, sahifa balandligi qanday o'zgardi. */
(function () {
  try {
    const q = new URLSearchParams(location.search).get('dbgscroll');
    if (q === '1') localStorage.setItem('dbgScroll', '1');
    if (q === '0') localStorage.removeItem('dbgScroll');
    if (localStorage.getItem('dbgScroll') !== '1') return;
  } catch (_) { return; }

  const now = () => performance.now();
  let lastCall = null;
  const wrap = (obj, name) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (...a) {
      lastCall = { name, t: now(), stack: (new Error().stack || '').split('\n').slice(2, 6).map(s => s.trim().replace(/^at /, '')).join(' | ') };
      return orig.apply(this, a);
    };
  };
  ['scrollTo', 'scroll', 'scrollBy'].forEach(n => wrap(window, n));
  wrap(Element.prototype, 'scrollIntoView');
  wrap(Element.prototype, 'scrollTo');

  const muts = [];
  const desc = (n) => {
    if (!n || n.nodeType !== 1) return n ? '#text' : '?';
    return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  };
  const mo = new MutationObserver(list => {
    const t = now();
    for (const m of list) {
      if (m.type !== 'childList') continue;
      muts.push({ t, d: desc(m.target), a: m.addedNodes.length, r: m.removedNodes.length });
    }
    while (muts.length && t - muts[0].t > 1500) muts.shift();
    if (muts.length > 200) muts.splice(0, muts.length - 200);
  });
  const startMo = () => document.body && mo.observe(document.body, { childList: true, subtree: true });
  if (document.body) startMo(); else document.addEventListener('DOMContentLoaded', startMo);

  let prevY = window.scrollY, prevH = document.documentElement.scrollHeight, hist = [];

  window.addEventListener('scroll', () => {
    const y = window.scrollY, h = document.documentElement.scrollHeight, t = now();
    if (prevY - y > 200 && y <= 30) {
      const recentMuts = {};
      muts.filter(m => t - m.t < 1000).forEach(m => { const k = m.d; recentMuts[k] = (recentMuts[k] || 0) + m.a + '+/' + m.r + '-'; });
      const call = lastCall && t - lastCall.t < 400 ? `${lastCall.name}: ${lastCall.stack}` : "scrollTo chaqirilmagan (balandlik qisqargan bo'lishi mumkin)";
      const info = [
        `JUMP ${Math.round(prevY)} -> ${Math.round(y)}  path=${location.pathname}`,
        `height ${prevH} -> ${h}`,
        `call: ${call}`,
        `dom(1s): ${Object.entries(recentMuts).slice(0, 8).map(([k, v]) => k + ' ' + v).join(' ; ') || '-'}`,
      ].join('\n');
      (window.__scrollJumps = window.__scrollJumps || []).push(info);
      console.warn('[scroll-jump]\n' + info);
    }
    prevY = y; prevH = h;
  }, { passive: true });
})();
