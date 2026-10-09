// Ulashilgan post kartasi: barcha fayl turlari to'g'ri aniqlanishini tekshiradi
import { readFileSync } from 'node:fs';
import { fileIconSvg } from '../modules/core/file-icons.js';

const src = readFileSync(new URL('../modules/chat/chat.js', import.meta.url), 'utf8');
const a = src.indexOf('const _CPC_IMG = ');
const b = src.indexOf('function _cpcBaseName');
if (a < 0 || b < 0) { console.error('FAIL: _cpcKind topilmadi'); process.exit(1); }
const _cpcKind = new Function(src.slice(a, b) + '\nreturn _cpcKind;')();

let fail = 0;
const eq = (got, want, label) => { if (got !== want) { fail++; console.error(`FAIL ${label}: ${got} != ${want}`); } };

// [mediaType, [names], kutilgan]
const cases = [
  ['text/plain', ['a.txt'], 'file'], ['', ['notes.txt'], 'file'], ['file', ['x.txt'], 'file'],
  ['application/pdf', ['a.pdf'], 'file'], ['', ['a.pdf'], 'file'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['a.docx'], 'file'], ['', ['a.docx'], 'file'], ['image', ['a.docx'], 'file'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['a.xlsx'], 'file'], ['', ['a.xlsx'], 'file'], ['', ['a.csv'], 'file'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', ['a.pptx'], 'file'], ['', ['a.pptx'], 'file'],
  ['application/zip', ['a.zip'], 'file'], ['', ['a.rar'], 'file'], ['', ['a.7z'], 'file'],
  ['application/octet-stream', ['a.apk'], 'file'], ['application/octet-stream', ['x'], 'file'], ['file', [''], 'file'],
  ['', ['a.json'], 'file'], ['', ['a.js'], 'file'], ['', ['a.py'], 'file'], ['', ['a.md'], 'file'],
  ['application/octet-stream', ['photo.jpg'], 'image'], ['file', ['clip.mp4'], 'video'], ['file', ['a.mp3'], 'audio'],
  ['image', ['a.jpg'], 'image'], ['image/png', ['x.png'], 'image'], ['image', [], 'image'], ['', [], 'image'], ['', ['uuid-no-ext'], 'image'],
  ['image/webp', ['p/a.webp?token=1'], 'image'],
  ['video', ['a.mp4'], 'video'], ['video/mp4', [], 'video'], ['video/webm', ['a.webm'], 'video'],
  ['audio', ['a.mp3'], 'audio'], ['voice', [], 'audio'], ['audio/webm', ['a.webm'], 'audio'],
  ['', ['https://x.supabase.co/storage/v1/object/public/media/u/a.docx?t=1'], 'file'],
  ['', [undefined, null, 'a.pdf'], 'file'],
];
for (const [mt, names, want] of cases) eq(_cpcKind(mt, names), want, `${mt} ${JSON.stringify(names)}`);

// ikonka: har qanday nom/mime bilan xatosiz SVG
for (const [n, m] of [['a.docx',''],['a.pdf',''],['a.xlsx',''],['a.pptx',''],['a.zip',''],['a.txt','text/plain'],['README',''],['',''],[undefined,undefined],['a.verylongext',''],['.hidden',''],['a.tar.gz',''],['a b (1).doc',''],['x.APK','']]) {
  const svg = fileIconSvg(n, m, 40);
  if (!/^\s*<svg[\s\S]*<\/svg>\s*$/.test(svg)) { fail++; console.error('FAIL icon', n, m); }
}
if (fail) { console.error(`${fail} ta xato`); process.exit(1); }
console.log(`OK: ${cases.length} tur holati + ikonkalar`);
