/**
 * Toast bildirishnomalari — faqat 5 ta majburiy yozuv.
 * Qolgan chaqiriqlar jim: UI o'zi natijani ko'rsatadi.
 *  1) Ruxsat berilmadi
 *  2) Limitdan oshdi
 *  3) Juda tez
 *  4) Sessiya yopildi (parol boshqa qurilmada)
 *  5) Amal bajarilmadi
 */
let _toastTimer = null;

const KEEP = [
  { re: /boshqa qurilmada|vaqtinchalik kod/i, text: "Parolingiz boshqa qurilmada o'zgartirildi. Qayta kiring", type: 'warning' },
  { re: /ruxsat|mikrofon|kameraga/i, text: 'Ruxsat berilmadi', type: 'info' },
  { re: /juda tez/i, text: 'Juda tez yuboryapsiz. Biroz kuting', type: 'warning' },
  { re: /juda ko'p|limit|hajmi|MB dan|daqiqa to'ldi|daqiqadan oshdi/i, text: 'Limitdan oshdi', type: 'warning' },
  { re: /yuborilmadi|yuklanmadi|saqlanmadi|ochilmadi|bo'lmadi|bo‘lmadi|xatolik|xato:|xato yuz|amalga oshmadi|javob bermadi/i, text: 'Amal bajarilmadi', type: 'error' },
];

export function toast(msg, type = '', dur = 2200) {
  const raw = String(msg || '');
  const hit = KEEP.find(a => a.re.test(raw));
  if (!hit) return;
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
