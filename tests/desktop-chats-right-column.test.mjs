// Desktop (data-device="desktop"): Suhbatlar ro'yxati (#chatsView) O'NG ustunda turadi, markaz paneli
// (#chatThreadModal / .chats-x-pane) ostida qolib ketmaydi. Regressiya: oxirgi `#chatsView.on` !important bloki
// ro'yxatni chapga (left: var(--sidebar)) va z-index: 2 ga qaytarib yashirib qo'yar edi.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../CSS/mono-x.css', import.meta.url), 'utf8');
const re = /:where\(html\[data-device="desktop"\]\) #chatsView\.on \{([^}]*)\}/g;
const blocks = [...css.matchAll(re)].map(m => m[1]);
assert.ok(blocks.length >= 2, 'mono-x.css da #chatsView.on desktop bloklari topilmadi');

const last = blocks[blocks.length - 1];
assert.match(last, /position:\s*fixed\s*!important/, '.view.on {position: static !important} ustidan fixed !important kerak');
assert.match(last, /var\(--center-w\)/, "ro'yxat markaz kengligidan keyin (o'ngda) turishi kerak");
assert.match(last, /z-index:\s*40\s*!important/, "ro'yxat markaz paneli (thread/pane) ustida bo'lishi kerak");
assert.doesNotMatch(last, /left:\s*var\(--sidebar\)/, "ro'yxat chap ustunga (sidebar yoniga) qaytib ketmasligi kerak");
assert.doesNotMatch(last, /--chats-w/, 'eski chap-ustun kengligi (--chats-w) ishlatilmasligi kerak');
console.log('OK: desktop chats ro\'yxati o\'ng ustunda');
