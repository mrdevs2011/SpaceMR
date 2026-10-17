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
 *  - Prefiksli kalitlar (gsk_, sk-, xai- ...) bo'shliq/yangi qator bilan
 *    bo'lingan bo'lsa ham yig'ib o'raladi.
 */

const SEG_RE = /(```[\s\S]*?```|`[^`\n]+`|\|\|[\s\S]*?\|\|)/g;

/* Namuna/placeholder qiymatlar — hujjat va misollarni bekorga yashirmaslik uchun */
const PLACEHOLDER_RE = /^(?:<[^>]*>|\{\{[^}]*\}\}|\$\{?\w+\}?|%\w+%|your[_-]|my[_-]?(?:key|token|secret)|x{3,}$|\*{3,}|•+|\.{3,}|_{3,}|-{3,}|example|changeme|placeholder|dummy|sample|test[_-]?key|null$|undefined$|true$|false$|none$|required$|string$|hidden$|redacted|todo|fixme)/i;

const isPlaceholder = v => PLACEHOLDER_RE.test(String(v || '').trim());

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
  if (!tok || tok.length < 24 || tok.length > 800) return false;
  const t = tok.replace(/=+$/, ''); // base64 padding
  if (t.length < 24) return false;

  // UUID — yashirmaymiz
  const noDash = t.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(noDash) && (t.length === 36 || t.length === 32)) return false;
  // git commit SHA
  if (/^[0-9a-f]{40}$/i.test(t)) return false;
  // oddiy so'z / past entropiya
  if (/(.)\1{9,}/.test(t)) return false;

  const hexOnly = /^[0-9a-f]+$/i.test(t);
  if (hexOnly) {
    // 64+ hex (sha256 secret, webhook secrets ...)
    if (t.length >= 64) return entropy(t) >= 2.8;
    if (t.length >= 32) return entropy(t) >= 3.2;
    return false;
  }

  const hasD = /\d/.test(t), hasL = /[a-z]/.test(t), hasU = /[A-Z]/.test(t);
  const hasSym = /[_+\/=.-]/.test(t);
  if (!hasD || !(hasL || hasU)) return false;

  // base64-ish uzun
  if (/^[A-Za-z0-9+/]+=*$/.test(tok) && t.length >= 40 && entropy(t) >= 3.5) return true;

  if (!((hasL && hasU) || hasSym)) return false;
  // qisqaroq bo'lsa qattiqroq, uzun bo'lsa yumshoqroq
  if (t.length >= 48) return entropy(t) >= 3.4;
  if (t.length >= 32) return entropy(t) >= 3.8;
  return entropy(t) >= 4.0;
}

/* Qiymati oxirgi guruhda bo'lgan naqshlar */
const VAL_CH = '[^\\s"\'`,;|<>(){}\\[\\]]';
const NAME_PRE = '\\b[\\w.-]{0,48}';

const KV = [
  // password family
  { re: new RegExp(NAME_PRE + '(?:passw(?:or)?d|passwd|pwd|parol|пароль)[\\w.-]{0,24}["\']?\\s*[:=]\\s*["\']?(' + VAL_CH + '{4,300})', 'gi'), min: 4 },
  { re: new RegExp('\\b(?:parol|password|пароль)\\s+[-–—]\\s+(' + VAL_CH + '{4,300})', 'gi'), min: 4, needDigitOrSym: true },
  // token / secret / api key family
  { re: new RegExp(NAME_PRE + '(?:api[_-]?key|apikey|secret[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|private[_-]?key|access[_-]?key|auth[_-]?key|signing[_-]?key|service[_-]?role|service[_-]?key|webhook[_-]?secret|bot[_-]?token|app[_-]?secret|auth[_-]?token)[\\w.-]{0,24}["\']?\\s*[:=]\\s*["\']?(' + VAL_CH + '{8,600})', 'gi'), min: 8 },
  // key / kalit — only key-like values
  { re: new RegExp(NAME_PRE + '(?:key|kalit|ключ)[\\w.-]{0,24}["\']?\\s*[:=]\\s*["\']?(' + VAL_CH + '{12,600})', 'gi'), min: 12, needKeyLike: true },
  // ENV style: API_KEY=xxxx
  { re: /\b([A-Z][A-Z0-9_]{2,40}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*["']?([^\s"'`]+)["']?/g, min: 8, group: 2 },
];

/* Prefiksli kalitlar — bo'shliq/yangi qator bilan bo'lingan qismlarni ham yig'adi */
const PREFIXED = [
  // OpenAI / Anthropic / OpenRouter / DeepSeek
  { re: /\b(sk-(?:ant-|proj-|svcacct-|admin-|or-v1-|hs-|live-|test-)?)([A-Za-z0-9_-]{16,})/g, minBody: 16 },
  { re: /\b(sk-[A-Za-z0-9]{20,})/g, minBody: 20 },
  // Google AI Studio / Gemini
  { re: /\b(gsk_)([A-Za-z0-9_-]{16,})/g, minBody: 16 },
  // Google API
  { re: /\b(AIza)([0-9A-Za-z_-]{30,})/g, minBody: 30 },
  // Google OAuth
  { re: /\b(ya29\.)([0-9A-Za-z_-]{16,})/g, minBody: 16 },
  // xAI / Grok
  { re: /\b(xai-)([A-Za-z0-9_-]{16,})/g, minBody: 16 },
  // Groq
  { re: /\b(gsk_)([A-Za-z0-9]{20,})/g, minBody: 20 }, // also used by Groq historically overlapping
  // HuggingFace
  { re: /\b(hf_)([A-Za-z0-9]{20,})/g, minBody: 20 },
  // GitHub
  { re: /\b(gh[pousr]_)([A-Za-z0-9]{20,})/g, minBody: 20 },
  { re: /\b(github_pat_)([A-Za-z0-9_]{20,})/g, minBody: 20 },
  // GitLab
  { re: /\b(glpat-)([A-Za-z0-9_-]{16,})/g, minBody: 16 },
  // Slack
  { re: /\b(xox[abprso]-)([A-Za-z0-9-]{8,})/g, minBody: 8 },
  { re: /\b(xapp-)([A-Za-z0-9-]{10,})/g, minBody: 10 },
  // Stripe
  { re: /\b((?:sk|rk|pk)_(?:live|test)_)([0-9A-Za-z]{16,})/g, minBody: 16 },
  { re: /\b(whsec_)([A-Za-z0-9]{16,})/g, minBody: 16 },
  // Supabase
  { re: /\b(sb_(?:secret|publishable)_)([A-Za-z0-9_-]{12,})/g, minBody: 12 },
  { re: /\b(sbp_)([a-f0-9]{24,})/g, minBody: 24 },
  // npm / DigitalOcean / SendGrid / Twilio-ish
  { re: /\b(npm_)([A-Za-z0-9]{20,})/g, minBody: 20 },
  { re: /\b(dop_v1_)([a-f0-9]{32,})/g, minBody: 32 },
  { re: /\b(SG\.)([A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})/g, minBody: 12 },
  // Cloudflare
  { re: /\b(cfut_)([A-Za-z0-9_-]{20,})/g, minBody: 20 },
  // Vercel
  { re: /\b(vercel_)([A-Za-z0-9_]{20,})/g, minBody: 20 },
  // Notion
  { re: /\b(ntn_|secret_)([A-Za-z0-9]{20,})/g, minBody: 20 },
  // Linear
  { re: /\b(lin_api_)([A-Za-z0-9]{20,})/g, minBody: 20 },
  // Discord bot-ish long tokens handled in WHOLE
  // AWS access key id
  { re: /\b((?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16})\b/g, minBody: 16, whole: true },
  // Telegram bot
  { re: /\b(\d{8,10}:)([A-Za-z0-9_-]{30,})/g, minBody: 30 },
  // Claude/Anthropic console keys sometimes sk-ant-
  // Perplexity / Mistral / Cohere generic high-entropy handled by TOKEN_RE
  // Azure / OpenAI project keys
  { re: /\b(sk-proj-)([A-Za-z0-9_-]{20,})/g, minBody: 20 },
  // Firebase
  { re: /\b(AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{20,})/g, minBody: 20, whole: true },
];

/* Butun match yashiriladigan naqshlar (prefixsiz yoki murakkab) */
const WHOLE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  /-----BEGIN [A-Z ]*CERTIFICATE-----[\s\S]*?(?:-----END [A-Z ]*CERTIFICATE-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  // Discord token
  /\b[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,
  // URL with embedded credentials
  /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@\/?#|]+:[^\s@\/?#|]+@[^\s|]*[^\s.,;:!?)\]}'"|]/gi,
  // mongodb / postgres / redis / mysql connection strings even without user:pass sometimes still sensitive host+creds
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|rediss):\/\/[^\s<>"']+/gi,
  // AWS secret access key (40 base64 after AKIA line often)
];

const BEARER_RE = /\bBearer\s+([A-Za-z0-9._~+\/-]{16,}=*)/gi;

const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
const CARD_PREFIX_RE = /^(?:4|5[1-5]|2[2-7]|3[47]|6011|65|8600|9860|5614|6262|4073)/;

/* Standalone yuqori entropiyali token */
const TOKEN_RE = /(^|[\s"'`(\[{=:,;])([A-Za-z0-9_+\/-]{28,800}={0,3})(?=$|[\s"'`)\]},;.!?\n])/g;

/** Prefiksli kalit: body ichidagi bo'shliq/yangi qatorlarni yutib, bitta range qaytaradi */
function collectPrefixed(text, ranges) {
  for (const p of PREFIXED) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      if (p.whole) {
        ranges.push([m.index, m.index + m[0].length]);
        continue;
      }
      let body, end;
      if (m[2] != null) {
        // prefix + body groups
        body = m[2];
        end = m.index + m[0].length;
      } else {
        // whole match is the key (single group)
        body = m[1] || m[0];
        end = m.index + m[0].length;
      }

      // Keyin kelgan "bo'shliq + kalit-fragment" larni yutish (newline bilan bo'lingan gsk_...)
      // Masalan: gsk_ABC\nDEF  → ABCDEF
      let rest = text.slice(end);
      const fragRe = /^([\s]*)([A-Za-z0-9_\/+-]{8,})/;
      let guard = 0;
      while (guard++ < 6) {
        const fm = fragRe.exec(rest);
        if (!fm) break;
        // faqat qisqa bo'shliq (space/newline/tab), yangi so'z emas
        if (fm[1].length > 3) break;
        // keyingi token oddiy so'zga o'xshasa to'xtat
        if (/^[a-z]{4,}$/i.test(fm[2]) && !/\d/.test(fm[2])) break;
        body += fm[2];
        end += fm[0].length;
        rest = text.slice(end);
        // yangi so'z chegarasi (bo'shliqdan keyin kichik so'z)
        if (/^[\s]{1,2}[a-z]{3,}\b/i.test(rest) && !/\d/.test(rest.slice(0, 20))) break;
      }

      if (body.length < (p.minBody || 16)) continue;
      if (isPlaceholder(body)) continue;
      ranges.push([m.index, end]);
    }
  }
}

function collect(text, ranges) {
  let m;

  for (const re of WHOLE) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      ranges.push([m.index, m.index + m[0].length]);
    }
  }

  collectPrefixed(text, ranges);

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
      const gi = k.group != null ? k.group : 1;
      const v = m[gi];
      if (!v || v.length < k.min || isPlaceholder(v)) continue;
      if (k.needDigitOrSym && !/[\d\W_]/.test(v)) continue;
      if (k.needKeyLike && !(looksLikeKey(v) || (/\d/.test(v) && /[A-Za-z]/.test(v) && entropy(v) >= 3.0))) continue;
      // qiymat match oxirida
      const end = m.index + m[0].length;
      const start = end - v.length;
      // agar qiymat qo'shtirnoq ichida bo'lsa start/end to'g'ri keladi
      ranges.push([Math.max(m.index, start), end]);
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
    // allaqachon prefiks bilan ushlangan bo'lsa qayta qo'shmaymiz (merge qiladi)
    const start = m.index + m[1].length;
    ranges.push([start, start + tok.length]);
  }
}

function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out = [];
  for (const r of ranges) {
    if (r[0] >= r[1]) continue;
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

  const parts = text.split(SEG_RE);

  const run = (escapeStray) => {
    let changed = false;
    const out = new Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i % 2 === 0) {
        const src = escapeStray ? p.replace(/\|\|/g, '|\u200B|') : p;
        const [np, hit] = protectPlain(src);
        if (hit) changed = true;
        out[i] = np;
      } else if (p.startsWith('||')) {
        out[i] = p;
      } else if (hasSecretIn(p)) {
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

/**
 * Yuborishdan oldin: ||matn|| → ||@N:len|| (DB/API/Realtime da maxfiy yo'q).
 * secrets massivi store_message_secrets RPC ga ketadi.
 * Kod bloki / inline `...` ichidagi || tegilmaydi.
 */
export function redactSpoilersForStorage(input) {
  const text = input == null ? '' : String(input);
  if (text.indexOf('||') === -1) return { text, secrets: [] };
  const secrets = [];
  const parts = text.split(SEG_RE);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue;
    parts[i] = parts[i].replace(/\|\|([\s\S]*?)\|\|/g, (_m, inner) => {
      if (secrets.length >= 32) return '••••';
      const body = String(inner);
      if (!body.length || body.length > 8000) return '••••';
      const ord = secrets.length;
      secrets.push(body);
      const ch = Array.from(body).length;
      return '||@' + ord + ':' + ch + '||';
    });
  }
  for (let i = 1; i < parts.length; i += 2) {
    const seg = parts[i];
    if (seg && seg.startsWith('||') && seg.endsWith('||') && seg.length >= 4) {
      const inner = seg.slice(2, -2);
      if (inner.startsWith('@') && /^@\d+:\d+$/.test(inner)) continue;
      if (secrets.length >= 32) { parts[i] = '••••'; continue; }
      if (!inner.length || inner.length > 8000) { parts[i] = '••••'; continue; }
      const ord = secrets.length;
      secrets.push(inner);
      parts[i] = '||@' + ord + ':' + Array.from(inner).length + '||';
    }
  }
  return { text: parts.join(''), secrets };
}

/** Marker bormi: ||@0:12|| */
export function hasSpoilerMarkers(input) {
  return /\|\|@\d+:\d+\|\|/.test(String(input || ''));
}
