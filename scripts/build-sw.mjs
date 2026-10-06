#!/usr/bin/env node
/**
 * build-sw.mjs — PRECACHE_URLS ni modules papkasidagi barcha .js dan yigadi.
 * bump-sw.mjs CACHE_VERSION ni yangilaydi (Vercel).
 * Ishlatish: node scripts/build-sw.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'sw.js');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const shell = ['/', '/index.html', '/app.css', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/svg/logo.png', '/svg/favicon.png'];
if (existsSync(join(ROOT, 'app.js'))) shell.splice(3, 0, '/app.js');

const mods = walk(join(ROOT, 'modules'))
  .map(p => '/' + relative(ROOT, p).split('\\').join('/'))
  .sort();

const urls = [];
const seen = new Set();
for (const u of [...shell, ...mods]) {
  if (!seen.has(u)) { seen.add(u); urls.push(u); }
}

const list = urls.map(u => `  '${u}'`).join(',\n');
const block = `// BEGIN_PRECACHE\nconst PRECACHE_URLS = [\n${list}\n];\n// END_PRECACHE`;

let src = readFileSync(SW, 'utf8');
const re = /\/\/ BEGIN_PRECACHE[\s\S]*?\/\/ END_PRECACHE/;
if (!re.test(src)) {
  console.error('build-sw: BEGIN_PRECACHE…END_PRECACHE topilmadi');
  process.exit(1);
}
src = src.replace(re, block);
writeFileSync(SW, src);
console.log(`OK: PRECACHE_URLS — ${urls.length} ta (shell ${shell.length} + modules ${mods.length})`);
