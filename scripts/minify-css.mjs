#!/usr/bin/env node
/** minify-css.mjs — app.css ni siqadi (kutubxonasiz). Manba CSS/*.css o'zgarmaydi.
 *  Ishlatish: node scripts/build-css.mjs && node scripts/minify-css.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'app.css');
let css = readFileSync(file, 'utf8');
const before = Buffer.byteLength(css);

css = css.replace(/\/\*[\s\S]*?\*\//g, '');
/* Faqat XAVFSIZ siqish: izohlar, ortiqcha bo'shliq/yangi qator (bitta bo'shliqqa), { } ; , atrofidagi bo'shliq, ";}" -> "}".
 * Hech qachon: ']' / ')' dan keyingi bo'shliq (descendant selektor: [data-theme="dark"] #x), ':' atrofi (".a :hover"),
 * '+' / '-' atrofi (calc(1px + 2px)), satr (string) ichi — bularga tegilmaydi. */
let out = '';
let i = 0;
while (i < css.length) {
  const c = css[i];
  if (c === '"' || c === "'") {
    const q = c;
    out += q;
    i++;
    while (i < css.length) {
      out += css[i];
      if (css[i] === '\\' && i + 1 < css.length) { out += css[++i]; i++; continue; }
      if (css[i] === q) { i++; break; }
      i++;
    }
    continue;
  }
  if (/\s/.test(c)) {
    while (i < css.length && /\s/.test(css[i])) i++;
    const prev = out[out.length - 1] || '';
    const n = css[i] || '';
    if (prev && n && !'{};,'.includes(prev) && !'{};,}'.includes(n)) out += ' ';
    continue;
  }
  if (c === '}' && out.endsWith(';')) out = out.slice(0, -1);
  out += c;
  i++;
}

writeFileSync(file, out);
const after = Buffer.byteLength(out);
console.log(`OK: app.css minify ${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB (${Math.round(100 * (1 - after / before))}%)`);
