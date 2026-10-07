/* emoji-dom.js — SpaceMR'da EKRANDA ko'rinadigan HAR QANDAY matndagi emoji 2D PNG rasmga aylanadi
   (post, izoh, story, bio, ism, chat ro'yxati, toast... — qaysi modul chizgani muhim emas).
   - emoji belgisi  -> <span class="emj"><img class="emo-img" src="/emoji/2d/<kalit>.png" alt="<belgi>"></span>
   - [[emoji/2d/<kalit>.png]] token (bazadagi path) -> xuddi shunday rasm
   - Kesilgan token oxirida ("[[emoji/2d/1f5" — prevyu 120 belgiga kesilganda) ko'rsatilmaydi
   Tegilmaydi: input/textarea/contenteditable (yozish maydonini brauzer chizadi), script/style, svg, [data-no-emo].
   MutationObserver mikrotaskda ishlaydi — brauzer chizishdan OLDIN, belgi "yaltillab" ko'rinmaydi. */
import { EMO_DIR, failedKeys, keyToGlyph, emojiKey } from './emoji-img.js';

const GLYPH = '(?![\\u00A9\\u00AE\\u2122](?!\\uFE0F))(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3)(?:\\uFE0F|\\u200D\\p{Extended_Pictographic}|[\\u{1F3FB}-\\u{1F3FF}])*';
const RE = new RegExp('\\[\\[emoji\\/2d\\/([0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)\\.png\\]\\]|(' + GLYPH + ')', 'gu');
const HAS = /\[\[|\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
const PARTIAL = /^\[\[emoji\/2d\/[0-9a-f-]*(?:\.(?:p(?:n(?:g\]?)?)?)?)?$/;
const TOKEN_HEAD = '[[emoji/2d/';
const SKIP_SEL = 'script,style,noscript,textarea,input,select,option,svg,[contenteditable=""],[contenteditable="true"],[data-no-emo]';

/** Matn oxiridagi kesilgan tokenni (agar bo'lsa) olib tashlaydi */
export function dropPartialToken(t) {
  const i = t.lastIndexOf('[[');
  if (i < 0) return t;
  const frag = t.slice(i);
  if (frag.length < 4 || frag.includes(']]') || frag.length > 44) return t;
  return (TOKEN_HEAD.startsWith(frag) || PARTIAL.test(frag)) ? t.slice(0, i) : t;
}

function skipped(node) {
  const el = node.parentElement;
  if (!el) return true;
  if (el.closest(SKIP_SEL)) return true;
  return false;
}

function imgSpan(key, glyph) {
  const span = document.createElement('span');
  span.className = 'emj';
  const im = document.createElement('img');
  im.className = 'emo-img';
  im.src = `/${EMO_DIR}/${key}.png`;
  im.alt = glyph;
  im.dataset.key = key;
  im.draggable = false;
  im.decoding = 'async';
  span.appendChild(im);
  return span;
}

/** Bitta matn tugunini aylantiradi (kerak bo'lmasa tegmaydi) */
export function convertTextNode(node) {
  let t = node.nodeValue;
  if (!t || !HAS.test(t) || skipped(node)) return;
  t = dropPartialToken(t);
  RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0, hit = false, m;
  while ((m = RE.exec(t))) {
    const key = m[1] || emojiKey(m[2]);
    const glyph = m[2] || keyToGlyph(key);
    if (!key || !glyph) continue;
    if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
    // Fayli yo'q emoji — belgi o'z holicha qoladi. hit=false: tugun almashtirilmaydi (aks holda observer cheksiz aylanadi)
    if (failedKeys.has(key)) frag.appendChild(document.createTextNode(glyph));
    else { frag.appendChild(imgSpan(key, glyph)); hit = true; }
    last = m.index + m[0].length;
  }
  if (!hit && t === node.nodeValue) return;
  if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
  node.replaceWith(frag);
}

export function convertTree(root) {
  if (!root) return;
  if (root.nodeType === 3) { convertTextNode(root); return; }
  if (root.nodeType !== 1 || root.matches?.(SKIP_SEL)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (HAS.test(n.nodeValue || '')) list.push(n);
  list.forEach(convertTextNode);
}

let _mo = null;
export function initEmojiDom(root = document.body) {
  if (_mo || typeof MutationObserver === 'undefined' || !root) return;
  convertTree(root);
  _mo = new MutationObserver(muts => {
    for (const mu of muts) {
      if (mu.type === 'characterData') convertTextNode(mu.target);
      else mu.addedNodes.forEach(convertTree);
    }
  });
  _mo.observe(root, { childList: true, subtree: true, characterData: true });
}
export function stopEmojiDom() { _mo?.disconnect(); _mo = null; }

if (typeof document !== 'undefined') {
  if (document.body) initEmojiDom();
  else document.addEventListener('DOMContentLoaded', () => initEmojiDom(), { once: true });
}
