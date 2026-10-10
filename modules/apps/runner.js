/**
 * Ilova runner — foydalanuvchi HTML ilovasini XAVFSIZ ishga tushiradi.
 *
 * Xavfsizlik modeli (ataylab qat'iy):
 *  - iframe `sandbox` ichida, `allow-same-origin` BERILMAGAN -> ilova "opaque origin"da yashaydi:
 *    SpaceMR DOM'i, localStorage/cookie, Supabase tokeni, parent.document — HECH QAYSISI ko'rinmaydi.
 *  - `allow-top-navigation`, `allow-popups-to-escape-sandbox` YO'Q -> SpaceMR sahifasini boshqa joyga
 *    yo'naltira olmaydi, ochgan oynasi sandboxdan chiqmaydi.
 *  - Ilova bilan yagona aloqa: postMessage orqali o'z localStorage nusxasini saqlash. Parent faqat
 *    shu iframe'dan (e.source tekshiriladi), qat'iy shakldagi, hajmi cheklangan xabarni qabul qiladi
 *    va faqat shu ilovaga ajratilgan alohida kalitga yozadi. Boshqa hech narsa o'qilmaydi/bajarilmaydi.
 *  - Opaque origin'da localStorage ishlamaydi (file:// kabi) — shuning uchun ichkariga kichik shim
 *    qo'yiladi: localStorage/sessionStorage ishlayveradi (localStorage qurilmada saqlanadi).
 */
import { state } from '../core/config.js';

const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock allow-presentation';
const ALLOW = 'fullscreen; autoplay; clipboard-write; gamepad';
const MAX_BYTES = 200 * 1024;   // bitta ilovaning saqlanadigan ma'lumoti
const MAX_KEYS = 500;
const MAX_KEY_LEN = 200;

const dataKey = appId => `spacemr_appdata:${state.me?.uid || 'x'}:${appId}`;

/** Faqat {string:string} ko'rinishidagi, cheklovga sig'adigan obyektni qaytaradi, aks holda null. */
function sanitize(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = Object.create(null);
  let n = 0, bytes = 0;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v !== 'string' || k.length > MAX_KEY_LEN) return null;
    if (++n > MAX_KEYS) return null;
    bytes += k.length + v.length;
    if (bytes > MAX_BYTES) return null;
    out[k] = v;
  }
  return out;
}

function loadData(appId) {
  try { return sanitize(JSON.parse(localStorage.getItem(dataKey(appId)) || '{}')) || Object.create(null); }
  catch (_) { return Object.create(null); }
}

function saveData(appId, obj) {
  try { localStorage.setItem(dataKey(appId), JSON.stringify(obj)); } catch (_) { /* kvota to'lgan — ilova ishlashda davom etadi */ }
}

/* Iframe ICHIDA ishlaydigan shim (toString orqali ichiga solinadi — bu funksiya parent kontekstida ishlamaydi) */
function shimMain(seed, persist) {
  var P = '__spacemr_app';
  function make(init, persist) {
    var d = Object.create(null), t = 0, k;
    for (k in init) d[k] = String(init[k]);
    function snap() { var o = {}, x; for (x in d) o[x] = d[x]; return o; }
    function flush() { t = 0; if (!persist) return; try { var m = {}; m[P] = 1; m.t = 'ls'; m.data = snap(); parent.postMessage(m, '*'); } catch (e) {} }
    function sched() { if (persist && !t) t = setTimeout(flush, 300); }
    var api = {
      getItem: function (key) { key = String(key); return key in d ? d[key] : null; },
      setItem: function (key, v) { d[String(key)] = String(v); sched(); },
      removeItem: function (key) { delete d[String(key)]; sched(); },
      clear: function () { d = Object.create(null); sched(); },
      key: function (i) { var ks = Object.keys(d); return i >= 0 && i < ks.length ? ks[i] : null; }
    };
    Object.defineProperty(api, 'length', { configurable: true, get: function () { return Object.keys(d).length; } });
    if (persist) { addEventListener('pagehide', flush); addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); }); }
    return new Proxy(api, {
      get: function (o, p) { return p in o ? o[p] : (typeof p === 'string' && p in d ? d[p] : undefined); },
      set: function (o, p, v) { api.setItem(p, v); return true; },
      deleteProperty: function (o, p) { api.removeItem(p); return true; },
      has: function (o, p) { return p in o || p in d; },
      ownKeys: function () { return Object.keys(d).concat(['length']); },
      getOwnPropertyDescriptor: function (o, p) {
        if (p === 'length') return Object.getOwnPropertyDescriptor(o, 'length');
        return p in d ? { value: d[p], writable: true, enumerable: true, configurable: true } : undefined;
      }
    });
  }
  try { Object.defineProperty(window, 'localStorage', { value: make(seed, persist !== false), configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: make({}, false), configurable: true }); } catch (e) {}
}

function shimTag(seed, persist) {
  const json = JSON.stringify(seed).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script>(${shimMain.toString()})(${json},${persist === false ? 'false' : 'true'});</script>`;
}

/** Shimni foydalanuvchi HTML'iga qo'shadi (doctype'ni buzmasdan -> quirks mode bo'lmaydi). */
function inject(html, seed, persist) {
  const tag = shimTag(seed, persist);
  let m = /<head(\s[^>]*)?>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
  m = /<html(\s[^>]*)?>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + '<head>' + tag + '</head>' + html.slice(m.index + m[0].length);
  m = /^\s*<!doctype[^>]*>/i.exec(html);
  if (m) return html.slice(0, m[0].length) + tag + html.slice(m[0].length);
  return '<!doctype html>' + tag + html;
}

/**
 * Ilovani `host` elementiga ishga tushiradi. Qaytaradi: { destroy(), reload() }.
 * app: { id, html }
 */
export function runApp(host, app) {
  const keep = app.persist !== false;   // false: localStorage faqat sessiya ichida (post/chat preview)
  let frame = null;
  let onMsg = null;

  function start() {
    stop();
    frame = document.createElement('iframe');
    frame.className = 'apr-frame';
    frame.setAttribute('sandbox', SANDBOX);       // allow-same-origin YO'Q — ataylab
    frame.setAttribute('allow', ALLOW);
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('loading', 'eager');
    frame.srcdoc = inject(String(app.html || ''), keep ? loadData(app.id) : Object.create(null), keep);
    onMsg = e => {
      if (!keep || !frame || e.source !== frame.contentWindow) return;   // faqat shu iframe
      const d = e.data;
      if (!d || typeof d !== 'object' || d.__spacemr_app !== 1 || d.t !== 'ls') return;
      const clean = sanitize(d.data);
      if (clean) saveData(app.id, clean);
    };
    window.addEventListener('message', onMsg);
    host.appendChild(frame);
  }

  function stop() {
    if (onMsg) { window.removeEventListener('message', onMsg); onMsg = null; }
    if (frame) { frame.srcdoc = ''; frame.remove(); frame = null; }
  }

  start();
  return { destroy: stop, reload: start };
}
