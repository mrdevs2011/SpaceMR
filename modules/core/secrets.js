/**
 * secrets.js — maxfiy ma'lumotlarni (API kalit, token, parol, JWT, private key,
 * karta raqami ...) YUBORISHDAN OLDIN avtomatik ||spoiler|| ga o'raydi.
 *
 * Qoidalar:
 *  - Toza modul (import yo'q): brauzerda ham, Node testida ham ishlaydi.
 *  - Idempotent: protectSecrets(protectSecrets(x)) === protectSecrets(x).
 *  - Allaqachon ||...|| ichida bo'lgan joyga tegmaydi.
 *  - Kod bloki / `inline kod` ichida kalit bo'lsa — butun kod bo'lagi o'raladi.
 *  - Bitta o'tishda ishlaydi (regexlar chiziqli), odatiy xabarda < 1 ms.
 */

const SEG_RE = /(```[\s\S]*?```|`[^`\n]+`|\|\|[\s\S]*?\|\|)/g;

/* Namuna/placeholder qiymatlar — hujjat va misollarni bekorga yashirmaslik uchun */
const PLACEHOLDER_RE = /^(?:<[^>]*>|\{\{[^}]*\}\}|\$\{?\w+\}?|%\w+%|your[_-]|my[_-]?(?:key|token|secret)|x{3,}$|\*{3,}|•+|\.{3,}|_{3,}|-{3,}|example|changeme|null$|undefined$|true$|false$|none$|required$|string$|hidden$|redacted)/i;

const isPlaceholder = v => PLACEHOLDER_RE.test(v);

function entropy(s) {
  const f = Object.create(null);
  for (let i = 0; i < s.length; i++) f[s[i]] = (f[s[i]] || 0) + 1;
  let h = 0;
  for (const k in f) { const p = f[k] / s.length; h -= p * Math.log2(p); }
  return h;
}

function luhn(d) {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

/** Yuqori entropiyali uzun "so'z" kalitga o'xshaydimi (UUID / git SHA / oddiy matn emas) */
function looksLikeKey(tok) {
  if (tok.length < 32 || tok.length > 600) return false;
  const hexOnly = /^[0-9a-f]+$/i.test(tok);
  const noDash = tok.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(noDash) && tok.length === 36) return false;   // UUID
  if (hexOnly) {
    if (tok.length === 40) return false;                                    // git commit SHA
    return entropy(tok) >= 3.0 && !/(.)\1{7,}/.test(tok);
  }
  const hasD = /\d/.test(tok), hasL = /[a-z]/.test(tok), hasU = /[A-Z]/.test(tok);
  const hasSym = /[_+=-]/.test(tok);
  if (!hasD || !(hasL || hasU)) return false;
  if (!((hasL && hasU) || hasSym)) return false;
  return entropy(tok) >= 4.0;
}

/* Qiymati oxirgi guruhda bo'lgan naqshlar: { re, min?, test? } — guruh DOIM match oxirida */
const VAL = '([^\\s"\'`,;|<>(){}\\[\\]]';                                 // qiymat belgilari (qavs ochiq)
const NAME_PRE = '\\b[\\w.-]{0,40}';

const KV = [
  /* parol oilasi — qisqa qiymat ham yashiriladi */
  { re: new RegExp(NAME_PRE + '(?:passw(?:or)?d|passwd|pwd|parol|пароль)[\\w.-]{0,20}["\']?\\s*[:=]\\s*["\'`]?' + VAL + '{4,200})', 'gi'), min: 4 },
  { re: new RegExp('\\b(?:parol|password|пароль)\\s+[-–—]\\s+' + VAL + '{4,200})', 'gi'), min: 4, needDigitOrSym: true },
  /* token / secret / api key / private key ... */
  { re: new RegExp(NAME_PRE + '(?:api[_-]?key|apikey|secret|token|credential|private[_-]?key|access[_-]?key|auth[_-]?key|signing[_-]?key|service[_-]?role)[\\w.-]{0,20}["\']?\\s*[:=]\\s*["\'`]?' + VAL + '{8,500})', 'gi'), min: 8 },
  /* oddiy "key"/"kalit" — faqat kalitga o'xshash qiymat bo'lsa */
  { re: new RegExp(NAME_PRE + '(?:key|kalit)[\\w.-]{0,20}["\']?\\s*[:=]\\s*["\'`]?' + VAL + '{12,500})', 'gi'), min: 12, needKeyLike: true },
];

/* Butun match yashiriladigan naqshlar */
const WHOLE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,                       // JWT (Supabase, Auth0 ...)
  /\bsk-(?:ant-|proj-|svcacct-|admin-|or-v1-)?[A-Za-z0-9_-]{20,}/g,                      // OpenAI / Anthropic / OpenRouter
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g,                      // GitHub
  /\bglpat-[A-Za-z0-9_-]{20,}/g,                                                          // GitLab
  /\bxox[abprso]-[A-Za-z0-9-]{10,}/g, /\bxapp-[A-Za-z0-9-]{10,}/g,                       // Slack
  /\bAIza[0-9A-Za-z_-]{35}/g,                                                             // Google API
  /\bya29\.[0-9A-Za-z_-]{20,}/g,                                                          // Google OAuth
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g,                                        // AWS
  /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/g, /\bwhsec_[A-Za-z0-9]{16,}/g,         // Stripe
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g, /\bsbp_[a-f0-9]{30,}/g,             // Supabase
  /\bhf_[A-Za-z0-9]{30,}/g, /\bnpm_[A-Za-z0-9]{30,}/g,                                   // HuggingFace, npm
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,                                        // SendGrid
  /\bSK[0-9a-f]{32}\b/g,                                                                  // Twilio
  /\bdop_v1_[a-f0-9]{40,}/g,                                                              // DigitalOcean
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,                                                      // Telegram bot token
  /\b[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,                  // Discord token
  /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@\/?#|]+:[^\s@\/?#|]+@[^\s|]*[^\s.,;:!?)\]}'"|]/gi,  // scheme://user:pass@host
];

/* Qiymati oxirgi guruhda: Bearer token */
const BEARER_RE = /\bBearer\s+([A-Za-z0-9._~+\/-]{16,}=*)/gi;

/* Karta raqami: 13–19 raqam (probel/chiziqcha bilan), Luhn + tanish prefiks */
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
const CARD_PREFIX_RE = /^(?:4|5[1-5]|2[2-7]|3[47]|6011|65|8600|9860|5614|6262|4073)/;

/* Standalone yuqori entropiyali so'z (chegara belgisi bilan) */
const TOKEN_RE = /(^|[\s"'`(\[{=:,;])([A-Za-z0-9_+-]{32,600}={0,2})(?=$|[\s"'`)\]},;.!?])/g;

function collect(text, ranges) {
  let m;

  for (const re of WHOLE) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      ranges.push([m.index, m.index + m[0].length]);
    }
  }

  BEARER_RE.lastIndex = 0;
  while ((m = BEARER_RE.exec(text))) {
    const v = m[1];
    if (isPlaceholder(v)) continue;
    const end = m.index + m[0].length;
    ranges.push([end - v.length, end]);
  }

  for (const k of KV) {
    k.re.lastIndex = 0;
    while ((m = k.re.exec(text))) {
      const v = m[1];
      const end = m.index + m[0].length;
      if (!v || v.length < k.min || isPlaceholder(v)) continue;
      if (k.needDigitOrSym && !/[\d\W_]/.test(v)) continue;
      if (k.needKeyLike && !(looksLikeKey(v) || (/\d/.test(v) && /[A-Za-z]/.test(v) && entropy(v) >= 3.2))) continue;
      ranges.push([end - v.length, end]);
    }
  }

  CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(text))) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    if (!CARD_PREFIX_RE.test(digits)) continue;
    const local = /^(?:8600|9860)/.test(digits) && digits.length === 16;
    if (local || luhn(digits)) ranges.push([m.index, m.index + m[0].length]);
  }

  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    const tok = m[2];
    if (!looksLikeKey(tok)) continue;
    const start = m.index + m[1].length;
    ranges.push([start, start + tok.length]);
  }
}

function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) { if (r[1] > last[1]) last[1] = r[1]; }
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Oddiy matn bo'lagi: [yangiMatn, topildimi] */
function protectPlain(text) {
  if (text.length < 6) return [text, false];
  const ranges = [];
  collect(text, ranges);
  if (!ranges.length) return [text, false];
  const merged = mergeRanges(ranges);
  let out = '', pos = 0;
  for (const [s, e] of merged) {
    out += text.slice(pos, s) + '||' + text.slice(s, e) + '||';
    pos = e;
  }
  out += text.slice(pos);
  return [out, true];
}

/** Bo'lakda kalit bormi (kod bloki uchun) */
function hasSecretIn(text) {
  const r = [];
  collect(text, r);
  return r.length > 0;
}

/**
 * Matndagi barcha maxfiy ma'lumotlarni ||...|| ga o'raydi.
 * Maxfiy narsa topilmasa — matn aynan o'sha holda qaytadi (bir xil string).
 */
export function protectSecrets(input) {
  const text = input == null ? '' : String(input);
  if (text.length < 6) return text;

  const parts = text.split(SEG_RE);          // toq indekslar — kod / mavjud spoiler

  const run = (escapeStray) => {
    let changed = false;
    const out = new Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i % 2 === 0) {                      // oddiy matn
        const src = escapeStray ? p.replace(/\|\|/g, '|\u200B|') : p;
        const [np, hit] = protectPlain(src);
        if (hit) changed = true;
        out[i] = np;
      } else if (p.startsWith('||')) {        // allaqachon yashirilgan
        out[i] = p;
      } else if (hasSecretIn(p)) {            // kod bo'lagi: ichida kalit bo'lsa — butunlay o'raladi
        out[i] = '||' + p + '||';
        changed = true;
      } else {
        out[i] = p;
      }
    }
    return { changed, str: out.join('') };
  };

  let r = run(false);
  if (!r.changed) return text;
  /* Juftlanmagan "||" bizning o'ramlar bilan juftlashib, kalitni ochib yubormasin */
  if (parts.some((p, i) => i % 2 === 0 && p.indexOf('||') !== -1)) r = run(true);
  return r.str;
}

/** Matnda maxfiy ma'lumot bormi (o'ramasdan tekshirish) */
export function hasSecrets(input) {
  const text = input == null ? '' : String(input);
  return text.length >= 6 && protectSecrets(text) !== text;
}

/** Ro'yxat/push/reply preview uchun: ||...|| (yopilmagan bo'lsa ham) → •••• */
export function maskSpoilers(input) {
  const t = input == null ? '' : String(input);
  return t.indexOf('||') === -1 ? t : t.replace(/\|\|[\s\S]*?(?:\|\||$)/g, '••••');
}
