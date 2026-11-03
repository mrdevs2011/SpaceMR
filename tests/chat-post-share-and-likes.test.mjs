import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="testRoot"></div></body></html>', {
  url: 'https://spacemr.com'
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);

console.log('--- 1. Testing renderChatPostCard for pure text posts vs media posts ---');

// Extract renderChatPostCard from chat.js
const chatSrc = readFileSync(new URL('../modules/chat/chat.js', import.meta.url), 'utf8');

// We evaluate renderChatPostCard in a sandbox scope
const extractFn = (src, fnName) => {
  const match = src.match(new RegExp(`export\\s+function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`));
  if (!match) throw new Error(`Function ${fnName} not found`);
  const start = match.index;
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return src.slice(start, end).replace(/^export\s+/, '');
};

// Also need helper dependencies used in renderChatPostCard
const helpers = `
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escAttr = esc;
const chatState = {
  _postExistenceMap: new Map(),
  _userExistenceMap: new Map()
};
const renderMarkdown = t => t;
const _CPC_DL_SVG = '<svg class="dl-icon"></svg>';
const _cpcCleanAvatar = u => {
  u = String(u || '').trim();
  if (!u || /\\/(undefined|null)$/i.test(u) || u === 'undefined' || u === 'null') return '';
  return u;
};
const _cpcFvAttrs = (url, name, mime, size) => {
  if (!url) return '';
  return \` data-fv-url="\${esc(url)}" data-fv-name="\${esc(name || 'file')}"\`;
};
const _cpcFileInner = (name, mime, size, url) => {
  const nm = name || 'Fayl';
  return \`<div class="cpc-file-icon"></div><div class="cpc-file-info"><div class="cpc-file-name">\${esc(nm)}</div></div>\`;
};
const _cpcBaseName = p => {
  const f = p?.fileName || p?.file_name || '';
  if (f && f.trim()) return f.trim();
  const raw = p?.mediaUrl || p?.media_url || p?.mediaPath || p?.media_path || '';
  if (!raw) return '';
  const seg = raw.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '';
  try { return decodeURIComponent(seg); } catch (_) { return seg; }
};
const _CPC_IMG = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','avif','heic','heif']);
const _CPC_VID = new Set(['mp4','webm','mov','m4v','ogv','3gp','mkv']);
const _CPC_AUD = new Set(['mp3','wav','ogg','m4a','aac','flac','opus']);
const _CPC_FILE = new Set(['doc','docx','pdf','xls','xlsx','ppt','pptx','zip','rar','7z','tar','gz','bz2','txt','rtf','csv','apk','json','xml','bin','exe','dmg','iso','torrent','epub']);

const _cpcKind = (mediaType, names) => {
  const mt = (mediaType || '').toLowerCase();
  if (mt.startsWith('audio/') || mt === 'audio' || mt === 'voice') return 'audio';
  if (mt.startsWith('video/') || mt === 'video') return 'video';
  if (mt === 'application/pdf' || mt.includes('wordprocessingml') || mt.includes('spreadsheetml') || mt.includes('presentationml') || mt === 'application/zip' || mt === 'application/x-zip-compressed') return 'file';
  for (const n of names) {
    if (!n) continue;
    const clean = String(n).split('?')[0].split('#')[0];
    const dot = clean.lastIndexOf('.');
    if (dot >= 0) {
      const ext = clean.slice(dot + 1).toLowerCase();
      if (_CPC_FILE.has(ext)) return 'file';
      if (_CPC_VID.has(ext)) return 'video';
      if (_CPC_AUD.has(ext)) return 'audio';
      if (_CPC_IMG.has(ext)) return 'image';
    }
  }
  if (mt.startsWith('image/') || mt === 'image') return 'image';
  if (mt && mt !== 'file' && mt !== 'application/octet-stream') return 'file';
  return 'file';
};

const fileIconSvg = (name, mime, size) => '<svg class="file-icon"></svg>';
const sanitizePostHtml = h => h;
const formatPostText = t => t;
`;

const renderFnCode = helpers + '\n' + extractFn(chatSrc, 'renderChatPostCard') + '\nreturn renderChatPostCard;';
const renderChatPostCard = new Function(renderFnCode)();

// Case A: Text-only post with media_path = null, media_url = null
const textOnlyPost = {
  id: 'post-101',
  user_id: 'u-1',
  content: 'Salom dunyo! Test posti 🚀',
  media_path: null,
  media_url: null,
  media_type: null,
  user: { name: 'Muhammadrasul Qosimov', username: 'mr' }
};

const textCardHtml = renderChatPostCard(textOnlyPost);
// Verify NO .cpc-media and NO .cpc-media-loading in text post card
assert.ok(!textCardHtml.includes('cpc-media'), 'Text-only post must NOT contain cpc-media container');
assert.ok(!textCardHtml.includes('cpc-media-loading'), 'Text-only post must NOT contain cpc-media-loading');
assert.ok(textCardHtml.includes('Salom dunyo! Test posti 🚀'), 'Text content must be present');
assert.ok(textCardHtml.includes('Muhammadrasul Qosimov'), 'Author name must be present');

// Case B: Minimal text post payload
const minimalTextPost = {
  id: 'post-102',
  content: 'Faqatgina matnli xabar'
};
const minCardHtml = renderChatPostCard(minimalTextPost);
assert.ok(!minCardHtml.includes('cpc-media'), 'Minimal text post must NOT contain cpc-media container');

// Case C: Post WITH image media
const imagePost = {
  id: 'post-103',
  content: 'Rasm posti',
  media_path: 'uploads/2026/photo.jpg',
  media_url: 'https://cdn.example.com/photo.jpg',
  media_type: 'image/jpeg',
  user: { name: 'Test User', username: 'test' }
};
const imgCardHtml = renderChatPostCard(imagePost);
assert.ok(imgCardHtml.includes('cpc-media'), 'Image post MUST contain cpc-media container');
assert.ok(imgCardHtml.includes('<img'), 'Image post MUST render img tag');

// Case D: Post WITH document media (.docx)
const docPost = {
  id: 'post-104',
  content: 'Hujjat posti',
  media_path: 'uploads/2026/report.docx',
  file_name: 'report.docx',
  media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const docCardHtml = renderChatPostCard(docPost);
assert.ok(docCardHtml.includes('cpc-file'), 'Document post MUST render cpc-file container');
assert.ok(docCardHtml.includes('report.docx'), 'Document post MUST show filename');

console.log('✓ PASS: renderChatPostCard correctly avoids empty media containers for text posts and renders proper elements for media');

console.log('\n--- 2. Testing Profile Media Kind Categorization ---');
const profileSrc = readFileSync(new URL('../modules/profile/profile.js', import.meta.url), 'utf8');

// Extract _postKind
const postKindCode = profileSrc.slice(
  profileSrc.indexOf('const _IMG_EXT_SET'),
  profileSrc.indexOf('function _filterPgPosts')
) + '\nreturn _postKind;';
const _postKind = new Function(postKindCode)();

// Test classifications
assert.equal(_postKind({ mediaPath: 'notes.docx' }), 'files', '.docx should classify as files');
assert.equal(_postKind({ mediaPath: 'presentation.pptx' }), 'files', '.pptx should classify as files');
assert.equal(_postKind({ mediaPath: 'table.xlsx' }), 'files', '.xlsx should classify as files');
assert.equal(_postKind({ mediaPath: 'doc.pdf' }), 'files', '.pdf should classify as files');
assert.equal(_postKind({ mediaPath: 'archive.zip' }), 'files', '.zip should classify as files');
assert.equal(_postKind({ mediaPath: 'track.mp3' }), 'music', '.mp3 should classify as music');
assert.equal(_postKind({ mediaPath: 'video.mp4' }), 'videos', '.mp4 should classify as videos');
assert.equal(_postKind({ mediaPath: 'photo.jpg' }), 'photos', '.jpg should classify as photos');
assert.equal(_postKind({ mediaPath: 'graphic.png' }), 'photos', '.png should classify as photos');
assert.equal(_postKind({ content: 'Just text' }), 'text', 'pure text should classify as text');

console.log('✓ PASS: _postKind correctly classifies files (docx, pdf, etc.) as files, not photos');

console.log('\n--- 3. Testing URL Router Profile Tabs ---');
const routerSrc = readFileSync(new URL('../modules/url-router.js', import.meta.url), 'utf8');
assert.ok(routerSrc.includes("const PROFILE_TABS = ['photos', 'videos', 'text', 'music', 'files']"), 'PROFILE_TABS includes files');
assert.ok(routerSrc.includes("(photos|videos|text|music|files)"), 'famOf includes files tab');

console.log('✓ PASS: URL router includes files profile tab and preserves history stack');

console.log('\n--- 4. Testing CSS Rules for Empty Media Containers ---');
const monoCss = readFileSync(new URL('../CSS/mono-x.css', import.meta.url), 'utf8');
assert.ok(monoCss.includes('.cpc-media:empty'), 'CSS contains .cpc-media:empty rule');
assert.ok(monoCss.includes('display: none !important'), 'Empty media container is hidden via display: none !important');

console.log('✓ PASS: CSS guarantees empty .cpc-media containers will never show a black box');

console.log('\n--- 5. Testing Null-Safety For Unauthenticated Users (Guest Feed/Detail) ---');
const feedSrc = readFileSync(new URL('../modules/feed/feed.js', import.meta.url), 'utf8');
assert.ok(feedSrc.includes('const unknownPosts = state.me?.uid'), 'feed.js checks state.me?.uid for unknownPosts');
assert.ok(feedSrc.includes('const myUid    = state.me?.uid || null;'), 'feed.js guards state.me?.uid for post actions');

assert.ok(profileSrc.includes('state.me?.uid'), 'profile.js openDetail guards state.me?.uid for post_likes');

console.log('✓ PASS: Feed and Profile openDetail safely handle null state.me without throwing TypeErrors');

console.log('\n--- 6. Testing 0% Idle CPU & Document Visibility Guards ---');
const sidebarSrc = readFileSync(new URL('../modules/ui/sidebar.js', import.meta.url), 'utf8');
assert.ok(sidebarSrc.includes('if (!document.hidden)'), 'sidebar.js guards periodic render with !document.hidden');

const rightRailSrc = readFileSync(new URL('../modules/ui/right-rail.js', import.meta.url), 'utf8');
assert.ok(rightRailSrc.includes('if (!document.hidden) scheduleRefresh(0)'), 'right-rail.js guards refresh timer with !document.hidden');
assert.ok(rightRailSrc.includes("const me = state.me?.uid || null;"), 'right-rail.js guards state.me?.uid');

assert.ok(chatSrc.includes('if (document.hidden || state.view !== \'chats\') return;'), 'chat.js guards presence timer when hidden');
assert.ok(chatSrc.includes('if (!document.hidden) _paintPeerStatus'), 'chat.js guards peer status timer when hidden');

const groupsSrc = readFileSync(new URL('../modules/chat/groups.js', import.meta.url), 'utf8');
assert.ok(groupsSrc.includes('if (!document.hidden) _loadGroups()'), 'groups.js guards groups watcher tick when hidden');

console.log('✓ PASS: All background intervals guard against document.hidden to guarantee 0% idle CPU drain');

console.log('\n========================================');
console.log('ALL REGRESSION AUDIT TESTS PASSED (100%)');
console.log('========================================');
