/**
 * file-viewer.js — SpaceMR ichida fayl ochish (matn, kod, jadval, media, PDF,
 * DOCX/XLSX/PPTX/ODT, ZIP daraxt, RTF). Kutubxonasiz ZIP+OOXML.
 */
import { esc, fmtSz, dlFile } from '../core/utils.js';
import { fileIconSvg } from '../core/file-icons.js';
import { toast } from './toast.js';
import { onEsc } from './esc-stack.js';
import { highlight as hlHtml, hlJs, hlCss } from '../apps/code-hl.js';

const Z = 1650;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_HL = 400000;
const MAX_ROWS = 3000;
const MAX_BIN = 20 * 1024 * 1024; // office/zip uchun
const MAX_ZIP_ENTRIES = 2500;
const MAX_DOC_IMGS = 40;

const CHEV = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const DL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
const COPY = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>';
const WRAP = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4m0 0 2-2m-2 2 2 2M4 18h5"/></svg>';

/* ── Tur ────────────────────────────────────────────────────────────── */
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
const OFFICE_DOC = set('docx dotx odt');
const OFFICE_SHEET = set('xlsx xlsm ods');
const OFFICE_SLIDE = set('pptx ppsx odp');
const ARCHIVE = set('zip jar apk epub');

function kindOf(name, mime) {
  const e = extOf(name), m = String(mime || '').toLowerCase();
  if (IMG.has(e) || m.startsWith('image/')) return 'image';
  if (VID.has(e) || m.startsWith('video/')) return 'video';
  if (AUD.has(e) || m.startsWith('audio/')) return 'audio';
  if (e === 'pdf' || m === 'application/pdf') return 'pdf';
  if (e === 'csv' || e === 'tsv' || m === 'text/csv') return 'table';
  if (OFFICE_DOC.has(e) || m.includes('wordprocessingml') || m.includes('opendocument.text')) return 'docx';
  if (OFFICE_SHEET.has(e) || m.includes('spreadsheetml') || m.includes('opendocument.spreadsheet')) return 'xlsx';
  if (OFFICE_SLIDE.has(e) || m.includes('presentationml') || m.includes('opendocument.presentation')) return 'pptx';
  if (ARCHIVE.has(e) || m === 'application/zip' || m.includes('epub')) return 'zip';
  if (e === 'rtf' || m === 'application/rtf' || m === 'text/rtf') return 'rtf';
  if (LANG[e] || PLAIN.has(e) || m.startsWith('text/') || m === 'application/json') return 'text';
  return 'unknown';
}

/* ── Highlight ──────────────────────────────────────────────────────── */
const E = s => s.replace(/&/g, "&" + "amp;").replace(/</g, "&" + "lt;").replace(/>/g, "&" + "gt;");
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
function matrixTableHtml(rows, cut) {
  if (!rows.length) return '<div class="fv-msg"><span>Bo’sh.</span></div>';
  const cols = Math.min(40, Math.max(...rows.map(r => r.length)));
  const cell = (t, v) => `<${t}>${esc(String(v ?? ''))}</${t}>`;
  const head = rows[0];
  const thead = `<thead><tr><th class="fv-rn"></th>${Array.from({ length: cols }, (_, i) => cell('th', head[i] ?? '')).join('')}</tr></thead>`;
  const tbody = rows.slice(1).map((r, i) => `<tr><td class="fv-rn">${i + 1}</td>${Array.from({ length: cols }, (_, j) => cell('td', r[j] ?? '')).join('')}</tr>`).join('');
  return `<div class="fv-tablewrap">${cut ? `<div class="fv-cut">Birinchi ${MAX_ROWS} qator.</div>` : ''}<table class="fv-table">${thead}<tbody>${tbody}</tbody></table></div>`;
}

/* ── Read helpers ───────────────────────────────────────────────────── */
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

/* ── Minimal ZIP (store + deflate-raw) ──────────────────────────────── */
const u16 = (v, o) => v[o] | (v[o + 1] << 8);
const u32 = (v, o) => (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0;

async function inflateRaw(data) {
  if (!data.length) return new Uint8Array(0);
  if (typeof DecompressionStream === 'undefined') throw new Error('no-inflate');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function parseZip(buf) {
  const v = new Uint8Array(buf);
  const files = [];
  // central directory end
  let eocd = -1;
  for (let i = v.length - 22; i >= Math.max(0, v.length - 65557); i--) {
    if (v[i] === 0x50 && v[i + 1] === 0x4b && v[i + 2] === 0x05 && v[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip');
  const nEntries = u16(v, eocd + 10);
  let off = u32(v, eocd + 16);
  const max = Math.min(nEntries, MAX_ZIP_ENTRIES);
  for (let i = 0; i < max; i++) {
    if (u32(v, off) !== 0x02014b50) break;
    const method = u16(v, off + 10);
    const comp = u32(v, off + 20);
    const size = u32(v, off + 24);
    const nameLen = u16(v, off + 28);
    const extraLen = u16(v, off + 30);
    const commentLen = u16(v, off + 32);
    const localOff = u32(v, off + 42);
    const name = new TextDecoder('utf-8').decode(v.subarray(off + 46, off + 46 + nameLen));
    files.push({ name, method, comp, size, localOff, isDir: name.endsWith('/') });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { v, files };
}

async function zipRead(zip, path) {
  const f = zip.files.find(x => x.name === path);
  if (!f || f.isDir) return null;
  const v = zip.v;
  let lo = f.localOff;
  if (u32(v, lo) !== 0x04034b50) throw new Error('local');
  const nameLen = u16(v, lo + 26);
  const extraLen = u16(v, lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const raw = v.subarray(dataStart, dataStart + f.comp);
  if (f.method === 0) return raw.slice();
  if (f.method === 8) return inflateRaw(raw);
  throw new Error('method');
}

function zipTreeHtml(files) {
  const items = files.filter(f => f.name && !f.name.startsWith('__MACOSX') && !f.name.includes('/._'));
  const dirs = new Map(); // path -> children count
  const rows = [];
  for (const f of items) {
    const parts = f.name.replace(/\/$/, '').split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc += (acc ? '/' : '') + parts[i];
      if (!dirs.has(acc)) dirs.set(acc, 0);
    }
  }
  // flat sorted
  const list = items.slice().sort((a, b) => a.name.localeCompare(b.name));
  let html = '<div class="fv-tree">';
  for (const f of list) {
    const depth = f.name.replace(/\/$/, '').split('/').length - 1;
    const base = f.name.split('/').filter(Boolean).pop() || f.name;
    const isDir = f.isDir || f.name.endsWith('/');
    const sz = isDir ? '' : fmtSz(f.size || 0);
    html += `<div class="fv-tree-row" style="--d:${depth}"><span class="fv-tree-ico">${isDir ? '📁' : '📄'}</span><span class="fv-tree-name">${esc(base)}</span><span class="fv-tree-sz">${esc(sz)}</span></div>`;
  }
  if (!list.length) html += '<div class="fv-msg"><span>Bosh arxiv</span></div>';
  html += '</div>';
  return html;
}

/* ── OOXML helpers ──────────────────────────────────────────────────── */
const xmlText = (xml, tag) => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  // wrong - need simpler
  return null;
};
function stripXml(s) {
  const a = '&' + 'amp;', l = '&' + 'lt;', g = '&' + 'gt;', q = '&' + 'quot;';
  return String(s || '')
    .replace(/<w:tab\/>/gi, '\t')
    .replace(/<w:br[^/]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll(a, '&')
    .replaceAll(l, '<')
    .replaceAll(g, '>')
    .replaceAll(q, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function renderDocx(zip, body, tools, blobUrls) {
  const isOdt = zip.files.some(f => f.name === 'content.xml');
  let html = '';
  let plain = '';

  if (isOdt) {
    const u8 = await zipRead(zip, 'content.xml');
    if (!u8) throw new Error('odt');
    const xml = new TextDecoder('utf-8').decode(u8);
    plain = stripXml(xml.replace(/<text:p[^>]*>/gi, '\n').replace(/<text:h[^>]*>/gi, '\n'));
    html = plain.split('\n').filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');
  } else {
    // relationships for images
    const relsU8 = await zipRead(zip, 'word/_rels/document.xml.rels');
    const relMap = {};
    if (relsU8) {
      const rels = new TextDecoder('utf-8').decode(relsU8);
      const re = /Id="([^"]+)"[^>]*Target="([^"]+)"/g;
      let m;
      while ((m = re.exec(rels))) {
        let t = m[2];
        if (!t.startsWith('/')) t = 'word/' + t.replace(/^\.\//, '');
        else t = t.replace(/^\//, '');
        relMap[m[1]] = t.replace(/\\/g, '/');
      }
    }
    const docU8 = await zipRead(zip, 'word/document.xml');
    if (!docU8) throw new Error('docx');
    const xml = new TextDecoder('utf-8').decode(docU8);

    // Build HTML paragraph by paragraph, inject images
    const parts = xml.split(/<w:p[\s>]/);
    const out = [];
    let imgCount = 0;
    for (let i = 1; i < parts.length; i++) {
      const chunk = parts[i];
      const end = chunk.indexOf('</w:p>');
      const pxml = end >= 0 ? chunk.slice(0, end) : chunk;

      // drawings / blips
      const imgs = [];
      const blipRe = /r:embed="([^"]+)"/g;
      let bm;
      while ((bm = blipRe.exec(pxml)) && imgCount < MAX_DOC_IMGS) {
        const target = relMap[bm[1]];
        if (!target) continue;
        try {
          const imgData = await zipRead(zip, target);
          if (!imgData) continue;
          const ext = extOf(target);
          const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
          const url = URL.createObjectURL(new Blob([imgData], { type: mime }));
          blobUrls.push(url);
          imgs.push(url);
          imgCount++;
        } catch (_) {}
      }

      // text runs
      let text = '';
      const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let tm;
      while ((tm = tRe.exec(pxml))) text += tm[1].replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
      if (/<w:tab\/>/.test(pxml)) text = text; // already sequential

      if (text.trim() || imgs.length) {
        if (text.trim()) {
          out.push(`<p>${esc(text)}</p>`);
          plain += text + '\n';
        }
        for (const u of imgs) out.push(`<figure class="fv-doc-img"><img src="${u}" alt="" loading="lazy" decoding="async"></figure>`);
      }
    }
    html = out.join('') || '<p class="fv-muted">(Matn topilmadi)</p>';
  }

  body.innerHTML = `<div class="fv-doc">${html}</div>`;
  tools.innerHTML = `<button type="button" class="fv-ib" data-fv="copy" aria-label="Nusxalash" title="Nusxalash">${COPY}</button>`;
  return plain;
}

async function renderXlsx(zip, body, tools) {
  const isOds = zip.files.some(f => f.name === 'content.xml' && !zip.files.some(x => x.name.startsWith('xl/')));
  if (isOds) {
    const u8 = await zipRead(zip, 'content.xml');
    const xml = new TextDecoder('utf-8').decode(u8 || new Uint8Array());
    const rows = [];
    const rowRe = /<table:table-row[\s>][\s\S]*?<\/table:table-row>/gi;
    let rm, cut = false;
    while ((rm = rowRe.exec(xml))) {
      const cells = [];
      const cellRe = /<table:table-cell[\s>][\s\S]*?<\/table:table-cell>|<table:table-cell[^/]*\/>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[0]))) {
        const t = stripXml(cm[0]);
        const rep = /table:number-columns-repeated="(\d+)"/.exec(cm[0]);
        const n = rep ? Math.min(20, +rep[1]) : 1;
        for (let i = 0; i < n; i++) cells.push(t);
      }
      if (cells.some(c => c)) rows.push(cells);
      if (rows.length > MAX_ROWS) { cut = true; break; }
    }
    body.innerHTML = matrixTableHtml(rows, cut);
    tools.innerHTML = '';
    return rows.map(r => r.join('\t')).join('\n');
  }

  // shared strings
  const ssU8 = await zipRead(zip, 'xl/sharedStrings.xml');
  const shared = [];
  if (ssU8) {
    const ss = new TextDecoder('utf-8').decode(ssU8);
    const siRe = /<si[\s>][\s\S]*?<\/si>/gi;
    let sm;
    while ((sm = siRe.exec(ss))) {
      let t = '';
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tRe.exec(sm[0]))) t += tm[1];
      shared.push(t.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>'));
    }
  }

  // first sheet
  const sheetEntry = zip.files.find(f => /^xl\/worksheets\/sheet\d+\.xml$/i.test(f.name));
  if (!sheetEntry) throw new Error('sheet');
  const shU8 = await zipRead(zip, sheetEntry.name);
  const sh = new TextDecoder('utf-8').decode(shU8 || new Uint8Array());
  const rows = [];
  let cut = false;
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/gi;
  let rm;
  while ((rm = rowRe.exec(sh))) {
    const cells = [];
    const cRe = /<c\s([^>]*)>([\s\S]*?)<\/c>|<c\s([^/]*)\/>/gi;
    let cm;
    while ((cm = cRe.exec(rm[1] || ''))) {
      const attrs = cm[1] || cm[3] || '';
      const inner = cm[2] || '';
      const ref = /r="([A-Z]+)(\d+)"/.exec(attrs);
      const col = ref ? ref[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1 : cells.length;
      while (cells.length < col) cells.push('');
      const t = /t="s"/.test(attrs);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let val = v ? v[1] : '';
      if (t && val !== '') val = shared[+val] ?? val;
      cells[col] = val;
    }
    rows.push(cells);
    if (rows.length > MAX_ROWS) { cut = true; break; }
  }
  body.innerHTML = matrixTableHtml(rows, cut);
  tools.innerHTML = '';
  return rows.map(r => r.join('\t')).join('\n');
}

async function renderPptx(zip, body, tools) {
  const slides = zip.files
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f.name) || /^content\.xml$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (zip.files.some(f => f.name === 'content.xml') && !zip.files.some(f => f.name.startsWith('ppt/'))) {
    const u8 = await zipRead(zip, 'content.xml');
    const plain = stripXml(new TextDecoder('utf-8').decode(u8 || new Uint8Array()));
    body.innerHTML = `<div class="fv-doc">${plain.split('\n').filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
    tools.innerHTML = `<button type="button" class="fv-ib" data-fv="copy">${COPY}</button>`;
    return plain;
  }

  const blocks = [];
  let plain = '';
  for (let i = 0; i < slides.length; i++) {
    const u8 = await zipRead(zip, slides[i].name);
    if (!u8) continue;
    const xml = new TextDecoder('utf-8').decode(u8);
    let text = '';
    const tRe = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let tm;
    while ((tm = tRe.exec(xml))) text += tm[1].replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>') + ' ';
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    plain += `--- Slayd ${i + 1} ---\n${text}\n\n`;
    blocks.push(`<section class="fv-slide"><h3>Slayd ${i + 1}</h3><p>${esc(text)}</p></section>`);
  }
  body.innerHTML = `<div class="fv-doc">${blocks.join('') || '<p class="fv-muted">(Matn topilmadi)</p>'}</div>`;
  tools.innerHTML = `<button type="button" class="fv-ib" data-fv="copy">${COPY}</button>`;
  return plain;
}

function rtfToText(src) {
  let s = String(src || '');
  // strip groups deeply is hard; pragmatic strip
  s = s.replace(/\{\\.*?\}/g, '');
  s = s.replace(/\\'[0-9a-fA-F]{2}/g, m => String.fromCharCode(parseInt(m.slice(2), 16)));
  s = s.replace(/\\par[d]?/g, '\n').replace(/\\tab/g, '\t');
  s = s.replace(/\\[a-z]+-?\d* ?/gi, '');
  s = s.replace(/[{}]/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

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
  const blobUrls = [];

  const close = () => {
    ac.abort();
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
    for (const u of blobUrls) { try { URL.revokeObjectURL(u); } catch (_) {} }
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

      // Binary-ish office/zip
      if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx' || kind === 'zip' || kind === 'rtf') {
        if (size > MAX_BIN) { msg('Fayl juda katta — yuklab olib oching.'); return; }
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error('http');
        const { buf, cut } = await readLimited(res, MAX_BIN);
        if (kind === 'rtf') {
          const txt = rtfToText(new TextDecoder('utf-8').decode(new Uint8Array(buf)));
          if (!txt) { msg('RTF matn topilmadi.'); return; }
          paintText(txt, cut);
          return;
        }
        // ZIP magic
        const head = new Uint8Array(buf, 0, 4);
        if (!(head[0] === 0x50 && head[1] === 0x4b)) {
          // maybe not zip - try as text fallback
          if (!looksBinary(new Uint8Array(buf))) {
            paintText(new TextDecoder('utf-8').decode(new Uint8Array(buf)), cut);
            return;
          }
          msg('Bu arxiv/formatni ochib bo\'lmadi.');
          return;
        }
        const zip = await parseZip(buf);
        if (kind === 'zip') {
          body.innerHTML = zipTreeHtml(zip.files);
          tools.innerHTML = '';
          return;
        }
        if (kind === 'docx') {
          rawText = await renderDocx(zip, body, tools, blobUrls);
          return;
        }
        if (kind === 'xlsx') {
          rawText = await renderXlsx(zip, body, tools);
          return;
        }
        if (kind === 'pptx') {
          rawText = await renderPptx(zip, body, tools);
          return;
        }
      }

      if (kind === 'unknown' && size > 3 * 1024 * 1024) { msg('Bu turdagi faylni ilova ichida ko\'rsatib bo\'lmaydi.'); return; }
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error('http');
      const { buf, cut } = await readLimited(res, MAX_TEXT);
      const u8 = new Uint8Array(buf);
      // ZIP magic on unknown → tree
      if (u8[0] === 0x50 && u8[1] === 0x4b) {
        try {
          const zip = await parseZip(buf);
          body.innerHTML = zipTreeHtml(zip.files);
          return;
        } catch (_) {}
      }
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
      console.warn('[fv]', err);
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
