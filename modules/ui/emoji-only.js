/* emoji-only.js — xabar faqat emojidan iborat bo'lsa, chat.js/groups.js `.chat-msg` ga qo'shadigan klass.
   1 ta emoji eng katta, 2 va 3 ta — kichikroq (bubblesiz); 4+ — oddiy bubble (CSS: .emo-1..emo-3). */
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

/* ── Faqat 1 ta emoji bo'lsa, ustiga bosilganda elastik animatsiya + uchib chiqadigan emojilar ── */
let _tapInit = false;
export function initEmojiTap() {
  if (_tapInit || typeof document === 'undefined') return;
  _tapInit = true;
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('.chat-msg.emoji-only.emo-1 .chat-bubble-text');
    if (t) playEmojiTap(t);
  });
}

function playEmojiTap(t) {
  t.classList.remove('emo-play'); void t.offsetWidth; t.classList.add('emo-play');
  try { navigator.vibrate?.(8); } catch {}
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const bubble = t.closest('.chat-bubble'); if (!bubble) return;
  const txt = t.textContent.replace(/\s+/g, '');
  const parts = SEG ? [...SEG.segment(txt)].map(s => s.segment) : Array.from(txt);
  if (!parts.length) return;
  for (let i = 0; i < 7; i++) {
    const s = document.createElement('span');
    s.className = 'emo-fx';
    s.textContent = parts[Math.floor(Math.random() * parts.length)];
    s.style.setProperty('--dx', (Math.random() * 130 - 65).toFixed(0) + 'px');
    s.style.setProperty('--dy', (-(55 + Math.random() * 75)).toFixed(0) + 'px');
    s.style.setProperty('--rot', (Math.random() * 60 - 30).toFixed(0) + 'deg');
    s.style.setProperty('--sz', (16 + Math.random() * 12).toFixed(0) + 'px');
    s.style.setProperty('--dl', (i * 35) + 'ms');
    s.addEventListener('animationend', () => s.remove());
    bubble.appendChild(s);
  }
}

initEmojiTap();

/* Xabar HTML'idagi emojilarni <span class="emj"> ichiga o'raydi — CSS user-select:none
   (chat/guruhda emoji belgilanmaydi). Teglar ichiga tegilmaydi. */
const EMJ_RE = /(<[^>]*>)|((?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/gu;
export function wrapEmojiNoSelect(html) {
  return String(html || '').replace(EMJ_RE, (m, tag, emo) => tag ? tag : `<span class="emj">${emo}</span>`);
}
