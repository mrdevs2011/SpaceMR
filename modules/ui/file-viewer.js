/**
 * file-viewer.js — fayllarni SpaceMR ichida ochadi (apps runner kabi to'liq ekran + header).
 *
 * Ishlatish:
 *   - HTML'da konteynerga data-fv-url / data-fv-name / data-fv-mime / data-fv-size qo'ying —
 *     bosilganda fayl ochiladi, ichidagi .cfm-dl / .file-dl / .cm-dl / .fv-dlbtn (SVG ikonka) bosilsa yuklanadi.
 *   - yoki openFileViewer({ url, name, mime, size }).
 *
 * Qo'llab-quvvatlanadi: matn va kod (rangli, qator raqamlari bilan), CSV/TSV (jadval), rasm, video, audio, PDF.
 * Boshqa turlar: matn ekani aniqlansa matn sifatida, bo'lmasa "yuklab oling" oynasi.
 */
import { esc, fmtSz, dlFile } from '../core/utils.js';
import { fileIconSvg } from '../core/file-icons.js';
import { toast } from './toast.js';
import { onEsc } from './esc-stack.js';
import { highlight as hlHtml, hlJs, hlCss } from '../apps/code-hl.js';

const Z = 1650;
const MAX_TEXT = 2 * 1024 * 1024;   // ko'rsatiladigan matn chegarasi
const MAX_HL = 400000;              // shundan katta matn rangsiz ko'rsatiladi (tez bo'lishi uchun)
const MAX_ROWS = 3000;

const CHEV = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const DL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
const COPY = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>';
const WRAP = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4m0 0 2-2m-2 2 2 2M4 18h5"/></svg>';

/* ── Tur aniqlash ───────────────────────────────────────────────────── */
const extOf = s => {
  const n = String(s || '').split(/[?#]/)[0];
  const i = n.lastIndexOf('.');
  return i < 0 ? (/^(dockerfile|makefile)$/i.test(n.split('/').pop()) ? n.split('/').pop().toLowerCase() : '') : n.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
};
const set = s => new Set(typeof s === 'string' ? s.split(' ') : (Array.isArray(s) ? s : []));
const IMG = set('jpg jpeg png gif webp avif bmp svg ico');
const VID = set('mp4 webm mov mkv avi m4v ogv');
const AUD = set('mp3 wav ogg aac flac m4a opus oga weba');
const LANG = {};
const put = (fam, list) => list.split(' ').forEach(e => { LANG[e] = fam; });
put('js', 'js mjs cjs jsx ts tsx json jsonc json5 map');
put('css', 'css scss sass less');
put('html', 'html htm xml xhtml vue svelte rss atom xsl plist');
put('c', 'c h cpp cc cxx hpp hh java kt kts go rs cs php swift dart scala groovy gradle m mm proto glsl');
put('hash', 'py pyw rb sh bash zsh fish yml yaml toml ini cfg conf env properties dockerfile makefile mk r pl pm ps1 gitignore editorconfig tf cmake');
put('sql', 'sql lua hs elm vhdl');
put('md', 'md markdown mdx');
const PLAIN = set('txt log rst tex srt vtt text nfo diff patch');

function kindOf(name, mime) {
  const e = extOf(name), m = String(mime || '').toLowerCase();
  if (IMG.has(e) || m.startsWith('image/')) return 'image';
  if (VID.has(e) || m.startsWith('video/')) return 'video';
  if (AUD.has(e) || m.startsWith('audio/')) return 'audio';
  if (e === 'pdf' || m === 'application/pdf') return 'pdf';
  if (e === 'csv' || e === 'tsv' || m === 'text/csv') return 'table';
  if (LANG[e] || PLAIN.has(e) || m.startsWith('text/') || m === 'application/json') return 'text';
  return 'unknown';
}

/* ── Sintaksis bo'yash (kutubxonasiz) ───────────────────────────────── */
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
const KW = set('if else elif for while do switch case break continue return def class function fn func let var const val mut pub struct enum impl trait interface type ' +
  'import from export package use using namespace new delete this self super null nil none true false try catch except finally throw throws raise with as in is not and or ' +
  'lambda yield async await static final public private protected void int float double char bool boolean string long short unsigned extern typedef sizeof ' +
  'select insert update create drop alter table into values where join left right inner outer on group by order limit having distinct union set primary key foreign references default ' +
  'echo fi then done esac local readonly begin end unless module require defer go chan map range fallthrough goto match when override abstract virtual operator template typename volatile');
const RE_C = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(\b0x[\da-f]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/gi;
const RE_H = /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|(\b0x[\da-f]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_][\w-]*)/gi;
const RE_S = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:''|[^'])*'?|"(?:\\[\s\S]|[^"\\\n])*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/gi;
const hlGeneric = (src, re) => scan(src, new RegExp(re.source, 'gi'), m =>
  m[1] ? w('c', m[0]) : m[2] ? w('s', m[0]) : m[3] ? w('n', m[0]) :
  m[4] ? (KW.has(m[4].toLowerCase()) ? w('k', m[4]) : w('f', m[4])) :
  (KW.has(m[5].toLowerCase()) ? w('k', m[5]) : E(m[5])));
function hlMd(src) {
  let fence = false;
  return src.split('\n').map(l => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return w('c', l); }
    if (fence) return w('s', l);
    if (/^#{1,6}\s/.test(l)) return w('k', l);
    if (/^>/.test(l)) return w('c', l);
    if (/^\s*([-*+]|\d+[.)])\s/.test(l)) return E(l).replace(/^(\s*)([-*+]|\d+[.)])/, '$1<span class="hl-n">$2</span>');
    return E(l);
  }).join('\n');
}
function highlightText(src, ext) {
  const fam = LANG[ext];
  if (!fam || src.length > MAX_HL) return E(src);
  try {
    if (fam === 'js') return hlJs(src);
    if (fam === 'css') return hlCss(src);
    if (fam === 'html') return hlHtml(src);
    if (fam === 'md') return hlMd(src);
    if (fam === 'hash') return hlGeneric(src, RE_H);
    if (fam === 'sql') return hlGeneric(src, RE_S);
    return hlGeneric(src, RE_C);
  } catch (_) { return E(src); }
}

/* ── CSV ────────────────────────────────────────────────────────────── */
function parseCsv(text, delim) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
      if (rows.length > MAX_ROWS) return { rows, cut: true };
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return { rows, cut: false };
}
function tableHtml(text, ext) {
  const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : 2000);
  const cnt = ch => first.split(ch).length - 1;
  const delim = ext === 'tsv' ? '\t' : [[',', cnt(',')], [';', cnt(';')], ['\t', cnt('\t')]].sort((a, b) => b[1] - a[1])[0][0];
  const { rows, cut } = parseCsv(text, delim);
  if (!rows.length) return '';
  const cols = Math.min(100, Math.max(...rows.map(r => r.length)));
  const cell = (t, v) => `<${t}>${esc(v || '')}</${t}>`;
  const head = rows[0].slice(0, cols);
  const thead = `<thead><tr><th class="fv-rn"></th>${Array.from({ length: cols }, (_, i) => cell('th', head[i])).join('')}</tr></thead>`;
  const tbody = rows.slice(1).map((r, i) => `<tr><td class="fv-rn">${i + 1}</td>${Array.from({ length: cols }, (_, j) => cell('td', r[j])).join('')}</tr>`).join('');
  return `<div class="fv-tablewrap">${cut ? `<div class="fv-cut">Birinchi ${MAX_ROWS} qator ko'rsatildi.</div>` : ''}<table class="fv-table">${thead}<tbody>${tbody}</tbody></table></div>`;
}

/* ── Fayl o'qish (chegarali) ────────────────────────────────────────── */
async function readLimited(res, max) {
  if (!res.body || !res.body.getReader) {
    const b = await res.blob();
    return { buf: await b.slice(0, max).arrayBuffer(), cut: b.size > max };
  }
  const r = res.body.getReader(); const chunks = []; let n = 0, cut = false;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value); n += value.length;
    if (n > max) { cut = true; try { r.cancel(); } catch (_) {} break; }
  }
  const out = new Uint8Array(Math.min(n, max)); let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - o);
    out.set(c.subarray(0, take), o); o += take;
    if (o >= out.length) break;
  }
  return { buf: out.buffer, cut };
}
const looksBinary = u8 => {
  const n = Math.min(u8.length, 8000);
  let bad = 0;
  for (let i = 0; i < n; i++) { const c = u8[i]; if (c === 0) return true; if (c < 7 || (c > 13 && c < 32 && c !== 27)) bad++; }
  return n > 0 && bad / n > 0.1;
};

/* ── Oyna ───────────────────────────────────────────────────────────── */
let cur = null;
onEsc(Z, () => { if (!cur) return false; cur.close(); return true; });

export function closeFileViewer() { if (cur) cur.close(); }

export function openFileViewer(f = {}) {
  closeFileViewer();
  const url = f.url;
  if (!url) return;
  let name = f.name;
  if (!name) { try { name = decodeURIComponent(String(url).split('?')[0].split('/').pop() || ''); } catch (_) { name = ''; } }
  name = name || 'file';
  const mime = f.mime || '';
  const ext = extOf(name);
  let kind = kindOf(name, mime);
  const size = +f.size || 0;
  const sub = [(ext || 'FILE').toUpperCase(), size ? fmtSz(size) : ''].filter(Boolean).join(' · ');

  const el = document.createElement('div');
  el.className = 'fv';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', name);
  el.innerHTML = `<div class="fv-bar">
      <button type="button" class="fv-ib" data-fv="close" aria-label="Orqaga" title="Orqaga">${CHEV}</button>
      <span class="fv-ico">${fileIconSvg(name, mime, 34)}</span>
      <div class="fv-title"><b>${esc(name)}</b><small>${esc(sub)}</small></div>
      <span class="fv-tools"></span>
      <button type="button" class="fv-ib" data-fv="dl" aria-label="Yuklab olish" title="Yuklab olish">${DL}</button>
    </div>
    <div class="fv-body"><div class="fv-load"><div class="spinner"></div></div></div>`;
  const body = el.querySelector('.fv-body');
  const tools = el.querySelector('.fv-tools');
  const ac = new AbortController();
  let blobUrl = null, rawText = '';

  const close = () => {
    ac.abort();
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
    el.remove();
    if (cur && cur.el === el) cur = null;
  };
  cur = { el, close };

  const msg = text => {
    body.innerHTML = `<div class="fv-msg"><div class="fv-msg-ico">${fileIconSvg(name, mime, 76)}</div><b>${esc(name)}</b><span>${esc(text)}</span><button type="button" class="fv-big-dl" data-fv="dl">${DL}<span>Yuklab olish</span></button></div>`;
  };

  const paintText = (txt, cut) => {
    rawText = txt;
    const n = txt.split('\n').length;
    const gut = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    let wrap = false;
    try { wrap = localStorage.getItem('fv_wrap') === '1'; } catch (_) {}
    body.innerHTML = `<div class="fv-code${wrap ? ' fv-wrap' : ''}" tabindex="0">${cut ? '<div class="fv-cut">Katta fayl — faqat boshi ko\'rsatildi. To\'liq ko\'rish uchun yuklab oling.</div>' : ''}<div class="fv-cols"><pre class="fv-ln" aria-hidden="true">${gut}</pre><pre class="fv-pre"><code>${highlightText(txt, ext)}</code></pre></div></div>`;
    tools.innerHTML = `<button type="button" class="fv-ib${wrap ? ' on' : ''}" data-fv="wrap" aria-label="Qatorlarni o'rash" title="Qatorlarni o'rash">${WRAP}</button>
      <button type="button" class="fv-ib" data-fv="copy" aria-label="Nusxalash" title="Nusxalash">${COPY}</button>`;
  };

  el.addEventListener('click', e => {
    const b = e.target.closest?.('[data-fv]');
    if (!b) return;
    const a = b.dataset.fv;
    if (a === 'close') close();
    else if (a === 'dl') dlFile(url, name);
    else if (a === 'copy') {
      (navigator.clipboard?.writeText(rawText) || Promise.reject()).then(() => toast('Nusxalandi', 'success'), () => toast('Nusxalab bo\'lmadi', 'error'));
    } else if (a === 'wrap') {
      const c = body.querySelector('.fv-code');
      if (!c) return;
      const on = c.classList.toggle('fv-wrap');
      b.classList.toggle('on', on);
      try { localStorage.setItem('fv_wrap', on ? '1' : '0'); } catch (_) {}
    }
  });

  document.body.appendChild(el);

  (async () => {
    try {
      if (kind === 'image') {
        body.innerHTML = '<div class="fv-media"><img alt=""></div>';
        const img = body.querySelector('img');
        img.onerror = () => msg('Rasmni ochib bo\'lmadi.');
        img.src = url;
        return;
      }
      if (kind === 'video') {
        body.innerHTML = '<div class="fv-media"><video controls playsinline preload="metadata"></video></div>';
        body.querySelector('video').src = url;
        return;
      }
      if (kind === 'audio') {
        body.innerHTML = `<div class="fv-audio"><div>${fileIconSvg(name, mime, 96)}</div><b>${esc(name)}</b><audio controls preload="metadata"></audio></div>`;
        body.querySelector('audio').src = url;
        return;
      }
      if (kind === 'pdf') {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error('http');
        const buf = await res.arrayBuffer();
        blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        body.innerHTML = '<iframe class="fv-frame" title=""></iframe>';
        body.querySelector('iframe').src = blobUrl;
        return;
      }
      // Noma'lum tur: katta bo'lsa fetch qilmaymiz
      if (kind === 'unknown' && size > 3 * 1024 * 1024) { msg('Bu turdagi faylni ilova ichida ko\'rsatib bo\'lmaydi.'); return; }
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error('http');
      const { buf, cut } = await readLimited(res, MAX_TEXT);
      const u8 = new Uint8Array(buf);
      if (kind === 'unknown' && looksBinary(u8)) { msg('Bu turdagi faylni ilova ichida ko\'rsatib bo\'lmaydi.'); return; }
      if (kind === 'text' && looksBinary(u8)) { msg('Fayl matn emas ko\'rinadi — yuklab olib oching.'); return; }
      let txt = new TextDecoder('utf-8').decode(u8);
      if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
      if (kind === 'table') {
        rawText = txt;
        body.innerHTML = tableHtml(txt, ext) || '<div class="fv-msg"><span>Fayl bo\'sh.</span></div>';
        tools.innerHTML = `<button type="button" class="fv-ib" data-fv="copy" aria-label="Nusxalash" title="Nusxalash">${COPY}</button>`;
        return;
      }
      if (!txt.trim()) { body.innerHTML = '<div class="fv-msg"><span>Fayl bo\'sh.</span></div>'; return; }
      paintText(txt, cut);
    } catch (err) {
      if (ac.signal.aborted) return;
      msg('Faylni ochib bo\'lmadi. Yuklab olishni sinab ko\'ring.');
    }
  })();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!t || !t.matches || !t.matches('[data-fv-url][role="button"]')) return;
  e.preventDefault();
  openFileViewer({ url: t.dataset.fvUrl, name: t.dataset.fvName, mime: t.dataset.fvMime, size: t.dataset.fvSize });
});

/* ── Global: data-fv-url konteynerlari ──────────────────────────────── */
document.addEventListener('click', e => {
  const t = e.target;
  if (!t || !t.closest) return;
  const box = t.closest('[data-fv-url]');
  if (!box) return;
  const f = { url: box.dataset.fvUrl, name: box.dataset.fvName, mime: box.dataset.fvMime, size: box.dataset.fvSize };
  if (!f.url) return;
  e.preventDefault();
  e.stopPropagation();
  if (t.closest('.cfm-dl, .file-dl, .cm-dl, .fv-dlbtn')) dlFile(f.url, f.name || 'file');
  else openFileViewer(f);
}, true);
