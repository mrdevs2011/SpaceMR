/** "Uzatilgan xabar" belgisi: asl manba (odam yoki guruh) xabar matnining boshiga ko'rinmas belgi bilan yoziladi
 *  (bazaga yangi ustun kerak emas). O'qishda (mapMessage, preview, push) olib tashlanadi.
 *  Format:  U+2063 "fwd:" kind(u|g) ":" id ":" encodeURIComponent(ism) U+2063  +  asl matn
 *  Eski format (faqat ism): U+2063 "fwd:" ism U+2063 — ham o'qiladi (bosilmaydi). */
const SEP = '\u2063';
const RE_NEW = /^\u2063fwd:([ug]):([^:\u2063]*):([^\u2063]*)\u2063/;
const RE_OLD = /^\u2063fwd:([^\u2063]*)\u2063/;

const dec = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };

/** kind: 'u' (odam, id = user uid) yoki 'g' (guruh, id = group id) */
export function wrapFwd(name, text, kind = 'u', id = '') {
  const n = String(name || '').trim().slice(0, 80) || (kind === 'g' ? 'Guruh' : 'Foydalanuvchi');
  const k = kind === 'g' ? 'g' : 'u';
  const i = String(id || '').replace(/[:\u2063]/g, '');
  return SEP + 'fwd:' + k + ':' + i + ':' + encodeURIComponent(n) + SEP + String(text || '');
}

/** → { text: markersiz matn, name: manba nomi yoki '', kind: 'u'|'g'|'', id } */
export function splitFwd(raw) {
  const s = raw == null ? '' : String(raw);
  let m = RE_NEW.exec(s);
  if (m) return { text: s.slice(m[0].length), name: dec(m[3]) || (m[1] === 'g' ? 'Guruh' : 'Foydalanuvchi'), kind: m[1], id: m[2] };
  m = RE_OLD.exec(s);
  if (m) return { text: s.slice(m[0].length), name: dec(m[1]) || 'Foydalanuvchi', kind: '', id: '' };
  return { text: s, name: '', kind: '', id: '' };
}
