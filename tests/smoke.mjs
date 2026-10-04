/* tests/smoke.mjs — 8-faza: Playwright smoke (ixtiyoriy).
   Ishga tushirish:  node tests/smoke.mjs            (lokal statik server o'zi ko'tariladi)
                     BASE_URL=https://<preview> node tests/smoke.mjs
   Login/post/chat testlari FAQAT TEST_EMAIL + TEST_PASSWORD berilsa yuriladi
   (haqiqiy oilaviy bazaga tegmaslik uchun MR alohida test akkaunt ochadi).
   playwright-core: `npm i -D playwright-core` yoki PW_PATH=/yo'l/node_modules/playwright-core */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const require = createRequire(import.meta.url);
const pwPath = process.env.PW_PATH || (() => {
  for (const p of ['playwright-core', join(process.env.HOME || '', 'Claude/work/shots/node_modules/playwright-core')]) {
    try { require.resolve(p); return p; } catch (_) {}
  }
  return null;
})();
if (!pwPath) { console.error('playwright-core topilmadi (npm i -D playwright-core yoki PW_PATH)'); process.exit(2); }
const { chromium } = require(pwPath);
const CHROME = process.env.CHROME_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer(async (req, rsp) => {
      let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      if (p === '/' || !extname(p)) p = '/index.html';
      try { const b = await readFile(join(ROOT, p)); rsp.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); rsp.end(b); }
      catch (_) { rsp.writeHead(404); rsp.end('nf'); }
    }).listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const results = [];
const ok = (name, pass, note = '') => { results.push({ name, pass, note }); console.log(`${pass ? '✅' : '❌'} ${name}${note ? ' — ' + note : ''}`); };

let local = null, base = process.env.BASE_URL;
if (!base) { local = await serve(); base = local.url; }
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

for (const vp of [{ n: 'desktop', w: 1280, h: 800 }, { n: 'mobil', w: 390, h: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const errs = [], bad = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('requestfailed', r => { if (r.url().startsWith(base)) bad.push(r.url()); });
  page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400 && !/favicon|\.well-known/.test(r.url())) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  ok(`[${vp.n}] sahifa ochildi (title)`, (await page.title()).length > 0, await page.title());
  ok(`[${vp.n}] JS xatosi yo'q (pageerror)`, errs.length === 0, errs.slice(0, 2).join(' | '));
  ok(`[${vp.n}] lokal resurslar 4xx/5xx bermadi`, bad.length === 0, bad.slice(0, 3).join(' | '));
  const css = await page.evaluate(() => [...document.styleSheets].some(s => (s.href || '').includes('app.css')));
  ok(`[${vp.n}] app.css ulangan`, css);
  const hasLogin = await page.evaluate(() => !!document.querySelector('#loginView, .login-view, [data-view="login"], input[type="password"]'));
  ok(`[${vp.n}] login ekrani (yoki parol inputi) bor`, hasLogin);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(`[${vp.n}] gorizontal scroll yo'q`, noHScroll);
  ok(`[${vp.n}] error-log ishga tushgan (__mrErrors)`, await page.evaluate(() => typeof window.__mrErrors === 'function'));
  await ctx.close();
}

if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(base, { waitUntil: 'load' });
  try {
    await page.fill('#aUsername', process.env.TEST_EMAIL);
    await page.fill('#aPassword', process.env.TEST_PASSWORD);
    await page.click('#authBtn');
    await page.waitForSelector('#app.show #feed', { timeout: 15000 });
    ok('[auth] login ishladi', true);
  } catch (e) { ok('[auth] login ishladi', false, e.message.split('\n')[0]); }
  ok('[auth] login/ilova paytida JS xatosi yo\'q', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
} else {
  console.log('ℹ️  login/post/chat testlari o\'tkazib yuborildi (TEST_EMAIL/TEST_PASSWORD yo\'q)');
}

await browser.close();
if (local) local.srv.close();
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
process.exit(failed ? 1 : 0);
