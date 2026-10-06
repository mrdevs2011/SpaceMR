/**
 * Ilova logosini HTML kodning o'zidan aqlli aniqlaydi (fayl yuklash yo'q).
 * Nomzodlar (ball bo'yicha): favicon / apple-touch-icon (data:) > logotip SVG (header, "logo/brand" klass) >
 * og:image (data:) > logotip <img> > sarlavhadagi emoji > mavzu rangi + bosh harf > boshqa SVG.
 * Har nomzod xavfsiz tozalanadi (script, on-atributlar, tashqi havola yo'q), haqiqatan chizilishi tekshiriladi
 * (bo'sh/ko'rinmas bo'lsa keyingisiga o'tadi), qora-shaffof bo'lsa och fon qo'yiladi,
 * hajm DB cheklovi ichiga tushiriladi. Natija: { logo: 'data:image/...;base64,...', source } yoki null.
 * DOMParser inert hujjat yaratadi — kod bajarilmaydi, rasm/tarmoq so'rovi ketmaydi.
 */
const S = 128;
const MAX_SVG = 60 * 1024;          // SVG matni
const MAX_URL = 118000;             // DB: char_length(logo) <= 120000
const SVGNS = 'http://www.w3.org/2000/svg';
const LIGHT = '#e7e9ea';
const OK_URL = /^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/;

const b64 = txt => btoa(unescape(encodeURIComponent(txt)));
const svgUrl = txt => 'data:image/svg+xml;base64,' + b64(txt);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── data: URL ni ochish ─────────────────────────────────────────────── */
function parseDataUrl(u) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i.exec(String(u).trim());
  if (!m) return null;
  const mime = (m[1] || 'text/plain').toLowerCase(), isB64 = /;base64/i.test(m[2]);
  let body = m[3];
  if (!/svg|^text\//.test(mime)) return { mime, isB64, body: '', raw: m[3] };   // raster: baytlarni matn sifatida ochmaymiz
  try {
    if (isB64) body = decodeURIComponent(escape(atob(body.replace(/\s+/g, ''))));
    else { try { body = decodeURIComponent(body); } catch (_) { /* xom holda qoldiramiz */ } }
  } catch (_) { return null; }
  return { mime, isB64, body, raw: m[3] };
}

/* ── Sahifadagi CSS o'zgaruvchilar (var(--x) ni hal qilish uchun) ────── */
function cssVars(doc) {
  const vars = {};
  const css = [...doc.querySelectorAll('style')].map(s => s.textContent || '').join('\n');
  css.replace(/(--[\w-]+)\s*:\s*([^;}\n]+)/g, (m, k, v) => { if (!(k in vars)) vars[k] = v.trim(); return m; });
  return vars;
}
const resolveVars = (str, vars) => str
  .replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (m, k, fb) => vars[k] || (fb ? fb.trim() : '#888888'))
  .replace(/currentColor/gi, LIGHT);

/* ── SVG ni xavfsiz tozalash ─────────────────────────────────────────── */
function cleanSvg(src, vars) {
  const root = src.cloneNode(true);
  const BAD = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video']);
  const list = [root, ...root.querySelectorAll('*')];
  let hasPaint = false, usesClass = false;
  for (const e of list) {
    if (!e.parentNode && e !== root) continue;
    const tag = (e.localName || '').toLowerCase();
    if (e !== root && BAD.has(tag)) { e.remove(); continue; }
    if (tag === 'style') {
      if (/@import|url\(\s*['"]?\s*(?!#|data:)/i.test(e.textContent || '')) { e.remove(); continue; }
      hasPaint = true;
    }
    if (tag === 'use' && !/^#/.test(e.getAttribute('href') || e.getAttribute('xlink:href') || '')) { e.remove(); continue; }
    for (const at of Array.from(e.attributes)) {
      const n = at.name.toLowerCase(), v = at.value.trim();
      if (n.startsWith('on')) { e.removeAttribute(at.name); continue; }
      if (n === 'href' || n === 'xlink:href') {
        if (!(v.startsWith('#') || /^data:image\/(png|jpe?g|webp|gif)/i.test(v))) {
          e.removeAttribute(at.name);
          if (tag === 'image' || tag === 'use') e.remove();
        }
        continue;
      }
      if (n === 'style' && /url\(\s*['"]?\s*(?!#)/i.test(v)) { e.removeAttribute(at.name); continue; }
      if (n === 'class') usesClass = true;
      if (n === 'fill' || n === 'stroke' || n === 'style') hasPaint = true;
    }
  }
  if (root.querySelector('use')) return null;          // sahifadagi <symbol> ga tayanadi — mustaqil emas
  if (usesClass && !hasPaint) return null;             // rangi sahifa CSS'ida — alohida chizilmaydi
  let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(n => !isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
    if (!(w > 0 && h > 0) || /%/.test(root.getAttribute('width') || '')) return null;
    vb = [0, 0, w, h];
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  const ar = vb[2] / vb[3];
  if (ar < 0.4 || ar > 2.5) return null;               // logotipga o'xshamaydi (uzun chiziq/banner)
  root.setAttribute('width', S); root.setAttribute('height', S);
  root.setAttribute('xmlns', SVGNS);
  root.removeAttribute('class'); root.removeAttribute('style'); root.removeAttribute('id');
  let out;
  try { out = new XMLSerializer().serializeToString(root); } catch (_) { return null; }
  return { svg: resolveVars(out, vars), vb };
}

/* ── Rasterlash va tekshirish ────────────────────────────────────────── */
function loadImage(url) {
  return new Promise(res => {
    const i = new Image(); let done = false;
    const fin = v => { if (!done) { done = true; res(v); } };
    i.onload = () => fin(i); i.onerror = () => fin(null);
    setTimeout(() => fin(null), 3000);
    i.src = url;
  });
}
function roundRectPath(x, ctx, w, r) {
  if (x.roundRect) { x.beginPath(); x.roundRect(0, 0, w, w, r); return; }
  x.beginPath(); x.moveTo(r, 0); x.arcTo(w, 0, w, w, r); x.arcTo(w, w, 0, w, r); x.arcTo(0, w, 0, 0, r); x.arcTo(0, 0, w, 0, r); x.closePath();
}
async function rasterize(url, bg) {
  const img = await loadImage(url);
  if (!img) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d');
  let pad = 0;
  if (bg) { roundRectPath(x, null, S, S * 0.22); x.fillStyle = bg; x.fill(); pad = S * 0.14; }
  const iw = img.naturalWidth || S, ih = img.naturalHeight || S, box = S - pad * 2, k = Math.min(box / iw, box / ih);
  x.drawImage(img, (S - iw * k) / 2, (S - ih * k) / 2, iw * k, ih * k);
  return cv;
}
function analyze(cv) {
  try {
    const d = cv.getContext('2d').getImageData(0, 0, S, S).data;
    let n = 0, op = 0, l = 0;
    for (let i = 0; i < d.length; i += 4) {
      n++;
      const a = d[i + 3];
      if (a > 24) { op++; l += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255 * (a / 255); }
    }
    return { cover: op / n, lum: op ? l / op : 0 };
  } catch (_) { return null; }
}
function pngUrl(cv) {
  let out = cv.toDataURL('image/png');
  if (out.length > 110000) out = cv.toDataURL('image/jpeg', 0.85);
  return out;
}
const withBg = (svg, vb) =>
  svg.replace(/<svg\b[^>]*>/, m => m + `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" rx="${(vb[2] * 0.22).toFixed(2)}" fill="${LIGHT}"/>`);

/** Nomzodni tayyor logo URL ga aylantiradi; yaroqsiz/ko'rinmas bo'lsa null */
async function build(c, vars) {
  /* 1) tayyor SVG matni (emoji / harf logosi) */
  if (c.svgText) { const u = svgUrl(c.svgText); return OK_URL.test(u) && u.length <= MAX_URL ? u : null; }

  /* 2) SVG element yoki SVG data: URL */
  let svgEl = c.el || null;
  let dataSvg = null;
  if (c.url) {
    const p = parseDataUrl(c.url);
    if (!p) return null;
    if (p.mime === 'image/svg+xml') {
      let doc = new DOMParser().parseFromString(p.body, 'image/svg+xml');
      svgEl = doc.querySelector('parsererror') ? null : doc.documentElement;
      if (!svgEl || svgEl.localName.toLowerCase() !== 'svg') {
        doc = new DOMParser().parseFromString(p.body, 'text/html');
        svgEl = doc.querySelector('svg');
      }
      if (!svgEl) return null;
    } else if (/^image\/(png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon)$/.test(p.mime)) {
      dataSvg = null;
    } else return null;
  }

  if (svgEl) {
    const r = cleanSvg(svgEl, c.vars || vars);
    if (!r) return null;
    let { svg } = r;
    const url0 = svgUrl(svg);
    let cv = await rasterize(url0);
    if (!cv) return null;
    const st = analyze(cv);
    if (st && st.cover < 0.03) return null;                       // ko'rinmaydi
    if (st && st.cover < 0.92 && st.lum < 0.14) svg = withBg(svg, r.vb);   // qora/shaffof — och fon
    if (svg.length <= MAX_SVG) { const u = svgUrl(svg); if (u.length <= MAX_URL) return u; }
    cv = await rasterize(svgUrl(svg));
    return cv ? pngUrl(cv) : null;
  }

  /* 3) raster (png/jpg/webp/gif/ico) */
  let cv = await rasterize(c.url);
  if (!cv) return null;
  const st = analyze(cv);
  if (st && st.cover < 0.03) return null;
  if (st && st.cover < 0.92 && st.lum < 0.14) cv = (await rasterize(c.url, LIGHT)) || cv;
  return pngUrl(cv);
}

/* ── Nomzodlarni yig'ish ─────────────────────────────────────────────── */
const HINT = /logo|brand|emblem|app-?icon|mark\b/i;
const hintOf = el => HINT.test([el.getAttribute('class'), el.id, el.getAttribute('aria-label'), el.getAttribute('alt'), el.getAttribute('title')].filter(Boolean).join(' '));
const EMOJI = /^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/u;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function lumHex(h) {
  let s = h.slice(1); if (s.length === 3) s = s.split('').map(ch => ch + ch).join('');
  const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/* ── Matnli logotip: <div class="app-logo-icon">FX</div> ──
   Rasm yo'q — qisqa matn + CSS fon (rang/gradient) bilan chizilgan. Fon va rang sahifa CSS'idan olinadi. */
const COLOR_TOK = /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/gi;
const BAD_NAME = /^(none|transparent|inherit|initial|unset|currentcolor|auto)$/i;
const colorOf = s => {
  const t = String(s || '').trim();
  const m = t.match(COLOR_TOK);
  if (m) return m[0];
  return /^[a-z]{3,20}$/i.test(t) && !BAD_NAME.test(t) ? t : null;
};
function cssProps(doc, el, vars) {
  const css = [...doc.querySelectorAll('style')].map(s => s.textContent || '').join('\n').replace(/@import[^;]*;/gi, '');
  let rules = [];
  try { const sh = new CSSStyleSheet(); sh.replaceSync(css); rules = [...sh.cssRules]; }
  catch (_) { try { rules = [...doc.styleSheets].flatMap(s => [...s.cssRules]); } catch (__) { rules = []; } }
  const p = {};
  const take = st => {
    const bi = st.getPropertyValue('background-image');
    const bg = st.getPropertyValue('background') || (bi && bi !== 'none' ? bi : '') || st.getPropertyValue('background-color');
    if (bg) p.bg = bg;
    for (const k of ['color', 'border-radius', 'width', 'font-weight']) { const v = st.getPropertyValue(k); if (v) p[k] = v; }
  };
  for (const r of rules) {
    if (!r.selectorText || !r.style) continue;
    let hit = false;
    try { hit = el.matches(r.selectorText); } catch (_) { hit = false; }
    if (hit) take(r.style);
  }
  if (el.style) take(el.style);
  return p;
}
function textLogo(doc, vars) {
  for (const el of doc.querySelectorAll('[class],[id]')) {
    if (el.children.length || !hintOf(el)) continue;
    const chars = [...(el.textContent || '').trim()];
    if (!chars.length || chars.length > 3) continue;
    const p = cssProps(doc, el, vars);
    if (!p.bg) continue;
    const bg = resolveVars(p.bg, vars);
    let cols = bg.match(COLOR_TOK) || [];
    if (!cols.length) { const one = colorOf(bg); if (one) cols = [one]; }
    if (!cols.length) continue;
    /* gradient yo'nalishi (CSS burchagi: 0 = tepaga, 90 = o'ngga) */
    let ang = 180;
    const am = /(-?[\d.]+)deg/.exec(bg), to = /to\s+((?:top|bottom|left|right)(?:\s+(?:top|bottom|left|right))?)/i.exec(bg);
    if (am) ang = +am[1];
    else if (to) {
      const w = new Set(to[1].toLowerCase().split(/\s+/));
      ang = w.has('top') ? (w.has('right') ? 45 : w.has('left') ? 315 : 0) : w.has('bottom') ? (w.has('right') ? 135 : w.has('left') ? 225 : 180) : w.has('right') ? 90 : 270;
    }
    const rad = ang * Math.PI / 180, sx = Math.sin(rad), sy = -Math.cos(rad);
    const defs = cols.length > 1
      ? `<defs><linearGradient id="g" x1="${(0.5 - sx / 2).toFixed(3)}" y1="${(0.5 - sy / 2).toFixed(3)}" x2="${(0.5 + sx / 2).toFixed(3)}" y2="${(0.5 + sy / 2).toFixed(3)}">${cols.map((c, i) => `<stop offset="${(i / (cols.length - 1)).toFixed(3)}" stop-color="${esc(c)}"/>`).join('')}</linearGradient></defs>`
      : '';
    const fill = cols.length > 1 ? 'url(#g)' : esc(cols[0]);
    /* burchak radiusi: element kengligiga nisbatan */
    let rx = 28;
    const bw = /px/.test(p.width || '') ? parseFloat(p.width) : 0, br = parseFloat(p['border-radius']);
    if (/%/.test(p['border-radius'] || '')) rx = Math.min(64, br / 100 * S);
    else if (bw > 0 && br >= 0) rx = Math.min(64, br / bw * S);
    const fg = colorOf(resolveVars(p.color || '', vars)) || (HEX.test(cols[0]) && lumHex(cols[0]) > 0.6 ? '#000000' : '#ffffff');
    const fs = [0, 70, 58, 44][chars.length], fw = parseInt(p['font-weight'], 10) >= 600 || p['font-weight'] === 'bold' ? 800 : 700;
    return `<svg xmlns="${SVGNS}" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${defs}<rect width="${S}" height="${S}" rx="${rx.toFixed(1)}" fill="${fill}"/><text x="64" y="68" font-size="${fs}" font-weight="${fw}" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" text-anchor="middle" dominant-baseline="central" fill="${esc(fg)}">${esc(chars.join(''))}</text></svg>`;
  }
  return null;
}

function collect(doc, name, vars) {
  const out = []; let order = 0;
  const push = (score, source, c) => out.push({ score: score - order++ * 0.001, source, ...c });

  doc.querySelectorAll('link[rel]').forEach(l => {
    const rel = (l.getAttribute('rel') || '').toLowerCase().split(/\s+/), href = (l.getAttribute('href') || '').trim();
    if (!/^data:image\//i.test(href)) return;
    if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) push(95, 'apple-touch-icon', { url: href });
    else if (rel.includes('icon')) push(100, 'favicon', { url: href });
    else if (rel.includes('mask-icon')) push(60, 'mask-icon', { url: href });
  });

  doc.querySelectorAll('svg').forEach(el => {
    if (el.parentElement && el.parentElement.closest('svg')) return;                       // ichki svg
    if (!el.querySelector('path,circle,rect,ellipse,polygon,polyline,line,text,image,g,use')) return;
    const own = hintOf(el), nested = !!el.closest('[class*="logo" i],[id*="logo" i],[class*="brand" i],[id*="brand" i]');
    const inHead = !!el.closest('header,nav'), inBtn = !!el.closest('button,[role=button],summary');
    let score = own ? 88 : nested ? 84 : inHead ? 66 : inBtn ? 12 : 30;
    push(score, own || nested ? 'logotip SVG' : 'SVG rasm', { el, vars });
  });

  const tl = textLogo(doc, vars);
  if (tl) push(86, 'matnli logotip', { svgText: tl });

  let imgN = 0;
  doc.querySelectorAll('img[src^="data:image"]').forEach(el => {
    const src = (el.getAttribute('src') || '').trim();
    const h = hintOf(el) || !!el.closest('[class*="logo" i],[id*="logo" i],[class*="brand" i]');
    if (!h && imgN >= 2) return;
    imgN++;
    push(h ? 82 : el.closest('header,nav') ? 64 : 26, 'rasm', { url: src });
  });

  doc.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]').forEach(m => {
    const c = (m.getAttribute('content') || '').trim();
    if (/^data:image\//i.test(c)) push(70, 'og:image', { url: c });
  });

  const titleTxt = (doc.title || '').trim(), h1 = (doc.querySelector('h1')?.textContent || '').trim();
  const em = EMOJI.exec(titleTxt) || EMOJI.exec(h1);
  if (em) {
    push(56, 'emoji', { svgText: `<svg xmlns="${SVGNS}" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="28" fill="#202327"/><text x="64" y="68" font-size="72" text-anchor="middle" dominant-baseline="central">${esc(em[1])}</text></svg>` });
  }

  const theme = [doc.querySelector('meta[name="theme-color"]')?.getAttribute('content'), vars['--primary'], vars['--accent'], vars['--brand'], vars['--color-primary']]
    .map(v => (v || '').trim()).find(v => HEX.test(v));
  const letter = (name || doc.title || '').trim().charAt(0).toUpperCase();
  if (theme && letter) {
    const fg = lumHex(theme) > 0.6 ? '#000000' : '#ffffff';
    push(45, 'rang va bosh harf', { svgText: `<svg xmlns="${SVGNS}" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="28" fill="${theme}"/><text x="64" y="68" font-size="68" font-weight="700" font-family="system-ui,sans-serif" text-anchor="middle" dominant-baseline="central" fill="${fg}">${esc(letter)}</text></svg>` });
  }
  return out;
}

/** HTML koddan eng yaxshi logoni topadi. @returns {Promise<{logo:string, source:string}|null>} */
export async function extractLogo(html, name = '') {
  try {
    const txt = String(html || '');
    if (!txt.trim()) return null;
    const doc = new DOMParser().parseFromString(txt, 'text/html');
    const vars = cssVars(doc);
    const cands = collect(doc, name, vars).sort((a, b) => b.score - a.score).slice(0, 8);
    for (const c of cands) {
      let u = null;
      try { u = await build(c, vars); } catch (_) { u = null; }
      if (u && OK_URL.test(u) && u.length <= MAX_URL) return { logo: u, source: c.source };
    }
  } catch (_) { /* jim: logo ixtiyoriy */ }
  return null;
}
