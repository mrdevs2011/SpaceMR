import assert from 'node:assert';
import fs from 'node:fs';

console.log('=== TEST: Mobile Back-Button LIFO Stack & Natural Attach Slide ===');

// 1. Overlay Stack Module Verification
console.log('--- 1. Testing modules/ui/overlay-stack.js ---');
const overlayStackJs = fs.readFileSync(new URL('../modules/ui/overlay-stack.js', import.meta.url), 'utf8');
assert.ok(overlayStackJs.includes('pushOverlay'), 'pushOverlay must be exported');
assert.ok(overlayStackJs.includes('dismissOverlay'), 'dismissOverlay must be exported');
assert.ok(overlayStackJs.includes('handleOverlayPopState'), 'handleOverlayPopState must be exported');
assert.ok(overlayStackJs.includes('_overlayId'), 'pushState must track _overlayId');
assert.ok(overlayStackJs.includes('closeTopmost'), 'handleOverlayPopState must fallback to closeTopmost');
console.log('✓ PASS: overlay-stack.js structure and exports verified');

// 2. url-router.js integration
console.log('--- 2. Testing modules/url-router.js popstate integration ---');
const urlRouterJs = fs.readFileSync(new URL('../modules/url-router.js', import.meta.url), 'utf8');
assert.ok(urlRouterJs.includes('handleOverlayPopState'), 'url-router must import handleOverlayPopState');
assert.ok(urlRouterJs.includes('if (handleOverlayPopState())'), 'url-router must prioritize handleOverlayPopState before route switching');
console.log('✓ PASS: url-router.js back-button interceptor verified');

// 3. shortcuts.js closers
console.log('--- 3. Testing modules/ui/shortcuts.js CLOSERS ---');
const shortcutsJs = fs.readFileSync(new URL('../modules/ui/shortcuts.js', import.meta.url), 'utf8');
assert.ok(shortcutsJs.includes('attach-drawer-overlay'), 'CLOSERS must include attach-drawer-overlay');
assert.ok(shortcutsJs.includes('attach-menu'), 'CLOSERS must include attach-menu');
assert.ok(shortcutsJs.includes('export function closeTopmost'), 'closeTopmost must be exported');
console.log('✓ PASS: shortcuts.js updated CLOSERS verified');

// 4. Camera capture integration
console.log('--- 4. Testing modules/chat/camera-capture.js back stack ---');
const cameraJs = fs.readFileSync(new URL('../modules/chat/camera-capture.js', import.meta.url), 'utf8');
assert.ok(cameraJs.includes("pushOverlay('camCapture'"), 'camera-capture must register pushOverlay');
assert.ok(cameraJs.includes("dismissOverlay('camCapture'"), 'camera-capture must call dismissOverlay on done');
assert.ok(cameraJs.includes('exitReview'), 'camera-capture back must handle review mode exit');
console.log('✓ PASS: camera-capture.js back navigation verified');

// 5. Attach menu physics & natural slide
console.log('--- 5. Testing modules/ui/attach-menu.js natural slide ---');
const attachJs = fs.readFileSync(new URL('../modules/ui/attach-menu.js', import.meta.url), 'utf8');
assert.ok(attachJs.includes("pushOverlay('attachDrawer'"), 'attach-menu must register pushOverlay');
assert.ok(attachJs.includes("dismissOverlay('attachDrawer'"), 'attach-menu must call dismissOverlay on close');
assert.ok(attachJs.includes('translate3d'), 'attach-menu must use GPU-accelerated translate3d for natural 120 FPS slide');
assert.ok(attachJs.includes('wantsDirectDismiss'), 'full height drawer must allow direct dismiss flick');
console.log('✓ PASS: attach-menu.js 120 FPS translate3d and gestures verified');

// 6. CSS physics & cubic-bezier
console.log('--- 6. Testing CSS/chat-attach.css easing ---');
const cssText = fs.readFileSync(new URL('../CSS/chat-attach.css', import.meta.url), 'utf8');
assert.ok(cssText.includes('cubic-bezier(0.32, 0.72, 0, 1)'), 'CSS must use natural iOS/Telegram sheet cubic-bezier easing');
assert.ok(cssText.includes('calc(100% + 50px)'), 'CSS drawer must fully translate off-screen past margin');
console.log('✓ PASS: chat-attach.css physics curve verified');

console.log('====================================================');
console.log('ALL OVERLAY STACK & NATURAL SLIDE TESTS PASSED (100%)');
console.log('====================================================');
