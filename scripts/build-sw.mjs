#!/usr/bin/env node
/**
 * build-sw.mjs — PRECACHE_URLS: faqat shell (tez install).
 * To'liq modules/** precache tab-spinner va 1–2 daqiqa sekinlikni keltirardi.
 * Qolgan fayllar runtime cache orqali.
 * bump-sw.mjs CACHE_VERSION ni yangilaydi (Vercel).
 * Ishlatish: node scripts/build-sw.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'sw.js');

const shell = [
  '/',
  '/index.html',
  '/app.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/svg/logo.png',
  '/svg/favicon.png',
  '/modules/script.js',
  '/modules/core/config.js',
  '/modules/core/utils.js',
  '/modules/core/env.js',
  '/modules/router.js',
  '/modules/url-router.js',
];
if (existsSync(join(ROOT, 'app.js'))) shell.splice(3, 0, '/app.js');

const critical = [];
const seen = new Set();
for (const u of shell) {
  if (!seen.has(u)) { seen.add(u); critical.push(u); }
}

/** Telegram kabi: butun ilova (barcha modullar, ikonkalar, svg) o'rnatishda keshga tushadi — to'liq oflayn ishlaydi. */
function walk(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, acc);
    else if (exts.test(name)) acc.push('/' + p.slice(ROOT.length + 1).split('\\').join('/'));
  }
  return acc;
}
const rest = [
  ...walk(join(ROOT, 'modules'), /\.(js|mjs|json|wasm)$/),
  ...walk(join(ROOT, 'svg'), /\.(svg|png|webp|jpg)$/),
  ...walk(join(ROOT, 'icons'), /\.(png|svg|ico|webp)$/),
  ...walk(join(ROOT, 'CSS'), /\.css$/).filter(() => false),
].filter(u => !seen.has(u));

const fmt = a => a.map(u => `  '${u}'`).join(',\n');
const block = `// BEGIN_PRECACHE\n/* CRITICAL: o'rnatish shu fayllarsiz tugamaydi. REST: butun ilova (oflayn uchun), alohida fayl xatosi o'rnatishni to'xtatmaydi. */\nconst PRECACHE_CRITICAL = [\n${fmt(critical)}\n];\nconst PRECACHE_URLS = [\n${fmt(rest)}\n];\n// END_PRECACHE`;

let src = readFileSync(SW, 'utf8');
const re = /\/\/ BEGIN_PRECACHE[\s\S]*?\/\/ END_PRECACHE/;
if (!re.test(src)) {
  console.error('build-sw: BEGIN_PRECACHE…END_PRECACHE topilmadi');
  process.exit(1);
}
src = src.replace(re, block);
writeFileSync(SW, src);
console.log(`OK: precache — critical ${critical.length}, rest ${rest.length}`);
