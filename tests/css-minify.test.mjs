/* CSS minify to'g'riligi: minified app.css har bir qoidada (selektor + deklaratsiya) asl (siqilmagan) bilan bir xil bo'lishi shart.
   Ishlatish: node tests/css-minify.test.mjs [minified.css] [full.css]   (default: app.css va build-css natijasi) */
import { readFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const csstree = require('css-tree');
const [minFile = 'app.css', fullFile] = process.argv.slice(2);
let full;
if (fullFile) full = readFileSync(fullFile, 'utf8');
else { copyFileSync('app.css', '/tmp/_min.css'); execFileSync('node', ['scripts/build-css.mjs'], { stdio: 'ignore' }); full = readFileSync('app.css', 'utf8'); copyFileSync('/tmp/_min.css', 'app.css'); }
const min = readFileSync(minFile, 'utf8');
const nz = s => String(s).replace(/(--[\w-]+)\s*:\s*/g, '$1:').replace(/\s*([,;{}])\s*/g, '$1').replace(/\s+/g, ' ').trim();   // faqat { } ; , atrofi va takroriy bo'shliq e'tiborsiz
/* css-tree AST'dan qayta chiqarilgan matn: descendant kombinator (bo'shliq) yo'qolsa yoki calc() buzilsa — farq chiqadi */
const flat = css => csstree.parse(css, { parseValue: true, parseRulePrelude: true }).children.toArray().map(n => nz(csstree.generate(n)));
const stripC = c => c.replace(/\/\*[\s\S]*?\*\//g, '');   // izohlar siqishda olib tashlanadi
const A = flat(stripC(full)), B = flat(min);
let bad = 0;
if (A.length !== B.length) { console.error(`FAIL: qoidalar soni ${A.length} != ${B.length}`); bad++; }
for (let i = 0; i < Math.min(A.length, B.length) && bad < 8; i++) if (A[i] !== B[i]) { bad++; console.error(`FAIL qoida #${i}\n  asl: ${A[i].slice(0, 160)}\n  min: ${B[i].slice(0, 160)}`); }
console.log(bad ? `${bad} xato` : `OK: ${A.length} qoida bir xil`); process.exit(bad ? 1 : 0);
