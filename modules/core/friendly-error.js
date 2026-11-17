/**
 * Foydalanuvchi (client) hech qachon texnik gap eshitmasligi kerak:
 * Supabase, Storage, HTTP kodlari, SQL/RLS, token, API va h.k. — hammasi oddiy o'zbekchaga aylanadi.
 * Asl matn faqat konsol/error-log'ga yoziladi (toast.js).
 */
const TECH = /supabase|storage|bucket|postgres|pgrst|\bsql\b|\brls\b|row[- ]level|polic(y|ies)|violat|constraint|duplicate key|relation "|\bcolumn\b|schema|\bjwt\b|\btoken\b|http ?\d{3}|\bhttps?\b|status ?(code )?\d{3}|\bapi\b|\bcors\b|\brpc\b|exception|typeerror|referenceerror|syntaxerror|rangeerror|\bundefined\b|\bnull\b|failed to|cannot |can't |\[object|\bfetch\b|network|trigger|edge function|websocket|\bxhr\b|\bpayload\b|\bquery\b|\bendpoint\b|\bmigration|\bpatch \d|\bdb\b|\bdatabase\b|\bserver_now\b|\bstack\b|\bblob\b|\buuid\b|\bjson\b|\bparse\b|\bunexpected\b|\binvalid (input|request|argument)|\bnot found\b|\bforbidden\b|\bunauthorized\b|\btimeout\b|\btimed out\b|\babort/i;

const RULES = [
  { re: /juda katta|too large|exceed|maximum allowed|payload|entity too large|file_too_large|413/i, text: "Bu fayl juda katta. Kichikroq fayl tanlab, qayta urinib ko'ring." },
  { re: /failed to fetch|network|load failed|err_internet|offline|net::|tarmoq/i, text: "Internet bilan aloqa yo'q. Ulanishni tekshirib, qayta urinib ko'ring." },
  { re: /timeout|timed out|vaqti tugadi|abort/i, text: "Biroz kutishga to'g'ri keldi. Qayta urinib ko'ring." },
  { re: /rate|too many|juda ko'p|429|limit/i, text: "Juda tez-tez urinyapsiz. Biroz kutib, qayta urinib ko'ring." },
  { re: /permission|forbidden|unauthori|401|403|rls|row[- ]level|polic(y|ies)|jwt|token|ruxsat/i, text: "Bu amalni bajarishga ruxsat yo'q. Qayta kirib ko'ring." },
  { re: /duplicate|already exists|unique|mavjud/i, text: "Bu allaqachon mavjud." },
  { re: /not found|topilmadi|404/i, text: "Topilmadi." },
];
const GENERIC = "Amal bajarilmadi. Birozdan keyin qayta urinib ko'ring.";
const BARE_PREFIX = /^(xato(lik)?|error|failed|ogohlantirish)$/i;

export function isTechnical(raw) { return TECH.test(String(raw || '')); }

/** Texnik matnni client tiliga o'giradi. Allaqachon oddiy bo'lsa — o'zini qaytaradi. */
export function friendly(raw, fallback = GENERIC) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return fallback;
  if (!TECH.test(s)) return s;
  // "Yaratib bo'lmadi: <texnik>" — oddiy old qismini saqlab, texnik dumni tashlaymiz
  const i = s.indexOf(': ');
  if (i > 0) {
    const head = s.slice(0, i).trim();
    if (head && !BARE_PREFIX.test(head) && !TECH.test(head) && head.length <= 60) return head + '.';
  }
  for (const r of RULES) if (r.re.test(s)) return r.text;
  return fallback;
}
