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

/* ── Faqat 1 ta emoji: ustiga bosilsa har emojida bir xil quvnoq "jelly" animatsiya + uchib chiqadigan emojilar.
   Ketma-ket (har bosish orasi <= 650ms) 5 marta bosilsa — BOOM (zarba to'lqini, yalt, portlash).
   Bosish/boom suhbatdoshga ham uzatiladi: hujjat hodisasi `emo-tap` {id, k} (k: 1 — bosish, 2 — boom) —
   chat.js (DM) va groups.js (guruh) uni rt kanaliga yuboradi; kelganda playRemoteEmoji(id, k) chaqiriladi. */
const COMBO_GAP = 650, COMBO_BOOM = 5;
const _combo = new Map();   // xabar id -> { n, t }
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);
const segsOf = t => {
  const txt = t.textContent.replace(/\s+/g, '');
  return SEG ? [...SEG.segment(txt)].map(s => s.segment) : Array.from(txt);
};

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
  const key = id || 'local';
  const now = Date.now();
  let c = _combo.get(key);
  if (!c || now - c.t > COMBO_GAP) c = { n: 0, t: now };
  c.n++; c.t = now;
  _combo.set(key, c);
  if (c.n >= COMBO_BOOM) {
    _combo.delete(key);
    boomFx(t);
    emit(id, 2);
  } else {
    tapFx(t, c.n);
    emit(id, 1);
  }
}

function emit(id, k) {
  if (!id) return;
  try { document.dispatchEvent(new CustomEvent('emo-tap', { detail: { id, k } })); } catch (_) {}
}

/** Suhbatdoshdan kelgan bosish (k=1) yoki boom (k=2) — o'sha xabar ekranda bo'lsa o'ynatiladi */
export function playRemoteEmoji(id, k) {
  if (!id || typeof document === 'undefined') return;
  const t = document.querySelector(`.chat-msg.emoji-only.emo-1[data-msg-id="${CSS.escape(String(id))}"] .chat-bubble-text`);
  if (!t) return;
  if (k === 2) boomFx(t, true); else tapFx(t, 0, true);
}

function restart(t, cls) {
  t.classList.remove('emo-play', 'emo-boom');
  void t.offsetWidth;
  t.classList.add(cls);
}

/** Emoji markazi (ekran koordinatasi); ekrandan tashqarida bo'lsa null */
function center(t) {
  const r = t.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
}

function mkLayer(ms) {
  const l = document.createElement('div');
  l.className = 'emo-fxlayer';
  document.body.appendChild(l);
  setTimeout(() => l.remove(), ms);
  return l;
}

function particle(l, c, ch, dx, dy, o = {}) {
  const s = document.createElement('span');
  s.className = 'emo-p';
  s.textContent = ch;
  s.style.cssText = `--x:${c.x}px;--y:${c.y}px;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--rot:${rnd(-200, 200).toFixed(0)}deg;--sz:${(o.sz || rnd(18, 30)).toFixed(0)}px;--dl:${(o.dl || 0).toFixed(0)}ms;--dur:${(o.dur || 1000).toFixed(0)}ms`;
  l.appendChild(s);
}

function tapFx(t, combo, quiet) {
  const c = reduced() ? null : center(t);
  restart(t, 'emo-play');
  if (!quiet) { try { navigator.vibrate?.(8); } catch (_) {} }
  if (!c) return;
  const parts = segsOf(t), l = mkLayer(1500);
  for (let i = 0; i < 9; i++) {
    const ang = rnd(-165, -15) * Math.PI / 180, d = rnd(70, 150);
    particle(l, c, i % 4 === 3 ? '✨' : parts[Math.floor(Math.random() * parts.length)] || '✨', Math.cos(ang) * d, Math.sin(ang) * d, { dl: i * 28, dur: rnd(800, 1100) });
  }
  if (combo >= 2) {
    const b = document.createElement('div');
    b.className = 'emo-combo';
    b.textContent = 'x' + combo;
    b.style.cssText = `--x:${c.x}px;--y:${Math.max(24, c.top - 6)}px;--cs:${(1 + combo * 0.12).toFixed(2)}`;
    l.appendChild(b);
  }
}

function boomFx(t, quiet) {
  const c = reduced() ? null : center(t);
  restart(t, 'emo-boom');
  if (!quiet) { try { navigator.vibrate?.([18, 30, 18, 30, 70]); } catch (_) {} }
  if (!c) return;
  const parts = segsOf(t), l = mkLayer(1900);
  const add = (cls, style) => { const e = document.createElement('div'); e.className = cls; e.style.cssText = `--x:${c.x}px;--y:${c.y}px;${style}`; l.appendChild(e); };
  add('emo-flash', '');
  add('emo-ring', '--s:6');
  add('emo-ring', '--s:9;--dl:120ms');
  const N = 30;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2 + rnd(-0.12, 0.12), d = rnd(90, 240);
    const ch = i % 5 === 0 ? '💥' : i % 5 === 1 ? '✨' : parts[Math.floor(Math.random() * parts.length)] || '✨';
    particle(l, c, ch, Math.cos(ang) * d, Math.sin(ang) * d, { sz: rnd(20, 44), dl: rnd(0, 140), dur: rnd(950, 1350) });
  }
  const b = document.createElement('div');
  b.className = 'emo-combo emo-combo-boom';
  b.textContent = 'BOOM!';
  b.style.cssText = `--x:${c.x}px;--y:${Math.max(28, c.top - 14)}px;--cs:1.6`;
  l.appendChild(b);
}

initEmojiTap();

/* Xabar HTML'idagi emojilarni <span class="emj"> ichiga o'raydi — CSS user-select:none
   (chat/guruhda emoji belgilanmaydi). Teglar ichiga tegilmaydi. */
const EMJ_RE = /(<[^>]*>)|((?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/gu;
export function wrapEmojiNoSelect(html) {
  return String(html || '').replace(EMJ_RE, (m, tag, emo) => tag ? tag : `<span class="emj">${emo}</span>`);
}
