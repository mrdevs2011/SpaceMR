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
    const prev = out[out.length - 1] || '';
    const next = css.slice(i).match(/^\s*/)[0];
    i += next.length;
    const n = css[i] || '';
    if (prev && n && /[\w%#.@*-]/.test(prev) && /[\w%#.@*-]/.test(n)) out += ' ';
    continue;
  }
  out += c;
  i++;
}
out = out.replace(/;\s*}/g, '}').replace(/\s*{\s*/g, '{').replace(/\s*}\s*/g, '}').replace(/\s*;\s*/g, ';').replace(/\s*:\s*/g, ':').replace(/\s*,\s*/g, ',');

writeFileSync(file, out);
const after = Buffer.byteLength(out);
console.log(`OK: app.css minify ${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB (${Math.round(100 * (1 - after / before))}%)`);
