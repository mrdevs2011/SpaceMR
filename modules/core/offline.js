/**
 * offline.js — oflayn holat banneri (ROADMAP 4-band).
 * "Ulanish yo'q" yo'lagi: oflaynda chiqadi, ulanganda o'zi yo'qoladi.
 * Element #offlineIndicator — CSS/layers.css da stil berilgan.
 */

const ID = 'offlineIndicator';
const TEXT = "Ulanish yo'q";

function ensureEl() {
  let el = document.getElementById(ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = ID;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = TEXT;
  el.hidden = true;
  (document.body || document.documentElement).appendChild(el);
  return el;
}

function setOffline(off) {
  const el = ensureEl();
  if (off) {
    el.hidden = false;
    el.classList.add('is-visible');
  } else {
    el.hidden = true;
    el.classList.remove('is-visible');
  }
}

function sync() {
  setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
}

function init() {
  if (typeof window === 'undefined') return;
  sync();
  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online', () => setOffline(false));
  // Ba'zi brauzerlar offline event bermaydi — visibility da qayta tekshirish
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

export { setOffline, sync };
