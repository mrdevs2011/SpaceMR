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

console.log('--- 8. Testing Poll Parser for Raw/Voted Payloads ---');
import { parsePoll } from '../modules/chat/chat-shared.js';
// Payload exactly as shown in user screenshot (missing __poll)
const leakedPayload = '{"id":"poll_1794639021132_4we8m","question":"Olamning rangi qanday","options":[{"id":"opt_0","text":"Oq","voters":["941ae96e-afa3-4440-98ee-0be10e8923d1"]},{"id":"opt_1","text":"Sariq","voters":[]},{"id":"opt_2","text":"Yashil","voters":[]},{"id":"opt_3","text":"Qizil","voters":[]}],"anonymous":true,"multiple":false,"isQuiz":false,"correctOptionId":null,"explanation":"","totalVotes":1,"creatorId":"941ae96e-afa3-4440-98ee-0be10e8923d1"}';
const parsedPoll = parsePoll(leakedPayload);
assert.ok(parsedPoll, 'parsePoll should successfully parse payload lacking __poll');
assert.equal(parsedPoll.__poll, true, 'parsed poll must guarantee __poll: true');
assert.equal(parsedPoll.question, 'Olamning rangi qanday');
assert.equal(parsedPoll.options.length, 4);
assert.equal(parsedPoll.totalVotes, 1);
console.log('✓ PASS: parsePoll successfully parses legacy/voted payloads and guarantees __poll: true');

console.log('--- 9. Testing Location Bubble Meta & Click Handlers ---');
import { generateLocationBubble } from '../modules/chat/components/message-bubble.js';
const locBubble = generateLocationBubble({
  loc: { lat: 40.7833, lon: 72.3500, title: "Oltinko'l tumani", address: "Oltinko'l, Andijon viloyati, O'zbekiston" },
  m: { id: 'm1', status: 'read' },
  time: '11:40',
  mine: true,
  renderTicks: () => '✓✓',
  dm: true,
});
assert.ok(locBubble.bubbleContent.includes('loc-bubble-card'));
assert.ok(locBubble.bubbleContent.includes('loc-btn-view'));
assert.ok(locBubble.bubbleContent.includes('loc-btn-start'));
assert.ok(!locBubble.bubbleContent.includes("title: 'Oltinko'l"), 'Should never contain unescaped single quotes inside inline JS string');
assert.ok(locBubble.bubbleContent.includes('window.__openSmartMap'));
console.log('✓ PASS: Location bubble renders safely without quote escaping errors and binds smart maps');

console.log('====================================================');
console.log('ALL CHAT MEDIA & UI REGRESSION CHECKS PASSED (100%)');
console.log('====================================================');
process.exit(0);
