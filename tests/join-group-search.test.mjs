/* "Guruhga qo'shilish" oynasi: ommaviy guruhlarni nom/@username bo'yicha qidirish (jsdom).
   groups.js dan HAQIQIY openJoinGroupModal() matni olinadi, tashqi funksiyalar soxta.  Ishlatish: node tests/join-group-search.test.mjs */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>');
const { document } = dom.window;
globalThis.document = document; globalThis.requestAnimationFrame = f => setTimeout(f, 0);

const src = readFileSync(new URL('../modules/chat/groups.js', import.meta.url), 'utf8');
const a = src.indexOf('export function openJoinGroupModal() {'), b = src.indexOf('\nlet _createType', a);
if (a < 0 || b < 0) throw new Error('openJoinGroupModal topilmadi');
const body = src.slice(a, b).replace('export function', 'function');

const calls = { search: [], resolve: [], join: [], open: [], toast: [], load: 0 };
let searchImpl = async () => [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const env = {
  esc, defAvi: n => 'avi:' + n, state: { me: { uid: 'me' } },
  searchGroups: async t => { calls.search.push(t); return searchImpl(t); },
  resolveGroupInvite: async r => { calls.resolve.push(r); return { success: true, name: 'Maxfiy', is_private: true }; },
  joinGroupByToken: async () => ({ success: true, group_id: 'gx' }),
  joinGroup: async id => { calls.join.push(id); },
  openGroupThread: id => calls.open.push(id), _loadGroups: async () => { calls.load++; },
  toast: (m, t) => calls.toast.push(t),
};
const open = new Function(...Object.keys(env), body + '\nreturn openJoinGroupModal;')(...Object.values(env));

let n = 0, fails = 0;
const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.error(`FAIL ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const type = async (v, ms = 450) => { const i = $('#grpJoinInput'); i.value = v; i.dispatchEvent(new dom.window.Event('input')); await wait(ms); };
const reset = () => { document.body.innerHTML = ''; for (const k of ['search', 'resolve', 'join', 'open', 'toast']) calls[k].length = 0; calls.load = 0; open(); };

const PUB = [{ id: 'g1', name: '9 "V" sinf guruhi', username: 'sinf9v', avatar: '', members: ['u1', 'u2'], subscriberCount: 2 },
             { id: 'g2', name: 'Men a\'zo', username: '', avatar: 'x.png', members: ['me'], subscriberCount: 1 }];

// 1) nom bo'yicha qidirish
reset(); searchImpl = async () => PUB; await type('sinf');
eq('qidirildi', calls.search, ['sinf']); eq('2 ta natija', document.querySelectorAll('.grp-join-row').length, 2);
eq('Qo\'shilish tugmasi (a\'zo emas)', document.querySelector('[data-gid="g1"] .grp-join-row-btn').textContent, "Qo'shilish");
eq('Ochish tugmasi (a\'zo)', document.querySelector('[data-gid="g2"] .grp-join-row-btn').textContent, 'Ochish');
eq('username ko\'rinadi', document.querySelector('[data-gid="g1"] .grp-join-row-meta').textContent, '@sinf9v · 2 a\'zo');
eq('"Qo\'shilish" submit yashirin (qidiruv rejimi)', $('#grpJoinSubmit').hidden, true);
eq('holat bo\'sh', $('#grpJoinStatus').hidden, true);
eq('resolve chaqirilmadi', calls.resolve.length, 0);

// 2) qo'shilish bosildi
document.querySelector('[data-gid="g1"] .grp-join-row-btn').click(); await wait(30);
eq('joinGroup(g1)', calls.join, ['g1']); eq('guruh ochildi', calls.open, ['g1']); eq('ro\'yxat yangilandi', calls.load, 1); eq('toast success', calls.toast, ['success']);

// 3) a'zo bo'lgan guruh: faqat ochiladi, qayta qo'shilmaydi
reset(); searchImpl = async () => PUB; await type('azo');
document.querySelector('[data-gid="g2"] .grp-join-row-btn').click(); await wait(30);
eq('a\'zo: joinGroup chaqirilmadi', calls.join, []); eq('a\'zo: ochildi', calls.open, ['g2']);

// 4) topilmadi
reset(); searchImpl = async () => []; await type('yoq-guruh');
eq('topilmadi matni', $('#grpJoinStatus').textContent, 'Ommaviy guruh topilmadi'); eq('xato klassi', $('#grpJoinStatus').classList.contains('err'), true);

// 5) juda qisqa so'rov qidirilmaydi
reset(); await type('a'); await type('@b');
eq('1 belgi: qidiruv yo\'q', calls.search, []);

// 6) havola/kod — eski maxfiy oqim
reset(); await type('https://spacemr.vercel.app/chats/g/' + 'a'.repeat(20));
eq('havola: resolve', calls.resolve.length, 1); eq('havola: qidiruv yo\'q', calls.search, []); eq('havola: submit ko\'rinadi', $('#grpJoinSubmit').hidden, false);
eq('havola: submit yoqildi', $('#grpJoinSubmit').disabled, false);
reset(); await type('f'.repeat(64));
eq('64-hex kod: resolve', calls.resolve.length, 1); eq('64-hex: qidiruv yo\'q', calls.search, []);

// 7) poyga: sekin eski javob yangisini bosib ketmasin
reset(); let k = 0;
searchImpl = async t => { const my = ++k; await wait(my === 1 ? 300 : 10); return [{ id: 'r' + my, name: 'natija-' + t, username: '', members: [], subscriberCount: 0 }]; };
await type('ab', 330); await type('abc', 600);
eq('faqat oxirgi so\'rov natijasi', [...document.querySelectorAll('.grp-join-row-name')].map(e => e.textContent), ['natija-abc']);

// 8) XSS: nom escape qilinadi
reset(); searchImpl = async () => [{ id: 'x', name: '<img src=x onerror=alert(1)>', username: '<b>', members: [], subscriberCount: 0 }]; await type('xss');
eq('XSS: faqat avatar <img> bor, begona teg yo\'q', [document.querySelectorAll('.grp-join-row img').length, document.querySelectorAll('.grp-join-row b').length, document.querySelectorAll('.grp-join-row [onerror*="alert"]').length], [1, 0, 0]);
eq('XSS: matn ko\'rinadi', document.querySelector('.grp-join-row-name').textContent, '<img src=x onerror=alert(1)>');

// 9) matn o'chirilsa natijalar yo'qoladi
reset(); searchImpl = async () => PUB; await type('sinf'); await type('', 50);
eq('tozalandi', document.querySelectorAll('.grp-join-row').length, 0);

console.log(`${n - fails}/${n} OK`); process.exit(fails ? 1 : 0);
