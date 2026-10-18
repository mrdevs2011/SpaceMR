/** "Uzatilgan xabar" belgisi: asl yuboruvchi ismi xabar matnining boshiga ko'rinmas belgi bilan yoziladi
 *  (bazaga yangi ustun kerak emas). O'qishda (mapMessage, preview, push) olib tashlanadi.
 *  Format:  U+2063 "fwd:" encodeURIComponent(ism) U+2063  +  asl matn */
const SEP = '\u2063';
const RE = /^\u2063fwd:([^\u2063]*)\u2063/;

export function wrapFwd(name, text) {
  const n = String(name || '').trim().slice(0, 80) || 'Foydalanuvchi';
  return SEP + 'fwd:' + encodeURIComponent(n) + SEP + String(text || '');
}

/** → { text: markersiz matn, name: asl yuboruvchi yoki '' } */
export function splitFwd(raw) {
  const s = raw == null ? '' : String(raw);
  const m = RE.exec(s);
  if (!m) return { text: s, name: '' };
  let name = '';
  try { name = decodeURIComponent(m[1]); } catch (_) { name = m[1]; }
  return { text: s.slice(m[0].length), name: name || 'Foydalanuvchi' };
}
