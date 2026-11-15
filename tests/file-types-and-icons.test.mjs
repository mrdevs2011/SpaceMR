// tests/file-types-and-icons.test.mjs
// SpaceMR File Types & Icons Engine Test Suite
// Verifies standard, custom (asdf, xyz), multi-dot (tar.gz), uppercase, dotless, size formatting, and SVG integrity.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseFileExt,
  hashExtToColor,
  getFileTypeInfo,
  fileIconSvg,
  getFileIcon,
  getChatFileIcon,
  formatFileSize,
} from '../modules/core/file-icons.js';
import { fmtSz } from '../modules/core/utils.js';

console.log('=== TEST: SpaceMR File Types, Badges & Custom Extensions Engine ===\n');

let pass = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  pass++;
  console.log(`  ✓ ${msg}`);
};

// -----------------------------------------------------------------------------
// 1. Extension Parsing & Normalization
// -----------------------------------------------------------------------------
console.log('--- 1. Testing parseFileExt & Extension Normalization ---');

// Standard extensions
ok(parseFileExt('document.pdf').ext === 'pdf', 'Standard .pdf parsed');
ok(parseFileExt('document.DOCX').ext === 'docx', 'Uppercase .DOCX normalized to docx');
ok(parseFileExt('table.xlsx').ext === 'xlsx', 'Excel .xlsx parsed');
ok(parseFileExt('presentation.pptx').ext === 'pptx', 'PowerPoint .pptx parsed');
ok(parseFileExt('archive.zip').ext === 'zip', 'Archive .zip parsed');
ok(parseFileExt('song.mp3').ext === 'mp3', 'Audio .mp3 parsed');
ok(parseFileExt('video.mp4').ext === 'mp4', 'Video .mp4 parsed');
ok(parseFileExt('photo.png').ext === 'png', 'Image .png parsed');
ok(parseFileExt('script.js').ext === 'js', 'Code .js parsed');
ok(parseFileExt('app.py').ext === 'py', 'Python .py parsed');
ok(parseFileExt('style.css').ext === 'css', 'CSS .css parsed');

// Compound multi-dot archives
ok(parseFileExt('backup.2026.04.tar.gz').ext === 'tar.gz', 'Compound .tar.gz parsed');
ok(parseFileExt('data.tar.bz2').ext === 'tar.bz2', 'Compound .tar.bz2 parsed');
ok(parseFileExt('kernel.tar.xz').ext === 'tar.xz', 'Compound .tar.xz parsed');
ok(parseFileExt('package.tar.zst').ext === 'tar.zst', 'Compound .tar.zst parsed');

// Normal multi-dot code files
ok(parseFileExt('app.min.js').ext === 'js', 'Multi-dot app.min.js parses to js');
ok(parseFileExt('style.min.css').ext === 'css', 'Multi-dot style.min.css parses to css');

// Custom & unknown extensions
ok(parseFileExt('test.asdf').ext === 'asdf', 'Custom .asdf parsed');
ok(parseFileExt('data.xyz').ext === 'xyz', 'Custom .xyz parsed');
ok(parseFileExt('blob.custom123').ext === 'custom123', 'Custom .custom123 parsed');
ok(parseFileExt('sample.qwerty').ext === 'qwerty', 'Custom .qwerty parsed');

// Dotfiles (.gitignore, .env)
ok(parseFileExt('.gitignore').ext === 'gitignore', 'Dotfile .gitignore parsed');
ok(parseFileExt('.env').ext === 'env', 'Dotfile .env parsed');
ok(parseFileExt('.bashrc').ext === 'bashrc', 'Dotfile .bashrc parsed');

// Known dotless files
ok(parseFileExt('Dockerfile').ext === 'dockerfile', 'Dotless Dockerfile recognized');
ok(parseFileExt('Makefile').ext === 'makefile', 'Dotless Makefile recognized');
ok(parseFileExt('README').ext === 'readme', 'Dotless README recognized');
ok(parseFileExt('LICENSE').ext === 'license', 'Dotless LICENSE recognized');

// URLs with query strings and hash anchors
ok(parseFileExt('https://cdn.spacemr.com/u/report.docx?token=abc#page=2').ext === 'docx', 'URL with query params parses to docx');
ok(parseFileExt('https://supabase.co/storage/v1/object/public/media/u/photo%20(1).pdf?t=123').ext === 'pdf', 'URL with encoded spaces parses to pdf');

// Mime fallback when name has no extension
ok(parseFileExt('unknown_file', 'application/pdf').ext === 'pdf', 'Mime fallback application/pdf');
ok(parseFileExt('', 'application/json').ext === 'json', 'Mime fallback application/json');
ok(parseFileExt(null, 'image/webp').ext === 'webp', 'Mime fallback image/webp');

// Null and empty safety
ok(parseFileExt('').ext === '', 'Empty string gives empty ext');
ok(parseFileExt(null).ext === '', 'Null gives empty ext');
ok(parseFileExt(undefined).ext === '', 'Undefined gives empty ext');

// -----------------------------------------------------------------------------
// 2. Deterministic Color Hashing for Custom File Types
// -----------------------------------------------------------------------------
console.log('\n--- 2. Testing Deterministic Color Hashing for Custom Types ---');

const colorAsdf = hashExtToColor('asdf');
const colorAsdfUpper = hashExtToColor('ASDF');
ok(colorAsdf.startsWith('#') && colorAsdf.length === 7, `Valid hex color generated for .asdf: ${colorAsdf}`);
ok(colorAsdf === colorAsdfUpper, 'hashExtToColor is case-insensitive');

const colorXyz = hashExtToColor('xyz');
ok(colorXyz.startsWith('#'), `Valid hex color generated for .xyz: ${colorXyz}`);

ok(hashExtToColor('') === '#64748b', 'Empty extension defaults to neutral slate (#64748b)');

// -----------------------------------------------------------------------------
// 3. File Size Formatting (fmtSz / formatFileSize)
// -----------------------------------------------------------------------------
console.log('\n--- 3. Testing File Size Formatting (fmtSz) ---');

ok(fmtSz(0) === '0 B', '0 bytes -> 0 B');
ok(fmtSz(null) === '0 B', 'null -> 0 B');
ok(fmtSz(undefined) === '0 B', 'undefined -> 0 B');
ok(fmtSz(NaN) === '0 B', 'NaN -> 0 B');
ok(fmtSz(-50) === '0 B', 'negative -> 0 B');
ok(fmtSz(500) === '500 B', '500 bytes -> 500 B');
ok(fmtSz(1024) === '1.0 KB', '1024 bytes -> 1.0 KB');
ok(fmtSz(25088) === '24.5 KB', '25088 bytes -> 24.5 KB');
ok(fmtSz(10240) === '10 KB', '10240 bytes -> 10 KB');
ok(fmtSz(1048576) === '1.0 MB', '1048576 bytes -> 1.0 MB');
ok(fmtSz(1258291) === '1.2 MB', '1258291 bytes -> 1.2 MB');
ok(fmtSz(10485760) === '10 MB', '10485760 bytes -> 10 MB');
ok(fmtSz(1073741824) === '1.0 GB', '1073741824 bytes -> 1.0 GB');
ok(formatFileSize(25088) === '24.5 KB', 'formatFileSize re-export behaves identically');

// -----------------------------------------------------------------------------
// 4. File Type Resolution (getFileTypeInfo)
// -----------------------------------------------------------------------------
console.log('\n--- 4. Testing getFileTypeInfo Resolution ---');

// Standard files
const pdfInfo = getFileTypeInfo('contract.pdf');
ok(pdfInfo.label === 'PDF' && pdfInfo.color === '#ef4444' && pdfInfo.icon === 'pdf' && !pdfInfo.isCustom, 'PDF info resolved');

const docxInfo = getFileTypeInfo('essay.docx');
ok(docxInfo.label === 'DOCX' && docxInfo.color === '#2563eb' && docxInfo.icon === 'doc', 'DOCX info resolved');

const xlsxInfo = getFileTypeInfo('budget.xlsx');
ok(xlsxInfo.label === 'XLSX' && xlsxInfo.color === '#16a34a' && xlsxInfo.icon === 'sheet', 'XLSX info resolved');

const pptxInfo = getFileTypeInfo('slides.pptx');
ok(pptxInfo.label === 'PPTX' && pptxInfo.color === '#ea580c' && pptxInfo.icon === 'slide', 'PPTX info resolved');

const zipInfo = getFileTypeInfo('files.zip');
ok(zipInfo.label === 'ZIP' && zipInfo.color === '#ca8a04' && zipInfo.icon === 'zip', 'ZIP info resolved');

const tarGzInfo = getFileTypeInfo('archive.tar.gz');
ok(tarGzInfo.label === 'TGZ' && tarGzInfo.icon === 'zip', 'tar.gz resolved to TGZ');

const apkInfo = getFileTypeInfo('SpaceMR.apk');
ok(apkInfo.label === 'APK' && apkInfo.icon === 'app', 'APK info resolved');

// Code files
const jsInfo = getFileTypeInfo('index.js');
ok(jsInfo.label === 'JS' && jsInfo.icon === 'code', 'JS info resolved');

const pyInfo = getFileTypeInfo('main.py');
ok(pyInfo.label === 'PY' && pyInfo.icon === 'code', 'PY info resolved');

// Custom & unknown files
const asdfInfo = getFileTypeInfo('test.asdf');
ok(asdfInfo.label === 'ASDF', 'Custom file.asdf label is ASDF');
ok(asdfInfo.isCustom === true, 'Custom file.asdf marked as isCustom');
ok(asdfInfo.icon === 'doc', 'Custom file.asdf uses universal doc icon');
ok(asdfInfo.color.startsWith('#'), 'Custom file.asdf has valid color');

const xyzInfo = getFileTypeInfo('data.xyz');
ok(xyzInfo.label === 'XYZ' && xyzInfo.isCustom === true, 'Custom data.xyz resolved');

const customLong = getFileTypeInfo('blob.custom123');
ok(customLong.label === 'CUSTO' && customLong.isCustom === true, 'Custom long extension gracefully capped to 5 chars');

// Dotless files
const dockerInfo = getFileTypeInfo('Dockerfile');
ok(dockerInfo.label === 'DOCK' && dockerInfo.icon === 'code', 'Dockerfile resolved');

const readmeInfo = getFileTypeInfo('README');
ok(readmeInfo.label === 'TXT' && readmeInfo.icon === 'doc', 'README resolved');

const noExtInfo = getFileTypeInfo('mystery_document');
ok(noExtInfo.label === 'FILE' && noExtInfo.color === '#64748b', 'Dotless document falls back to FILE');

// -----------------------------------------------------------------------------
// 5. SVG Vector Markup Integrity (fileIconSvg)
// -----------------------------------------------------------------------------
console.log('\n--- 5. Testing SVG Vector Markup Integrity ---');

const testCases = [
  ['document.pdf', ''],
  ['notes.docx', ''],
  ['data.xlsx', ''],
  ['slides.pptx', ''],
  ['backup.tar.gz', ''],
  ['file.asdf', ''],
  ['custom.xyz', ''],
  ['README', ''],
  ['', ''],
  [null, null],
  [undefined, undefined],
  ['UPPER.CASE.PNG', ''],
  ['long_filename_with_many_words_test.asdf', 'application/octet-stream'],
];

for (const [n, m] of testCases) {
  const svg = fileIconSvg(n, m, 40);
  ok(typeof svg === 'string', `fileIconSvg returns string for ${n}`);
  ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `Well-formed <svg>...</svg> for ${n}`);
  ok(svg.includes('class="file-type-icon"'), `Has class="file-type-icon" for ${n}`);
  ok(svg.includes('viewBox="0 0 48 48"'), `Has viewBox="0 0 48 48" for ${n}`);
  ok(svg.includes('width="40" height="40"'), `Has width="40" height="40" for ${n}`);
  ok(!svg.includes('undefined'), `Contains no undefined for ${n}`);
  ok(!svg.includes('NaN'), `Contains no NaN for ${n}`);
  ok(!svg.includes('null'), `Contains no null for ${n}`);
}

// Check custom badge text appears inside the SVG
const svgAsdf = fileIconSvg('file.asdf', '', 48);
ok(svgAsdf.includes('>ASDF<'), 'SVG contains >ASDF< text');
ok(svgAsdf.includes(asdfInfo.color), 'SVG contains matching color ribbon');

const svgXyz = fileIconSvg('file.xyz', '', 48);
ok(svgXyz.includes('>XYZ<'), 'SVG contains >XYZ< text');

// Size parameter check
ok(getFileIcon('file.asdf').includes('width="48" height="48"'), 'getFileIcon produces 48px SVG');
ok(getChatFileIcon('file.asdf').includes('width="40" height="40"'), 'getChatFileIcon produces 40px SVG');

// -----------------------------------------------------------------------------
// 6. Component Integration Verification
// -----------------------------------------------------------------------------
console.log('\n--- 6. Testing Component Integration ---');

// A. Chat Message Bubble (modules/chat/components/message-bubble.js)
const { generateFileBubble } = await import('../modules/chat/components/message-bubble.js');

const customMsg = {
  id: 'msg_custom_1',
  type: 'file',
  fileName: 'file.asdf',
  fileSize: 25088,
  mediaUrl: 'https://cdn.spacemr.com/u/file.asdf',
  mediaType: 'application/octet-stream',
  status: 'sent',
};
const customBubble = generateFileBubble({
  m: customMsg,
  fname: 'file.asdf',
  fsz: fmtSz(customMsg.fileSize),
  safeUrl: customMsg.mediaUrl,
  _isImage: false,
  hasCaption: false,
  captionHtml: '',
  time: '12:30',
  mine: true,
  renderTicks: () => '✓✓',
});

ok(customBubble.bubbleContent.includes('cfm-icon'), 'Bubble contains .cfm-icon container');
ok(customBubble.bubbleContent.includes('file-type-icon'), 'Bubble contains file-type-icon SVG');
ok(customBubble.bubbleContent.includes('>ASDF<'), 'Bubble contains custom ASDF badge');
ok(customBubble.bubbleContent.includes('24.5 KB'), 'Bubble displays formatted file size (24.5 KB)');
ok(customBubble.bubbleContent.includes('file.asdf'), 'Bubble displays file name');

// B. Ulashilgan Post Kartasi (modules/chat/chat.js _cpcKind)
const chatJsSrc = readFileSync(new URL('../modules/chat/chat.js', import.meta.url), 'utf8');
const a = chatJsSrc.indexOf('const _CPC_IMG = ');
const b = chatJsSrc.indexOf('function _cpcBaseName');
assert.ok(a > 0 && b > a, '_cpcKind function must exist in chat.js');
const _cpcKind = new Function(chatJsSrc.slice(a, b) + '\nreturn _cpcKind;')();

ok(_cpcKind('', ['file.asdf']) === 'file', '_cpcKind identifies file.asdf as file');
ok(_cpcKind('application/octet-stream', ['data.xyz']) === 'file', '_cpcKind identifies data.xyz as file');
ok(_cpcKind('application/octet-stream', ['backup.tar.gz']) === 'file', '_cpcKind identifies backup.tar.gz as file');

// C. Profile _postKind (modules/profile/profile.js)
const profileSrc = readFileSync(new URL('../modules/profile/profile.js', import.meta.url), 'utf8');
const pA = profileSrc.indexOf('const _IMG_EXT_SET = ');
const pB = profileSrc.indexOf('function _filterPgPosts');
assert.ok(pA > 0 && pB > pA, '_postKind must exist in profile.js');
const _postKind = new Function(profileSrc.slice(pA, pB) + '\nreturn _postKind;')();

ok(_postKind({ fileName: 'file.asdf' }) === 'files', 'Profile routes file.asdf to files tab');
ok(_postKind({ fileName: 'data.xyz' }) === 'files', 'Profile routes data.xyz to files tab');
ok(_postKind({ fileName: 'README' }) === 'files', 'Profile routes dotless README to files tab');
ok(_postKind({ fileName: 'backup.tar.gz' }) === 'files', 'Profile routes backup.tar.gz to files tab');

// D. Chat Media Files Tab (modules/chat/chat-media.js)
const chatMediaSrc = readFileSync(new URL('../modules/chat/chat-media.js', import.meta.url), 'utf8');
ok(!chatMediaSrc.includes('icon-e3ece82ff84d.svg'), 'Rogue static file icon removed from chat-media.js');
ok(chatMediaSrc.includes('getChatFileIcon(m.fileName, m.mediaType)'), 'Chat media files tab uses canonical getChatFileIcon');

// E. Feed file sub info (modules/feed/feed.js)
const feedSrc = readFileSync(new URL('../modules/feed/feed.js', import.meta.url), 'utf8');
ok(feedSrc.includes('getFileTypeInfo(p.fileName'), 'Feed uses getFileTypeInfo to compute exact file badge label');

console.log(`\n====================================================`);
console.log(`ALL FILE TYPES & ICONS ENGINE TESTS PASSED! (${pass} assertions)`);
console.log(`====================================================`);
process.exit(0);
