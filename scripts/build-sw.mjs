#!/usr/bin/env node
/**
 * build-sw.mjs — PRECACHE_URLS: faqat shell (tez install).
 * To'liq modules/** precache tab-spinner va 1–2 daqiqa sekinlikni keltirardi.
 * Qolgan fayllar runtime cache orqali.
 * bump-sw.mjs CACHE_VERSION ni yangilaydi (Vercel).
 * Ishlatish: node scripts/build-sw.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

const urls = [];
const seen = new Set();
for (const u of shell) {
  if (!seen.has(u)) { seen.add(u); urls.push(u); }
}

const list = urls.map(u => `  '${u}'`).join(',\n');
const block = `// BEGIN_PRECACHE\n/* Faqat shell — modules runtime cache. */\nconst PRECACHE_URLS = [\n${list}\n];\n// END_PRECACHE`;

let src = readFileSync(SW, 'utf8');
const re = /\/\/ BEGIN_PRECACHE[\s\S]*?\/\/ END_PRECACHE/;
if (!re.test(src)) {
  console.error('build-sw: BEGIN_PRECACHE…END_PRECACHE topilmadi');
  process.exit(1);
}
src = src.replace(re, block);
writeFileSync(SW, src);
console.log(`OK: PRECACHE_URLS — ${urls.length} ta (faqat shell)`);
