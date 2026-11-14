/**
 * tests/chat-media-features.test.mjs
 * SpaceMR — Chat Media, Upload Queue, Quiz Polls & Smart Maps Regression Test Suite.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('--- 1. Testing Compact Number Formatting ---');
import { formatCompactNumber } from '../modules/feed/stories.js';
assert.equal(formatCompactNumber(0), '0');
assert.equal(formatCompactNumber(5), '5');
assert.equal(formatCompactNumber(999), '999');
assert.equal(formatCompactNumber(1000), '1k');
assert.equal(formatCompactNumber(1200), '1.2k');
assert.equal(formatCompactNumber(10500), '10k');
assert.equal(formatCompactNumber(100000), '100k');
assert.equal(formatCompactNumber(1000000), '1M');
assert.equal(formatCompactNumber(2500000), '2.5M');
console.log('✓ PASS: formatCompactNumber produces compact, clean strings');

console.log('--- 2. Testing Telegram Upload Ring SVG HTML ---');
import { renderUploadRingHtml } from '../modules/chat/chat-upload-queue.js';
const ringHtml = renderUploadRingHtml('test_upload_1', 45, false);
assert.ok(ringHtml.includes('class="chat-upload-ring'));
assert.ok(ringHtml.includes('data-upload-id="test_upload_1"'));
assert.ok(ringHtml.includes('cur-fill'));
assert.ok(ringHtml.includes('cur-cancel'));
assert.ok(ringHtml.includes('45%'));
console.log('✓ PASS: renderUploadRingHtml renders SVG circular ring and cancel button');

console.log('--- 3. Testing Confirm Card Highest Z-Index (2147483647) ---');
const monoCss = readFileSync(resolve('CSS/mono-x.css'), 'utf8');
const appsCss = readFileSync(resolve('CSS/apps.css'), 'utf8');
const featCss = readFileSync(resolve('CSS/features.css'), 'utf8');
const utilsJs = readFileSync(resolve('modules/core/utils.js'), 'utf8');

assert.ok(monoCss.includes('#confirmOverlay') && monoCss.includes('2147483647'));
assert.ok(appsCss.includes('#confirmOverlay') && appsCss.includes('2147483647'));
assert.ok(featCss.includes('#confirmOverlay') && featCss.includes('2147483647'));
assert.ok(utilsJs.includes('confirmOverlay.style.zIndex = \'2147483647\''));
console.log('✓ PASS: Confirm overlay has maximum z-index (2147483647) across all CSS and JS');

console.log('--- 4. Testing Camera Capture Default Front Camera ---');
const camCapJs = readFileSync(resolve('modules/chat/camera-capture.js'), 'utf8');
assert.ok(camCapJs.includes(`s0 = await _startStream(null, 'user')`));
assert.ok(!camCapJs.includes(`s0 = await _startStream(null, 'environment')\n      catch`));
console.log('✓ PASS: Camera capture defaults to front camera (user)');

console.log('--- 5. Testing SpaceMR Blue Text Selection ---');
const baseCss = readFileSync(resolve('CSS/base.css'), 'utf8');
assert.ok(baseCss.includes('::selection'));
assert.ok(baseCss.includes('var(--x-blue, #1d9bf0) !important'));
console.log('✓ PASS: Universal text selection color is SpaceMR blue');

console.log('--- 6. Testing Desktop Message Text Selectable ---');
assert.ok(baseCss.includes('html.is-desktop'));
assert.ok(monoCss.includes('html.is-desktop #chatThreadMessages:not(.msg-selecting) .chat-bubble-text'));
assert.ok(monoCss.includes('user-select: text !important'));
console.log('✓ PASS: Desktop message text is cleanly selectable');

console.log('--- 7. Testing Smart Map Routing in Location Helper ---');
import { openSmartMapLocation } from '../modules/ui/location-helper.js';
assert.equal(typeof openSmartMapLocation, 'function');
console.log('✓ PASS: openSmartMapLocation is properly exported');

console.log('====================================================');
console.log('ALL CHAT MEDIA & UI REGRESSION CHECKS PASSED (100%)');
console.log('====================================================');
