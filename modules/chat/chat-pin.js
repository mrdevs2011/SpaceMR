/**
 * Chat/guruh har safar (sahifa yangilanganda ham) ENG OXIRGI xabardan ochiladi.
 *
 * Muammo: ochilganda bir marta pastga scroll qilinadi, keyin esa qatorlar (content-visibility
 * taxminiy balandligi), rasm/video/ovoz to'lqini yuklanib balandlik o'zgaradi va ko'rinish
 * pastdan "siljib" qoladi. Bu modul chat ochilgach qisqa vaqt (~2.5s) pastga qayta-qayta
 * yopishtiradi; foydalanuvchi o'zi scroll/tegsa — darhol to'xtaydi.
 *
 * chat.js ga tegmaydi: #chatThreadMessages ichida birinchi xabar qatori paydo bo'lishini
 * (spinner/bo'sh holatdan keyin) kuzatadi — bu DM ham, guruh ham uchun bir xil.
 */
const BOX_ID = 'chatThreadMessages';
const PIN_MS = 2500;
const USER_EVENTS = ['wheel', 'touchstart', 'mousedown', 'keydown', 'pointerdown'];
const MEDIA_EVENTS = ['load', 'loadedmetadata', 'loadeddata'];

export function pinBottom(box, ms = PIN_MS) {
  if (!box) return;
  box._pinStop?.();
  const go = () => { box.scrollTop = box.scrollHeight; };
  let done = false;
  const mo = new MutationObserver(go);
  const iv = setInterval(go, 80);
  const stop = () => {
    if (done) return;
    done = true;
    clearInterval(iv); clearTimeout(tm); mo.disconnect();
    USER_EVENTS.forEach(e => box.removeEventListener(e, stop, true));
    MEDIA_EVENTS.forEach(e => box.removeEventListener(e, go, true));
    if (box._pinStop === stop) box._pinStop = null;
  };
  const tm = setTimeout(stop, ms);
  box._pinStop = stop;
  USER_EVENTS.forEach(e => box.addEventListener(e, stop, { capture: true, passive: true }));
  MEDIA_EVENTS.forEach(e => box.addEventListener(e, go, true));
  mo.observe(box, { childList: true, subtree: true });
  go();
  requestAnimationFrame(go);
}

let _lastBox = null;
let _had = false;

function check() {
  const box = document.getElementById(BOX_ID);
  if (!box) { _lastBox = null; _had = false; return; }
  if (box !== _lastBox) { _lastBox = box; _had = false; }
  const has = !!box.querySelector(':scope > .chat-msg');
  if (has && !_had) pinBottom(box);   // bo'sh/spinner -> xabarlar: chat endi ochildi
  _had = has;
}

if (typeof document !== 'undefined') {
  const start = () => {
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    check();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}
