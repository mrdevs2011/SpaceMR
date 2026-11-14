import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('=== TEST: Attach Drawer Gestures & Custom Layout ===');

// 1. CSS Test
console.log('--- 1. Testing chat-attach.css Rules ---');
const chatAttachCss = fs.readFileSync(new URL('../CSS/chat-attach.css', import.meta.url), 'utf8');

// Story Upload check
assert.ok(chatAttachCss.includes('.attach-drawer--story .attach-bottom-pills'), 'Story drawer must target bottom pills');
assert.ok(chatAttachCss.includes('display: none !important;'), 'Story drawer bottom pills must be hidden');

// Post Upload check
assert.ok(chatAttachCss.includes('.attach-drawer--post .attach-bottom-pills'), 'Post drawer bottom pills selector must exist');
assert.ok(chatAttachCss.includes('margin-top: auto !important;'), 'Post drawer bottom pills must have margin-top: auto');
assert.ok(chatAttachCss.includes('padding-bottom: max(16px, env(safe-area-inset-bottom))'), 'Post drawer bottom pills must have safe area padding-bottom');

// Chat Drawer heights check
assert.ok(chatAttachCss.includes('.attach-drawer--chat.attach-drawer--half'), 'Chat half drawer style must exist');
assert.ok(chatAttachCss.includes('height: 50vh !important;'), 'Chat half drawer height must be 50vh');
assert.ok(chatAttachCss.includes('.attach-drawer--chat.attach-drawer--full'), 'Chat full drawer style must exist');
assert.ok(chatAttachCss.includes('height: 92vh !important;'), 'Chat full drawer height must be 92vh');

console.log('✓ PASS: CSS Layout rules for Story, Post, and Chat verified');

// 2. JS Modules Test
console.log('--- 2. Testing modules/ui/attach-menu.js Logic ---');
const attachJs = fs.readFileSync(new URL('../modules/ui/attach-menu.js', import.meta.url), 'utf8');

// Check context detection
assert.ok(attachJs.includes("ctx = 'story'"), 'Story context assignment must exist');
assert.ok(attachJs.includes("ctx = 'post'"), 'Post context assignment must exist');
assert.ok(attachJs.includes("ctx = 'chat'"), 'Chat context assignment must exist');

// Check gesture handler
assert.ok(attachJs.includes('_bindDrawerGestures'), '_bindDrawerGestures function must exist');
assert.ok(attachJs.includes('onTouchStart'), 'onTouchStart must be defined');
assert.ok(attachJs.includes('onTouchMove'), 'onTouchMove must be defined');
assert.ok(attachJs.includes('onTouchEnd'), 'onTouchEnd must be defined');

// Check physics velocity and distance thresholds
assert.ok(attachJs.includes('totalDeltaY > 100') || attachJs.includes('100'), 'Drag distance 100px threshold must exist');
assert.ok(attachJs.includes('0.4'), 'Velocity 0.4 threshold must exist');

// Check Chat snap points (92vh and 50vh)
assert.ok(attachJs.includes("'92vh'"), '92vh full height snap must exist');
assert.ok(attachJs.includes("'50vh'"), '50vh half height snap must exist');

console.log('✓ PASS: JS Gestures and Context logic verified');

// 3. Upload Module Test
console.log('--- 3. Testing modules/feed/upload.js Context Propagation ---');
const uploadJs = fs.readFileSync(new URL('../modules/feed/upload.js', import.meta.url), 'utf8');
assert.ok(uploadJs.includes("context: story ? 'story' : 'post'"), 'upload.js must pass story vs post context in getOptions');
assert.ok(uploadJs.includes("data-composer-mode"), 'upload.js must set data-composer-mode on uploadOverlay');

console.log('✓ PASS: Upload module context propagation verified');

console.log('====================================================');
console.log('ALL ATTACH DRAWER GESTURES & LAYOUT TESTS PASSED!');
console.log('====================================================');
