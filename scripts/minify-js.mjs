#!/usr/bin/env node
/* minify-js.mjs — deploy vaqtida modules/**.js va app.js ni yengillashtiradi (izohlar + bo'shliqlar + sintaksis).
   - Bundle YO'Q, nomlar o'zgarmaydi (identifier mangle o'chiq): modul tuzilishi, window.* global'lar, import yo'llari xuddi shunday.
   - Natija repo'ga commit qilinmaydi: faqat Vercel build'da (VERCEL) yoki --force bilan ishlaydi.
   - Xavfsiz: hamma fayl AVVAL xotirada o'tkaziladi; birortasi xato bersa HECH NARSA yozilmaydi (build o'tadi, fayllar asl holida).
   Ishlatish: node scripts/minify-js.mjs [--force] [--check] */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');
const CHECK = process.argv.includes('--check');   // yozmasdan faqat hisobot
if (!process.env.VERCEL && !FORCE && !CHECK) {
  console.log("ℹ️ minify-js: lokal — o'tkazib yuborildi (--force / --check)");
  process.exit(0);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

try {
  const { transform } = await import('esbuild');
  const files = [...walk(join(ROOT, 'modules')).filter(f => !f.includes('/vendor/')), join(ROOT, 'app.js')];
  const out = [];
  let before = 0, after = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const r = await transform(src, {
      loader: 'js', format: 'esm', target: 'esnext',
      minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false,
      legalComments: 'none', sourcefile: relative(ROOT, f),
    });
    before += Buffer.byteLength(src);
    after += Buffer.byteLength(r.code);
    out.push([f, r.code]);
  }
  const kb = n => (n / 1024).toFixed(0) + ' KB';
  if (CHECK) {
    console.log(`ℹ️ minify-js (hisobot): ${files.length} fayl, ${kb(before)} → ${kb(after)} (${(100 - after / before * 100).toFixed(0)}% kam)`);
    process.exit(0);
  }
  for (const [f, code] of out) writeFileSync(f, code);
  console.log(`OK: minify-js ${files.length} fayl, ${kb(before)} → ${kb(after)} (${(100 - after / before * 100).toFixed(0)}% kam)`);
} catch (e) {
  // Minify ixtiyoriy tezlashtirish: ishlamasa deploy to'xtamasin
  console.warn("⚠️ minify-js o'tkazib yuborildi (fayllar asl holida):", e?.message || e);
}
