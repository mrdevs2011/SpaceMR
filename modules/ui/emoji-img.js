/* emoji-img.js — SpaceMR'da emoji FAQAT 2D PNG rasm sifatida ishlaydi (tizim emoji shrifti ko'rsatilmaydi).
   Fayl:    /emoji/2d/<kalit>.png (72px). Kalit = kodpointlar kichik harf, '-' bilan, FE0F tashlangan (1f602, 1f468-200d-1f4bb).
   Bazaga (Supabase) rasm EMAS, faqat PATH yoziladi:  "emoji/2d/1f525.png"
     - reaksiyalar:  message_reactions.emoji = path
     - xabar matni:  matn ichida  [[emoji/2d/1f525.png]]  (yuborishda klaviatura emojisi shunga aylantiriladi)
   Ko'rsatishda path'dan <img> real vaqtda chiziladi. Path DB'dan kelgani uchun HAR DOIM EMO_PATH_RE bilan tekshiriladi (XSS yo'q).
   Kodda emoji belgisi yo'q: ro'yxatlar kalit (hex) bilan yoziladi. */
export const EMO_DIR = 'emoji/2d';
export const EMO_PATH_RE = /^emoji\/2d\/[0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*\.png$/;
const KEY_RE = /^[0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*$/;
const TOKEN_RE = /\[\[(emoji\/2d\/[0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*\.png)\]\]/g;
const PUA = '\uE000';   // token o'rniga bitta belgi (emoji-only hisoblash uchun)

/* Emoji belgisi (grapheme) -> kalit. FE0F tashlanadi. */
export function emojiKey(e) {
  const out = [];
  for (const ch of String(e || '')) {
    const h = ch.codePointAt(0).toString(16);
    if (h !== 'fe0f') out.push(h);
  }
  return out.join('-');
}
/* Kalit | path | emoji belgisi  ->  kalit ('' agar yaroqsiz) */
export function toKey(x) {
  const s = String(x || '');
  if (KEY_RE.test(s)) return s;
  const m = s.match(/^emoji\/2d\/(.+)\.png$/);
  if (m && KEY_RE.test(m[1])) return m[1];
  if (EMO_PATH_RE.test(s)) return s.slice(EMO_DIR.length + 1, -4);
  const k = emojiKey(s);
  return KEY_RE.test(k) ? k : '';
}
export const emojiPath = x => { const k = toKey(x); return k ? `${EMO_DIR}/${k}.png` : ''; };
export const isEmojiPath = s => EMO_PATH_RE.test(String(s || ''));
/* Kalit -> belgi (faqat yozish maydoniga qo'yish va rasm yuklanmay qolgan holat uchun) */
export function keyToGlyph(x) {
  const k = toKey(x);
  if (!k) return '';
  try { return String.fromCodePoint(...k.split('-').map(h => parseInt(h, 16))); } catch (_) { return ''; }
}

/* Bitta emoji rasmi (HTML). x = kalit | path | belgi. lazy=true — qidiruv natijalari uchun */
export function emojiImg(x, kind, lazy) {
  if (kind === true || kind === false) lazy = kind;      // eski chaqiruv: emojiImg(e, '2d', lazy) ham ishlaydi
  const k = toKey(x);
  if (!k) return '';
  return `<img class="emo-img" src="/${EMO_DIR}/${k}.png" alt="" data-key="${k}" draggable="false"${lazy ? ' loading="lazy" decoding="async"' : ' decoding="sync"'}>`;
}

/* Tez-tez ishlatiladigan emojilarni oldindan keshga soladi (idle) */
const _warmed = new Set();
export function warmEmoji(list) {
  if (typeof window === 'undefined') return;
  const run = () => {
    for (const x of list) {
      const k = toKey(x);
      if (!k || _warmed.has(k)) continue;
      _warmed.add(k);
      const im = new Image(); im.decoding = 'async'; im.fetchPriority = 'low'; im.src = `/${EMO_DIR}/${k}.png`;
    }
  };
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(run, { timeout: 4000 });
}
/* Rasm topilmasa (juda yangi emoji) — kontent yo'qolmasin: belgi matn bo'lib qoladi */
if (typeof document !== 'undefined') {
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('emo-img')) return;
    img.replaceWith(document.createTextNode(keyToGlyph(img.dataset.key)));
  }, true);
}
/* Picker sprite'ini (kategoriya atlasi) oldindan keshlaydi */
export function warmAtlas(id) {
  if (typeof window === 'undefined' || !id || _warmed.has('atlas:' + id)) return;
  _warmed.add('atlas:' + id);
  const im = new Image(); im.decoding = 'async'; im.fetchPriority = 'low'; im.src = `/emoji/atlas/${id}.png`;
}

/* ── Matn <-> path ─────────────────────────────────────────────────────────────── */
const EMO_SEQ = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;
/* YUBORISHDAN OLDIN: matndagi emoji belgilari -> [[emoji/2d/<kalit>.png]] (bazaga faqat path boradi) */
export function encodeEmojiText(text) {
  return String(text ?? '').replace(EMO_SEQ, m => { const p = emojiPath(m); return p ? `[[${p}]]` : m; });
}
/* TAHRIRLASH (yozish maydoniga qaytarish): [[path]] -> belgi (maydon oddiy matn; yuborishda yana path bo'ladi) */
export function decodeEmojiText(text) {
  return String(text ?? '').replace(TOKEN_RE, (_, p) => keyToGlyph(p));
}
/* Faqat matn ko'rinadigan joylar (push, qidiruv nusxasi): token olib tashlanadi */
export function stripEmojiText(text) {
  return String(text ?? '').replace(TOKEN_RE, '').replace(/\s{2,}/g, ' ').trim();
}
/* Xavfsiz HTML (esc qilingan matn): [[path]] va eski xabarlardagi belgilar -> <span class="emj"><img>. Teglar ichiga tegilmaydi. */
const HTML_RE = /(<[^>]*>)|\[\[(emoji\/2d\/[0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*\.png)\]\]|((?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/gu;
export function emojiHtml(html) {
  return String(html ?? '').replace(HTML_RE, (m, tag, path, glyph) => {
    if (tag) return tag;
    const img = emojiImg(path || glyph);
    return img ? `<span class="emj">${img}</span>` : m;
  });
}
/* emoji-only xabar hisobi uchun: tokenlarni bitta belgiga aylantiradi */
export const tokensToPua = text => String(text ?? '').replace(TOKEN_RE, PUA);
export const EMO_PUA = PUA;
