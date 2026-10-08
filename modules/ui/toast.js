/**
 * Toast bildirishnomalari — foydalanuvchiga faqat tushunarli o'zbekcha matn.
 * Texnik tafsilot (Failed to fetch, e.message) hech qachon ekranga chiqmaydi (ROADMAP 9).
 *  1) Ruxsat berilmadi
 *  2) Limitdan oshdi
 *  3) Juda tez
 *  4) Sessiya yopildi
 *  5) Amal bajarilmadi / Internet yo'q / Server
 *  6) Guruhda yozish huquqi yo'q
 */
let _toastTimer = null;

const KEEP = [
  { re: /admin tomonidan ruxsat/i, text: 'Siz admin tomonidan ruxsatga ega emassiz', type: 'warning' },
  { re: /boshqa qurilmada|vaqtinchalik kod/i, text: "Parolingiz boshqa qurilmada o'zgartirildi. Qayta kiring", type: 'warning' },
  { re: /ruxsat|mikrofon|kameraga/i, text: 'Ruxsat berilmadi', type: 'info' },
  { re: /juda tez/i, text: 'Juda tez yuboryapsiz. Biroz kuting', type: 'warning' },
  { re: /juda ko'p|limit|hajmi|MB dan|daqiqa to'ldi|daqiqadan oshdi/i, text: 'Limitdan oshdi', type: 'warning' },
  { re: /internet yo'q|ulanis yo'q|offline|qoralama|failed to fetch|networkerror|net::|load failed|err_internet/i, text: "Internet yo'q, qayta urinib ko'ring", type: 'error' },
  { re: /server|503|502|500|timeout|timed out|gateway/i, text: 'Server javob bermadi, birozdan keyin urinib ko\'ring', type: 'error' },
  { re: /ruxsat yo'q|permission|forbidden|401|403|RLS|policy/i, text: "Bu amalga ruxsat yo'q", type: 'error' },
  { re: /yuborilmadi|yuklanmadi|saqlanmadi|ochilmadi|bo'lmadi|bo‘lmadi|xatolik|xato:|xato yuz|amalga oshmadi|javob bermadi|joylanmadi|o'chirib bo'lmadi/i, text: 'Amal bajarilmadi', type: 'error' },
];

function _logTech(raw) {
  try {
    import('../core/error-log.js').then(m => m?.logError?.(raw, 'toast')).catch(() => {});
  } catch (_) {}
  try { console.warn('[toast]', raw); } catch (_) {}
}

export function toast(msg, type = '', dur = 2200) {
  const raw = String(msg || '');
  // error tipida texnik matn — KEEP ga tushmasa ham umumiy xabar
  let hit = KEEP.find(a => a.re.test(raw));
  if (!hit && (type === 'error' || /error|fail|exception|reject/i.test(raw))) {
    hit = { text: 'Amal bajarilmadi', type: 'error' };
    _logTech(raw);
  }
  if (!hit) return;
  if (hit.type === 'error' && raw && raw !== hit.text) _logTech(raw);

  const el = document.getElementById('toast');
  if (!el) {
    if (hit.type === 'error') console.warn('[toast]', raw);
    return;
  }
  el.textContent = hit.text;
  el.className = `toast-${hit.type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, Math.max(800, dur | 0));
}
