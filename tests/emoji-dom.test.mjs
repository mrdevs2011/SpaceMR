/* emoji-dom.js sinovi (jsdom): ekrandagi emoji -> PNG, tokenlar, o'tkazib yuboriladigan joylar, cheksiz sikl yo'qligi.
   Ishlatish: node tests/emoji-dom.test.mjs */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://spacemr.vercel.app/' });
for (const k of ['window', 'document', 'NodeFilter', 'MutationObserver', 'Node', 'Image', 'Event']) globalThis[k] = dom.window[k];
const { initEmojiDom, dropPartialToken, convertTree } = await import('../modules/ui/emoji-dom.js');
const { failedKeys, encodeForSend, decodeEmojiText } = await import('../modules/ui/emoji-img.js');

const FIRE = String.fromCodePoint(0x1f525), LAUGH = String.fromCodePoint(0x1f602), HEART = '\u2764\uFE0F';
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', THUMB = '\u{1F44D}\u{1F3FD}', FLAG = '\u{1F1FA}\u{1F1FF}', KEYCAP = '1\uFE0F\u20E3';
let n = 0, fails = 0;
const eq = (name, got, want) => { n++; if (got !== want) { fails++; console.error(`FAIL ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); } };
const body = document.body;
const mk = (html) => { const d = document.createElement('div'); d.innerHTML = html; body.appendChild(d); return d; };
const keys = (el) => [...el.querySelectorAll('img.emo-img')].map(i => i.dataset.key);
const tick = () => new Promise(r => setTimeout(r, 0));

// 1) boshlang'ich DOM
const a = mk(`<p>Salom ${LAUGH} dunyo</p><p>[[emoji/2d/1f525.png]] ${HEART}</p><p>${FAMILY}${THUMB}${FLAG}${KEYCAP}</p>`);
initEmojiDom(body); await tick();
eq('belgi', keys(a).slice(0, 1).join(), '1f602');
eq('hammasi', keys(a).join(), '1f602,1f525,2764,1f468-200d-1f469-200d-1f467,1f44d-1f3fd,1f1fa-1f1ff,31-20e3');
eq('matn saqlanadi', a.firstChild.textContent.replace(/\s+/g, ' '), 'Salom  dunyo'.replace('  ', ' ') );   // rasm matn qo'shmaydi (alt orqali nusxalanadi)
eq('src', a.querySelector('img').getAttribute('src'), '/emoji/2d/1f602.png');
eq('alt = belgi (nusxalash uchun)', a.querySelector('img').alt, LAUGH);

// 2) keyin qo'shilgan tugun (observer)
const b = mk(`<span>Yangi ${FIRE}</span>`); await tick();
eq('observer: qo\'shilgan', keys(b).join(), '1f525');
// 3) matn o'zgarishi (characterData / textContent)
const c = mk('<span>x</span>'); await tick(); c.firstChild.textContent = `endi ${LAUGH}`; await tick();
eq('textContent yangilanishi', keys(c).join(), '1f602');
c.firstChild.textContent = 'toza'; await tick();
eq('qayta yozish (emoji yo\'q)', c.textContent, 'toza');

// 4) o'tkazib yuboriladi
const d = mk(`<textarea>${FIRE}</textarea><input value="${FIRE}"><div contenteditable="true">${FIRE}</div><div data-no-emo>${FIRE}</div><script>var a="${FIRE}"</script><style>.x::after{content:"${FIRE}"}</style>`); await tick();
eq('input/textarea/contenteditable/no-emo tegilmaydi', keys(d).length, 0);
eq('textarea qiymati', d.querySelector('textarea').value, FIRE);

// 5) oddiy belgilar va raqamlar tegilmaydi
const e = mk('<p>© 2026 SpaceMR® ™ 123 #1 *2 a-b [x] [[1]]</p>'); await tick();
eq('oddiy belgilar', keys(e).length, 0); eq('oddiy matn', e.textContent, '© 2026 SpaceMR® ™ 123 #1 *2 a-b [x] [[1]]');

// 6) kesilgan token
eq('partial 1', dropPartialToken('Salom [[emoji/2d/1f5'), 'Salom ');
eq('partial 2', dropPartialToken('Salom [[emoji/2d/1f525.pn'), 'Salom ');
eq('partial 3', dropPartialToken('Salom [[emoji/2d/1f525.png]'), 'Salom ');
eq('partial 4', dropPartialToken('[[emoji/2d/'), '');
eq('to\'liq token tegilmaydi', dropPartialToken('a [[emoji/2d/1f525.png]]'), 'a [[emoji/2d/1f525.png]]');
eq('begona [[', dropPartialToken('ro\'yxat [[nota'), 'ro\'yxat [[nota');
const f = mk('<span>Salom [[emoji/2d/1f525.png]] va [[emoji/2d/1f5</span>'); await tick();
eq('kesilgan token DOMda', f.textContent, 'Salom  va '); eq('kesilgan token: 1 rasm', keys(f).join(), '1f525');

// 7) yaroqsiz token tegilmaydi (XSS / path traversal)
const g = mk('<span>[[emoji/2d/../../x.png]] [[emoji/2d/<img>.png]]</span>'); await tick();
eq('yaroqsiz token', keys(g).length, 0);

// 8) rasm yuklanmasa: belgiga qaytadi va qayta rasmga aylanmaydi (sikl yo'q)
const h = mk(`<span>${LAUGH}</span>`); await tick();
const im = h.querySelector('img'); im.dispatchEvent(new dom.window.Event('error'));
await tick(); await tick();
eq('xato -> belgi', h.textContent, LAUGH); eq('xato -> rasm emas', keys(h).length, 0); eq('failedKeys', failedKeys.has('1f602'), true);

// 9) xabar yuborish yordamchilari
eq('encode', encodeForSend(`Salom ${FIRE}`), 'Salom [[emoji/2d/1f525.png]]');
eq('encode ZWJ', encodeForSend(FAMILY), '[[emoji/2d/1f468-200d-1f469-200d-1f467.png]]');
eq('decode', decodeEmojiText('a [[emoji/2d/1f525.png]] b'), `a ${FIRE} b`);
eq('encode->decode', decodeEmojiText(encodeForSend(`x ${HEART} ${THUMB}`)), `x ${HEART.replace('\uFE0F', '')} ${THUMB}`);
const many = FIRE.repeat(300);   // 300 ta emoji: token ko'rinishi > 5000 belgi -> belgi bilan yuboriladi
eq('5000 cheklov: belgi bilan', encodeForSend(many), many);
eq('5000 ichida: token', encodeForSend(FIRE.repeat(100)).startsWith('[[emoji/2d/1f525.png]]'), true);
eq('oddiy matn o\'zgarmaydi', encodeForSend('salom'), 'salom');

console.log(`${n - fails}/${n} OK`); process.exit(fails ? 1 : 0);
