/* emoji-only.js — xabar faqat emojidan iborat bo'lsa, chat.js/groups.js `.chat-msg` ga qo'shadigan klass.
   1 ta emoji eng katta, 2 va 3 ta — kichikroq (bubblesiz); 4+ — oddiy bubble (CSS: .emo-1..emo-3). */
import { emojiImg } from './emoji-img.js';
const SEG = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const EMO = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u;

export function emojiOnlyCount(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t || t.length > 200) return 0;
  const parts = SEG ? [...SEG.segment(t)].map(s => s.segment) : Array.from(t);
  for (const g of parts) if (!EMO.test(g)) return 0;
  return parts.length;
}

export function emojiOnlyClass(text) {
  const n = emojiOnlyCount(text);
  // Telegramdagidek: 1–3 ta emoji — bubblesiz katta; 4 va undan ko'p — oddiy bubble ichida
  return (n >= 1 && n <= 3) ? ` emoji-only emo-${n}` : '';
}

/* ── Faqat 1 ta emoji: ustiga bosilsa klassik, yumshoq "bosilib-qaytish" animatsiyasi (1 -> 1.12 -> 1).
   Zarralar, combo hisoblagich va BOOM yo'q — silliq va hammaga tanish uslub.
   Bosish suhbatdoshga ham uzatiladi: hujjat hodisasi `emo-tap` {id, k} — chat.js (DM) va groups.js (guruh)
   uni rt kanaliga yuboradi; kelganda playRemoteEmoji(id, k) chaqiriladi (k qiymati endi e'tiborga olinmaydi). */
let _tapInit = false;
export function initEmojiTap() {
  if (_tapInit || typeof document === 'undefined') return;
  _tapInit = true;
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('.chat-msg.emoji-only.emo-1 .chat-bubble-text');
    if (t) onTap(t);
  });
}

function onTap(t) {
  const id = t.closest('.chat-msg')?.dataset.msgId || '';
  softPop(t);
  emit(id, 1);
}

function emit(id, k) {
  if (!id) return;
  try { document.dispatchEvent(new CustomEvent('emo-tap', { detail: { id, k } })); } catch (_) {}
}

/** Suhbatdoshdan kelgan bosish — o'sha xabar ekranda bo'lsa yumshoq o'ynatiladi */
export function playRemoteEmoji(id /*, k */) {
  if (!id || typeof document === 'undefined') return;
  const t = document.querySelector(`.chat-msg.emoji-only.emo-1[data-msg-id="${CSS.escape(String(id))}"] .chat-bubble-text`);
  if (t) softPop(t);
}

function softPop(t) {
  t.classList.remove('emo-play');
  void t.offsetWidth;   // animatsiyani qayta boshlash
  t.classList.add('emo-play');
}

initEmojiTap();

/* Xabar HTML'idagi emojilarni <span class="emj"> ichiga o'raydi — CSS user-select:none
   (chat/guruhda emoji belgilanmaydi). Teglar ichiga tegilmaydi. */
const EMJ_RE = /(<[^>]*>)|((?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/gu;
/* kind: '2d' (oddiy) yoki '3d' (faqat bubblesiz katta emoji-only xabarlar) — rasm emoji-img.js'dan */
export function wrapEmojiNoSelect(html, kind = '2d') {
  return String(html || '').replace(EMJ_RE, (m, tag, emo) => tag ? tag : `<span class="emj">${emojiImg(emo, kind)}</span>`);
}
