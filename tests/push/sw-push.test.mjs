/* sw.js 'push' hodisasi sinovi: haqiqiy sw.js vm ichida, soxta self/clients/registration bilan.
   Ishlatish: node tests/push/sw-push.test.mjs */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const handlers = {}; const shown = [];
const selfObj = {
  addEventListener: (t, f) => { handlers[t] = f; },
  location: { origin: 'https://spacemr.vercel.app' },
  registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
  skipWaiting() {}, clients: { matchAll: async () => [], claim: async () => {} },
};
const ctx = vm.createContext({ self: selfObj, clients: selfObj.clients, caches: { open: async () => ({}), keys: async () => [], match: async () => undefined }, URL, Promise, console, fetch: async () => ({}), setTimeout, clearTimeout, Date, JSON, Array, String, RegExp, Set, Map });
vm.runInContext(src, ctx);

const FIRE = String.fromCodePoint(0x1f525), LAUGH = String.fromCodePoint(0x1f602);
const EMO = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3|\uFE0F|\u200D|\[\[|\]\]|emoji\/2d/u;
async function push(data) {
  shown.length = 0; let p;
  handlers.push({ data: { json: () => data }, waitUntil: (x) => { p = x; } });
  await p; return shown[0];
}
let n = 0, fails = 0;
const eq = (name, got, want) => { n++; if (got !== want) { fails++; console.error(`FAIL ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); } };

let r = await push({ type: 'message', title: `Ali ${FIRE}`, body: `Salom ${LAUGH} [[emoji/2d/1f525.png]] dunyo`, chatId: 'c1' });
eq('aralash body', r.body, 'Salom dunyo'); eq('sarlavha', r.title, 'Ali'); eq('rasm yo\'q', r.image, undefined);
r = await push({ type: 'message', title: 'Ali', body: FIRE });
eq('faqat belgi', r.body, 'Emoji'); eq('rasm', r.image, 'https://spacemr.vercel.app/emoji/2d/1f525.png');
r = await push({ type: 'message', title: 'Ali', body: '[[emoji/2d/2764-200d-1f525.png]]' });
eq('faqat token', r.body, 'Emoji'); eq('token rasmi', r.image, 'https://spacemr.vercel.app/emoji/2d/2764-200d-1f525.png');
r = await push({ type: 'message', title: 'Ali', body: FIRE, image: 'https://m/x.jpg' });
eq('server rasmi ustun', r.image, 'https://m/x.jpg');
r = await push({ type: 'message', title: 'Ali', body: 'matn', image: 'http://evil/x.png' });
eq('http rasm rad', r.image, undefined);
r = await push({ type: 'message', title: 'Ali', body: '© 2026 ® ™' }); eq('oddiy belgilar', r.body, '© 2026 ® ™');
r = await push({ type: 'message', title: FIRE, body: 'x' }); eq('faqat emoji sarlavha', r.title, 'SpaceMR');
r = await push({ type: 'message', title: 'Ali', body: '{"__postShare":true,"x":1}' }); eq('post xom json', r.body, 'Post ulashdi');
r = await push({ type: 'call', title: 'Ali', body: `Qo'ng'iroq qilmoqda...` }); eq('qo\'ng\'iroq', r.body, "Qo'ng'iroq qilmoqda...");
r = await push({ type: 'message', title: 'Ali', body: `${FIRE}${LAUGH} [[emoji/2d/1f44d.png]] bor` });
eq('hech narsa emoji emas', EMO.test(`${r.title}${r.body}`), false);
console.log(`${n - fails}/${n} OK`); process.exit(fails ? 1 : 0);
