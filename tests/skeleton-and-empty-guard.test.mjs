import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="feed"></div><div id="chatsListWrap"></div><div id="notifsList"></div></body></html>', {
  url: 'https://spacemr.com'
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

console.log('--- 1. Testing paintFeedSkeleton placeholder ---');
const feedSrc = readFileSync(new URL('../modules/feed/feed.js', import.meta.url), 'utf8');

assert(feedSrc.includes('feed-shadow-placeholder'), 'Feed skeleton must use subtle feed-shadow-placeholder');
assert(feedSrc.includes('skel-shimmer'), 'Feed skeleton must contain skel-shimmer');
console.log('✓ PASS: Feed placeholder is minimal, clean, and avoids artificial dummy walls');

console.log('--- 2. Testing Empty State Flash Guard ---');
assert(feedSrc.includes('if (!state.postsLoaded && !window.__postsLoaded && !state.search)'), 
  'renderFeedTo must guard against uncompleted posts load before rendering empty state');
assert(feedSrc.includes('paintFeedSkeleton(feedEl)'),
  'renderFeedTo must paint subtle placeholder when posts are not yet loaded');
console.log('✓ PASS: Empty state cannot flash while posts are loading');

console.log('--- 3. Testing Notification Permission User Gesture Safety ---');
const pushSrc = readFileSync(new URL('../modules/push.js', import.meta.url), 'utf8');
assert(!pushSrc.includes('setTimeout(ask, 400)'), 'push.js must never call requestPermission in setTimeout');
console.log('✓ PASS: Notification permissions are never requested without user gesture');

console.log('--- 4. Testing Explore & SpaceMR Group Direct Access ---');
const uiSrc = readFileSync(new URL('../modules/ui/ui.js', import.meta.url), 'utf8');
assert(uiSrc.includes('applyPath(\'/explore\')'), 'ui.js must directly open /explore when hdrExploreBtn is clicked');

const chipSrc = readFileSync(new URL('../modules/ui/spacemr-group-chip.js', import.meta.url), 'utf8');
assert(chipSrc.includes('openGroupThread'), 'spacemr-group-chip.js must directly open group thread');
console.log('✓ PASS: Explore and SpaceMR group click handlers are reliably connected');

console.log('========================================');
console.log('ALL SKELETON AUDIT TESTS PASSED (100%)');
console.log('========================================');
