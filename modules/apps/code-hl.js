/**
 * code-hl.js — HTML (ichida CSS va JS) uchun yengil sintaksis bo'yash, kutubxonasiz.
 * highlight(src) → xavfsiz HTML (span.hl-*). Matn uzunligi/belgilar o'zgarmaydi,
 * shuning uchun textarea ustiga/ostiga qo'yib ishlatsa bo'ladi.
 */
const E = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const w = (c, s) => (s === '' ? '' : `<span class="hl-${c}">${E(s)}</span>`);

function scan(src, re, fn) {
  let out = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out += E(src.slice(last, m.index));
    out += fn(m);
    last = re.lastIndex;
    if (m[0] === '') re.lastIndex++;
  }
  return out + E(src.slice(last));
}

/* ── JS ── */
const JS_KW = new Set(('const let var function return if else for while do switch case break continue new this class extends ' +
  'import export from default async await try catch finally throw typeof instanceof in of delete void yield static super ' +
  'null undefined true false').split(' '));
const JS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(\b0x[\da-f]+\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/gi;
const hlJs = src => scan(src, JS_RE, m =>
  m[1] ? w('c', m[0]) : m[2] ? w('s', m[0]) : m[3] ? w('n', m[0]) :
  m[4] ? (JS_KW.has(m[4]) ? w('k', m[4]) : w('f', m[4])) :
  (JS_KW.has(m[5]) ? w('k', m[5]) : E(m[5])));

/* ── CSS ── */
const CSS_CONT = /^@(media|supports|layer|container|(-webkit-)?keyframes|document)/i;
const CSS_VAL_RE = /(#[0-9a-f]{3,8}\b)|(\b\d+(?:\.\d+)?(?:[a-z]+|%)?)|(!important)|([\w-]+)(?=\()/gi;
const cssVal = t => scan(t, CSS_VAL_RE, m => m[1] || m[2] ? w('n', m[0]) : m[3] ? w('k', m[0]) : w('f', m[0]));
function hlCss(src) {
  const stack = [];           // true = ichida qoidalar (@media...), false = deklaratsiyalar
  let prelude = '', inValue = false;
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|([{};])|([^{};"'\/]+|\/)/g;
  return scan(src, re, m => {
    if (m[1]) return w('c', m[0]);
    if (m[2]) return w('s', m[0]);
    if (m[3]) {
      if (m[3] === '{') stack.push(CSS_CONT.test(prelude.trim()));
      else if (m[3] === '}') stack.pop();
      prelude = ''; inValue = false;
      return E(m[3]);
    }
    const t = m[4];
    const decl = stack.length && !stack[stack.length - 1];
    if (decl) {
      if (inValue) return cssVal(t);
      const i = t.indexOf(':');
      if (i < 0) return w('a', t);
      inValue = true;
      return w('a', t.slice(0, i)) + ':' + cssVal(t.slice(i + 1));
    }
    prelude += t;
    const at = /^(\s*)(@[\w-]+)([\s\S]*)$/.exec(t);
    return at ? E(at[1]) + w('k', at[2]) + E(at[3]) : w('sel', t);
  });
}

/* ── HTML ── */
const TAG_RE = /(<!--[\s\S]*?(?:-->|$))|(<!doctype[^>]*>?)|(<\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(>?)/gi;
const ATTR_RE = /("[^"]*"?|'[^']*'?)|([^\s="'\/]+)/g;
const attrs = s => scan(s, ATTR_RE, m => (m[1] ? w('s', m[1]) : w('a', m[2])));

export function highlight(src) {
  const lower = src.toLowerCase();
  const re = new RegExp(TAG_RE.source, 'gi');
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += E(src.slice(last, m.index));
    if (m[1]) out += w('c', m[1]);
    else if (m[2]) out += w('d', m[2]);
    else {
      const name = m[4].toLowerCase();
      out += w('p', m[3]) + w('t', m[4]) + attrs(m[5]) + w('p', m[6]);
      if (m[3] === '<' && m[6] && (name === 'script' || name === 'style')) {
        const end = lower.indexOf('</' + name, re.lastIndex);
        const stop = end < 0 ? src.length : end;
        const body = src.slice(re.lastIndex, stop);
        out += name === 'style' ? hlCss(body)
          : /type\s*=\s*["']?(?:application\/(?:ld\+)?json|importmap)/i.test(m[5]) ? E(body) : hlJs(body);
        re.lastIndex = stop;
      }
    }
    last = re.lastIndex;
    if (m[0] === '') re.lastIndex++;
  }
  return out + E(src.slice(last));
}
