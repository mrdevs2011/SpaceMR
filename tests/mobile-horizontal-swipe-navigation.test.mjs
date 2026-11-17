import assert from 'node:assert';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

console.log('=== TEST: Telegram-Style Physical Horizontal Swipe Navigation Engine ===');

// 1. File verification & CSS compilation
console.log('--- 1. Testing CSS Rules & Compiled app.css ---');
const motionCss = fs.readFileSync(new URL('../CSS/motion.css', import.meta.url), 'utf8');
const appCss = fs.readFileSync(new URL('../app.css', import.meta.url), 'utf8');

assert.ok(motionCss.includes('-15px 0 35px rgba(0, 0, 0, 0.5)'), 'motion.css must define natural left-edge shadow');
assert.ok(motionCss.includes('cubic-bezier(0.32, 0.72, 0, 1)'), 'motion.css must define natural cubic-bezier physics easing');
assert.ok(motionCss.includes('swiping-horizontal'), 'motion.css must define swiping-horizontal class');
assert.ok(motionCss.includes('swipe-dismissing'), 'motion.css must define swipe-dismissing class');
assert.ok(motionCss.includes('swipe-snapping'), 'motion.css must define swipe-snapping class');

assert.ok(appCss.includes('-15px 0 35px rgba(0,0,0,0.5)') || appCss.includes('-15px 0 35px rgba(0, 0, 0, 0.5)'), 'compiled app.css must contain shadow');
assert.ok(appCss.includes('cubic-bezier(0.32,0.72,0,1)') || appCss.includes('cubic-bezier(0.32, 0.72, 0, 1)'), 'compiled app.css must contain cubic-bezier physics');
console.log('✓ PASS: CSS physics and shadow styles verified');

// 2. Testing modules/ui/swipe-navigation.js Structure & Main Tabs Sequence
console.log('--- 2. Testing Main Tabs Order and Exports ---');
const dom = new JSDOM('<!doctype html><html><body>' +
  '<div id="app">' +
  '  <div class="view on" id="homeView"></div>' +
  '  <div class="view" id="chatsView"></div>' +
  '  <div class="view" id="savedView"></div>' +
  '  <div class="view" id="profileView"></div>' +
  '  <div id="chatThreadModal">' +
  '    <div class="chat-thread-hdr"><button id="chatThreadBack"></button></div>' +
  '    <div class="chat-thread-messages" id="chatThreadMessages">' +
  '      <div class="chat-msg" data-msg-id="m1"><div class="chat-bubble">Salom</div></div>' +
  '    </div>' +
  '    <div class="chat-thread-input-row" id="chatThreadInputRow">' +
  '      <textarea id="chatThreadInput"></textarea>' +
  '    </div>' +
  '  </div>' +
  '  <div id="grpInfoOverlay"><button id="grpInfoCloseBtn"></button></div>' +
  '  <div id="settingsOverlay"><button id="closeSettingsBtn"></button></div>' +
  '</div>' +
  '</body></html>', {
  url: 'https://spacemr.mrdevs.com/home'
});

const mockFetch = async () => ({ ok: true, json: async () => ({}) });
dom.window.fetch = mockFetch;
globalThis.fetch = mockFetch;
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', maxTouchPoints: 5 }, configurable: true }); } catch (_) {}
globalThis.innerWidth = 360;
globalThis.innerHeight = 800;
globalThis.window.matchMedia = () => ({ matches: false });

const swipeModule = await import('../modules/ui/swipe-navigation.js');
assert.ok(typeof swipeModule.initSwipeNavigation === 'function', 'initSwipeNavigation must be exported');
assert.deepStrictEqual(swipeModule.MAIN_TABS, ['home', 'chats', 'saved', 'profile'], 'MAIN_TABS must be home <-> chats <-> saved <-> profile');
console.log('✓ PASS: Main tabs sequence (home <-> chats <-> saved <-> profile) verified');

// 3. Testing Overlay Guards and Horizontal Scrollable Detection
console.log('--- 3. Testing Overlays and Scrollable Container Guards ---');
assert.strictEqual(swipeModule.hasAnyOverlayOpen(), false, 'Initially no overlay open');

const chatModal = document.getElementById('chatThreadModal');
chatModal.classList.add('show');
assert.strictEqual(swipeModule.hasAnyOverlayOpen(), true, 'hasAnyOverlayOpen must return true when chatThreadModal is shown');
chatModal.classList.remove('show');

// Stories / Carousel scrollable container check
const storyContainer = document.createElement('div');
storyContainer.id = 'storiesTrack';
Object.defineProperty(storyContainer, 'scrollWidth', { value: 600, configurable: true });
Object.defineProperty(storyContainer, 'clientWidth', { value: 360, configurable: true });
Object.defineProperty(storyContainer, 'scrollLeft', { value: 50, writable: true, configurable: true });
document.body.appendChild(storyContainer);

assert.strictEqual(swipeModule.isInsideHorizontalScrollable(storyContainer, 'left'), true, 'Stories track can scroll right');
assert.strictEqual(swipeModule.isInsideHorizontalScrollable(storyContainer, 'right'), true, 'Stories track can scroll left');

// Boundary conditions
storyContainer.scrollLeft = 0;
assert.strictEqual(swipeModule.isInsideHorizontalScrollable(storyContainer, 'right'), false, 'At left edge: cannot scroll left further');

storyContainer.scrollLeft = 240; // 600 - 360 = 240 (max)
assert.strictEqual(swipeModule.isInsideHorizontalScrollable(storyContainer, 'left'), false, 'At right edge: cannot scroll right further');
storyContainer.remove();
console.log('✓ PASS: Inner horizontal scrollable container boundary detection verified');

// 4. Testing Chat Thread Swipe-To-Back Physics & Parallax (100% Zero Conflict)
console.log('--- 4. Testing Chat Thread Swipe-To-Back Physics & Parallax ---');
chatModal.classList.add('show');
const bgView = document.getElementById('chatsView');
bgView.classList.add('on');

// 4a. Header Drag Right -> 1:1 translate3d and Parallax
const hdr = chatModal.querySelector('.chat-thread-hdr');
swipeModule.handleSwipeStart({ clientX: 20, clientY: 40 }, hdr);
let swipeState = swipeModule.getSwipeState();
assert.ok(swipeState, 'Swipe session must be created for chat header');
assert.strictEqual(swipeState.type, 'chat');

// Move right 100px
swipeModule.handleSwipeMove({ clientX: 120, clientY: 42 });
assert.strictEqual(swipeState.directionLocked, 'horizontal', 'Direction must lock to horizontal');
assert.strictEqual(chatModal.style.transform, 'translate3d(100px, 0, 0)', 'Modal must follow finger 1:1 with translate3d');
assert.ok(chatModal.style.boxShadow.includes('-15px 0 35px rgba(0, 0, 0, 0.5)'), 'Modal must have natural left shadow');
assert.ok(bgView.style.transform.includes('translate3d('), 'Underlying view must have parallax transform');

// 4b. Releasing before threshold (moveX = 50px < 360 * 0.28 = 100.8px) -> Snapback
swipeState.moveX = 50;
swipeState.startTime = Date.now() - 300; // low velocity
const snapResult = swipeModule.handleSwipeEnd();
assert.strictEqual(snapResult.dismissed, false, 'Should snap back if below threshold');
assert.ok(chatModal.classList.contains('swipe-snapping'), 'Modal must receive swipe-snapping class');
assert.strictEqual(chatModal.style.transform, 'translate3d(0, 0, 0)', 'Modal must snap back to translate3d(0, 0, 0)');

// 4c. Releasing past threshold (> 28% of width) -> Dismiss
swipeModule.handleSwipeStart({ clientX: 20, clientY: 40 }, hdr);
swipeModule.handleSwipeMove({ clientX: 180, clientY: 42 }); // deltaX = 160px (44%)
const dismissResult = swipeModule.handleSwipeEnd();
assert.strictEqual(dismissResult.dismissed, true, 'Should dismiss if > 28%');
assert.ok(chatModal.classList.contains('swipe-dismissing'), 'Modal must receive swipe-dismissing class');
assert.strictEqual(chatModal.style.transform, 'translate3d(100%, 0, 0)', 'Modal must smoothly dismiss to translate3d(100%, 0, 0)');
assert.strictEqual(bgView.style.transform, 'translate3d(0, 0, 0)', 'Underlying view parallax must finish to 0');

// 4d. Zero Conflict: Vertical Movement Dominance (|deltaY| > |deltaX|)
swipeModule.handleSwipeStart({ clientX: 100, clientY: 100 }, chatModal.querySelector('#chatThreadMessages'));
swipeModule.handleSwipeMove({ clientX: 105, clientY: 140 }); // deltaX = 5, deltaY = 40 (vertical scroll)
swipeState = swipeModule.getSwipeState();
assert.strictEqual(swipeState.directionLocked, 'vertical', 'Vertical movement must lock direction to vertical');
assert.strictEqual(chatModal.classList.contains('swiping-horizontal'), false, 'Horizontal swiping must not activate during vertical scroll');
swipeModule.handleSwipeEnd();

// 4e. Zero Conflict: Message Card Left Swipe (deltaX < -15px) -> Reply Mode
const msgCard = chatModal.querySelector('.chat-msg');
swipeModule.handleSwipeStart({ clientX: 150, clientY: 200 }, msgCard);
swipeModule.handleSwipeMove({ clientX: 120, clientY: 202 }); // deltaX = -30px (left swipe on message)
swipeState = swipeModule.getSwipeState();
assert.strictEqual(swipeState.directionLocked, 'reply', 'Left swipe on message card must lock to reply mode');
assert.strictEqual(chatModal.classList.contains('swiping-horizontal'), false, 'Chat modal swipe-to-back must not interfere with reply');
swipeModule.handleSwipeEnd();

// 4f. Saved Messages (.is-saved) Chat Equality
chatModal.classList.add('is-saved');
swipeModule.handleSwipeStart({ clientX: 20, clientY: 300 }, chatModal.querySelector('#chatThreadInputRow'));
swipeModule.handleSwipeMove({ clientX: 120, clientY: 300 }); // deltaX = 100px
swipeState = swipeModule.getSwipeState();
assert.strictEqual(swipeState.directionLocked, 'horizontal', 'Saved messages must support swipe-to-back identically');
assert.strictEqual(chatModal.style.transform, 'translate3d(100px, 0, 0)');
swipeModule.handleSwipeEnd();
chatModal.classList.remove('is-saved', 'show');

console.log('✓ PASS: Chat thread swipe-to-back physics, parallax, and zero-conflict verified');

// 5. Testing Sub-Screens Swipe-To-Back (#grpInfoOverlay & #settingsOverlay)
console.log('--- 5. Testing Sub-Screens (#grpInfoOverlay and #settingsOverlay) ---');
const grpInfo = document.getElementById('grpInfoOverlay');
grpInfo.classList.add('show');
swipeModule.handleSwipeStart({ clientX: 10, clientY: 100 }, grpInfo);
swipeModule.handleSwipeMove({ clientX: 130, clientY: 102 }); // deltaX = 120px
swipeState = swipeModule.getSwipeState();
assert.strictEqual(swipeState.type, 'grpInfo');
assert.strictEqual(grpInfo.style.transform, 'translate3d(120px, 0, 0)');
assert.ok(grpInfo.style.boxShadow.includes('-15px 0 35px rgba(0, 0, 0, 0.5)'));
const grpDismiss = swipeModule.handleSwipeEnd();
assert.strictEqual(grpDismiss.dismissed, true);
assert.strictEqual(grpInfo.style.transform, 'translate3d(100%, 0, 0)');
grpInfo.classList.remove('show');

const settings = document.getElementById('settingsOverlay');
settings.classList.add('show');
swipeModule.handleSwipeStart({ clientX: 10, clientY: 100 }, settings);
swipeModule.handleSwipeMove({ clientX: 130, clientY: 102 }); // deltaX = 120px
swipeState = swipeModule.getSwipeState();
assert.strictEqual(swipeState.type, 'settings');
assert.strictEqual(settings.style.transform, 'translate3d(120px, 0, 0)');
const settingsDismiss = swipeModule.handleSwipeEnd();
assert.strictEqual(settingsDismiss.dismissed, true);
assert.strictEqual(settings.style.transform, 'translate3d(100%, 0, 0)');
settings.classList.remove('show');
console.log('✓ PASS: Sub-screens swipe-to-back verified');

// 6. Testing Horizontal Tab Pager (home <-> chats <-> saved <-> profile)
console.log('--- 6. Testing Horizontal Tab Pager Navigation ---');
// SwitchTab sequence verification
const routerModule = await import('../modules/router.js');
const navigationHistory = [];
const originalNavigateTo = routerModule.navigateTo;
// Track tab switches
swipeModule.switchTab(1); // from home -> chats
assert.ok(swipeModule.MAIN_TABS.indexOf('chats') === 1, 'chats is index 1');
assert.ok(swipeModule.MAIN_TABS.indexOf('saved') === 2, 'saved is index 2');
assert.ok(swipeModule.MAIN_TABS.indexOf('profile') === 3, 'profile is index 3');

// Swipe gesture trigger on main view:
swipeModule.handleSwipeStart({ clientX: 200, clientY: 200 }, document.getElementById('homeView'));
swipeModule.handleSwipeMove({ clientX: 120, clientY: 202 }); // swipe left by 80px
const pagerResult = swipeModule.handleSwipeEnd();
assert.ok(pagerResult, 'Pager must produce a switch result');
assert.strictEqual(pagerResult.dir, 1, 'Swipe left corresponds to dir +1 (next tab)');

// Swipe right (left to right) on homeView -> open story upload
swipeModule.handleSwipeStart({ clientX: 50, clientY: 200 }, document.getElementById('homeView'));
swipeModule.handleSwipeMove({ clientX: 150, clientY: 202 }); // swipe right by 100px
const storySwipeResult = swipeModule.handleSwipeEnd();
assert.ok(storySwipeResult, 'Swiping right on homeView must produce a result');
assert.strictEqual(storySwipeResult.dir, -1, 'Swipe right corresponds to dir -1');
assert.strictEqual(storySwipeResult.action, 'storyUpload', 'Swipe right on homeView must trigger storyUpload');

console.log('✓ PASS: Horizontal tab pager verified');

console.log('====================================================');
console.log('ALL MOBILE HORIZONTAL SWIPE NAVIGATION TESTS PASSED!');
console.log('====================================================');
process.exit(0);
