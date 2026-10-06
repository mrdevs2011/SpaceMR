/* emoji-img.js — emojini tizim shrifti o'rniga rasm (Noto, WebP) qilib ko'rsatadi: hamma telefonda bir xil.
   2d = /emoji/2d (72px)  — picker, matn ichi, reaksiyalar, bubble ichidagi emojilar.
   3d = /emoji/3d (128px) — faqat bubblesiz katta xabarlar (1–3 ta emoji, `emoji-only`).
   Fayl nomi: kodpointlar kichik harf, '-' bilan, FE0F tashlangan (masalan 1f602.webp, 1f468-200d-1f4bb.webp).
   Rasm topilmasa: 3d -> 2d -> oddiy matn emoji (bo'sh joy qolmaydi). */
const BASE = '/emoji';
// Matn ko'rinishidagi belgilar (©, ™, ❤ FE0F'siz) rasmga aylanmasin — faqat haqiqiy emoji
const NEEDS_IMG = /\p{Emoji_Presentation}|\uFE0F|\u20E3/u;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function emojiKey(e) {
  const out = [];
  for (const ch of String(e || '')) {
    const h = ch.codePointAt(0).toString(16);
    if (h !== 'fe0f') out.push(h);
  }
  return out.join('-');
}

/* lazy=true — faqat qidiruv natijalari (ko'p rasm, ko'rinmaydiganlari yuklanmasin). Chat/reaksiyada darrov yuklanadi va
   sinxron dekodlanadi (kesh'dan kelsa birinchi kadrdayoq chiqadi, "keyinroq paydo bo'lish" yo'q). */
export function emojiImg(e, kind = '2d', lazy = false) {
  if (!e || !NEEDS_IMG.test(e)) return esc(e || '');
  const key = emojiKey(e);
  return `<img class="emo-img" src="${BASE}/${kind}/${key}.webp" alt="${esc(e)}" data-key="${key}" data-k="${kind}" draggable="false"${lazy ? ' loading="lazy" decoding="async"' : ' decoding="sync"'}>`;
}

/* Tez-tez ishlatiladigan emojilarni (reaksiyalar va h.k.) ilova bo'sh turganda oldindan yuklab, keshga soladi —
   birinchi ochilishda ham kechikish bo'lmasin. Asosiy yuklashga xalaqit bermaydi (idle). */
const _warmed = new Set();
export function warmEmoji(list, kind = '2d') {
  if (typeof window === 'undefined') return;
  const run = () => {
    for (const e of list) {
      if (!NEEDS_IMG.test(e)) continue;
      const url = `${BASE}/${kind}/${emojiKey(e)}.webp`;
      if (_warmed.has(url)) continue;
      _warmed.add(url);
      const im = new Image(); im.decoding = 'async'; im.fetchPriority = 'low'; im.src = url;
    }
  };
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(run, { timeout: 4000 });
}

// error hodisasi ko'pirmaydi — capture bosqichida ushlaymiz (bitta global tinglovchi)
if (typeof document !== 'undefined') {
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('emo-img')) return;
    if (img.dataset.k === '3d') { img.dataset.k = '2d'; img.src = `${BASE}/2d/${img.dataset.key}.webp`; return; }
    img.replaceWith(document.createTextNode(img.alt));
  }, true);
}

/* Picker sprite'ini (kategoriya atlasi) oldindan keshlaydi */
export function warmAtlas(id) {
  if (typeof window === 'undefined' || !id || _warmed.has('atlas:' + id)) return;
  _warmed.add('atlas:' + id);
  const im = new Image(); im.decoding = 'async'; im.fetchPriority = 'low'; im.src = `${BASE}/atlas/${id}.webp`;
}

/* Klaviaturadan (yoki paneldan) emoji kiritilganda — yuborishdan OLDIN ikkala (2D va 3D) rasmini yuklab qo'yamiz:
   xabar chiqqanda rasm allaqachon keshda bo'ladi. */
const EMO_SEQ = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*|\p{Regional_Indicator}{2}/gu;
export function warmTyped(text) {
  const m = String(text || '').match(EMO_SEQ);
  if (!m) return;
  const uniq = [...new Set(m)].slice(0, 6);
  warmEmoji(uniq, '2d'); warmEmoji(uniq, '3d');
}
if (typeof document !== 'undefined') {
  document.addEventListener('input', (ev) => { const d = ev.data; if (d && d.length <= 40) warmTyped(d); }, true);
}
