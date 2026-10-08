#!/usr/bin/env node
/* inject-preload.mjs — deploy vaqtida index.html ga <link rel="modulepreload"> qo'shadi (birinchi ochilish tezroq).
   Muammo: ES modul grafi "poezd" bo'lib yuklanadi — brauzer har modulni o'qib, keyin uning import'larini aniqlaydi
   (har daraja = yana bir tarmoq aylanishi; mobil tarmoqda sezilarli). Biz statik import grafini oldindan hisoblab,
   hammasini PARALLEL yuklashni so'raymiz. Qo'shimcha bayt yuklanmaydi — baribir shu modullar kerak.
   - Faqat statik import/export-from (dynamic import() — ataylab kiritilmaydi: ular kerak bo'lganda yuklanadi).
   - Natija repo'ga commit qilinmaydi: faqat Vercel'da (VERCEL) yoki --force bilan; --check — faqat hisobot.
   - Idempotent (<!--mp:start--> ... <!--mp:end--> orasi), xato bo'lsa index.html tegilmaydi. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');
const CHECK = process.argv.includes('--check');
if (!process.env.VERCEL && !FORCE && !CHECK) {
  console.log("ℹ️ inject-preload: lokal — o'tkazib yuborildi (--force / --check)");
  process.exit(0);
}

/** Faqat statik: import X from '..' / import '..' / export ... from '..' (dynamic import() emas) */
function staticSpecs(code) {
  const out = [];
  const re = /(?:^|[\s;}])(?:import\s+(?:[\w$*{][^'"`;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})(?:\s+as\s+[\w$]+)?\s+from\s+)(['"])([^'"\n]+)\1/g;
  let m;
  while ((m = re.exec(code))) out.push(m[2]);
  return out;
}

try {
  const { transform } = await import('esbuild');
  const htmlPath = join(ROOT, 'index.html');
  let html = readFileSync(htmlPath, 'utf8');

  // Kirish nuqtalari: <script type="module" src="..."> va inline modul ichidagi statik import'lar
  const entries = new Set();
  for (const m of html.matchAll(/<script\s+type="module"\s+src="([^"?#]+)"/g)) entries.add(resolve(ROOT, m[1]));
  for (const m of html.matchAll(/<script\s+type="module">([\s\S]*?)<\/script>/g)) {
    for (const s of staticSpecs(m[1])) {
      if (s.startsWith('.')) entries.add(resolve(ROOT, s));
    }
  }

  const seen = new Set();
  const order = [];
  const stack = [...entries];
  while (stack.length) {
    const f = stack.shift();
    if (seen.has(f) || !f.endsWith('.js') || !existsSync(f)) continue;
    seen.add(f);
    order.push(f);
    let code = readFileSync(f, 'utf8');
    // Izohlarni olib tashlaymiz — izohdagi "import ... from" aldamasin
    code = (await transform(code, { loader: 'js', format: 'esm', target: 'esnext', legalComments: 'none' })).code;
    for (const s of staticSpecs(code)) {
      if (!s.startsWith('.') || s.includes('?') || s.includes('#')) continue;   // bare / query'li — o'tkazamiz (URL mos kelmasa ikki marta yuklanardi)
      stack.push(resolve(dirname(f), s));
    }
  }

  const hrefs = order
    .map(f => './' + relative(ROOT, f).split(sep).join('/'))
    .filter(h => h.startsWith('./modules/') || h === './app.js');
  const block = `<!--mp:start-->\n${hrefs.map(h => `<link rel="modulepreload" href="${h}">`).join('\n')}\n<!--mp:end-->`;

  if (CHECK) {
    console.log(`ℹ️ inject-preload (hisobot): ${entries.size} kirish nuqtasi → ${hrefs.length} modul parallel yuklanadi`);
    process.exit(0);
  }

  const MARK = /<!--mp:start-->[\s\S]*?<!--mp:end-->/;
  if (MARK.test(html)) html = html.replace(MARK, () => block);
  else {
    const anchor = html.search(/<link rel="stylesheet" href="\.\/app\.css[^>]*>/);
    if (anchor < 0) throw new Error('app.css <link> topilmadi');
    const end = html.indexOf('>', anchor) + 1;
    html = html.slice(0, end) + '\n' + block + html.slice(end);
  }
  writeFileSync(htmlPath, html);
  console.log(`OK: inject-preload ${hrefs.length} modul`);
} catch (e) {
  console.warn("⚠️ inject-preload o'tkazib yuborildi (index.html asl holida):", e?.message || e);
}
