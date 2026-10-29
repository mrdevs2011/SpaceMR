import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chatThreadMessages"></div></body></html>', {
  url: 'https://spacemr.com'
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try {
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
} catch (_) {}
dom.window.fetch = globalThis.fetch;
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};

const utils = await import('../modules/core/utils.js');
const bubble = await import('../modules/chat/components/message-bubble.js');

console.log('--- 1. Testing parsePureMedia ---');
// Pexels Photo & Video detection
const pexPhoto = utils.parsePureMedia('https://www.pexels.com/photo/city-lights-during-night-time-13812189/');
assert.equal(pexPhoto.type, 'image');
assert.ok(pexPhoto.canonicalUrl.includes('images.pexels.com/photos/13812189'));

const pexVid = utils.parsePureMedia('https://www.pexels.com/download/video/10085002/');
assert.equal(pexVid.type, 'video');

// Pure YouTube
const yt1 = utils.parsePureMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.equal(yt1.type, 'youtube');
assert.equal(yt1.videoId, 'dQw4w9WgXcQ');

// YouTube Shorts
const ytShorts = utils.parsePureMedia('https://www.youtube.com/shorts/3jZ_a_Z1_kM');
assert.equal(ytShorts.type, 'youtube');
assert.equal(ytShorts.isShorts, true);

// TikTok
const tt1 = utils.parsePureMedia('https://www.tiktok.com/@mrdevs/video/7234567890123456789');
assert.equal(tt1.type, 'tiktok');

// Instagram Reel
const ig1 = utils.parsePureMedia('https://www.instagram.com/reel/Cx12345Abc/');
assert.equal(ig1.type, 'instagram');
assert.equal(ig1.isShorts, true);

// Facebook Video
const fb1 = utils.parsePureMedia('https://www.facebook.com/watch/?v=1234567890');
assert.equal(fb1.type, 'facebook');

// Direct Video
const vid1 = utils.parsePureMedia('https://cdn.example.com/videos/awesome.mp4');
assert.equal(vid1.type, 'video');

// Direct Image
const img1 = utils.parsePureMedia('https://cdn.example.com/photos/cat.png');
assert.equal(img1.type, 'image');

// Generic Web link (Worldwide URL preview)
const web1 = utils.parsePureMedia('https://kun.uz/news/2026/10/29/ozbekiston');
assert.equal(web1.type, 'web');
assert.equal(web1.canonicalUrl, 'https://kun.uz/news/2026/10/29/ozbekiston');

// Github link
const web2 = utils.parsePureMedia('https://github.com/mrdevs2011/SpaceMR');
assert.equal(web2.type, 'web');

// Mixed text should NOT be pureMedia
const mixed = utils.parsePureMedia('Bu havolani ko\'ring: https://kun.uz/news');
assert.equal(mixed, null);

console.log('✓ parsePureMedia test passed');

console.log('--- 2. Testing renderMediaCard & platform logos ---');
const ytCard = utils.renderMediaCard({ type: 'youtube', videoId: 'dQw4w9WgXcQ', canonicalUrl: 'https://youtube.com', standalone: true });
assert.ok(ytCard.includes('chat-media-play-btn'), 'Should use chat-media-play-btn');
assert.ok(ytCard.includes('chat-yt-standalone'), 'Should have chat-yt-standalone');

// Test recognized platforms have dedicated SVG logos
assert.equal(utils.getDomainPlatform('https://www.google.com/search?q=test'), 'google');
assert.equal(utils.getDomainPlatform('https://wa.me/998901234567'), 'whatsapp');
assert.equal(utils.getDomainPlatform('https://discord.gg/spacemr'), 'discord');
assert.equal(utils.getDomainPlatform('https://yandex.uz'), 'yandex');
assert.equal(utils.getDomainPlatform('https://kun.uz/news/123'), 'kun');
assert.equal(utils.getDomainPlatform('https://daryo.uz/2026/10/29'), 'daryo');
assert.equal(utils.getDomainPlatform('https://uzum.uz/product/123'), 'uzum');
assert.equal(utils.getDomainPlatform('https://olx.uz/d/obyavlenie'), 'olx');

const kunCard = utils.renderMediaCard({ type: 'web', canonicalUrl: 'https://kun.uz', displayUrl: 'https://kun.uz', standalone: true });
assert.ok(kunCard.includes('chat-link-box'), 'Should contain chat-link-box');
assert.ok(kunCard.includes('KUN'), 'Should display dedicated KUN logo');

// Test no "Rasm" or "Video" badge on image/video cards
const imgCard = utils.renderMediaCard({ type: 'image', canonicalUrl: 'https://example.com/pic.jpg', standalone: true });
assert.ok(!imgCard.includes('Rasm'), 'Image card must not have "Rasm" badge');
assert.ok(!imgCard.includes('chat-yt-shorts-badge'), 'Image card must not have badge dom');
assert.ok(imgCard.includes('chat-media-img-wrap'), 'Image card must use chat-media-img-wrap');
assert.ok(!imgCard.includes('chat-yt-box'), 'Image card must not use 16:9 chat-yt-box');

const vidCard = utils.renderMediaCard({ type: 'video', canonicalUrl: 'https://example.com/clip.mp4', standalone: true });
assert.ok(!vidCard.includes('Video'), 'Video card must not have "Video" badge');

// For arbitrary worldwide site (e.g. unknown-site-xyz.org), verify multi-tier favicon fallback and no 16:9 black box
const arbCard = utils.renderMediaCard({ type: 'web', canonicalUrl: 'https://unknown-site-xyz.org', displayUrl: 'https://unknown-site-xyz.org', standalone: true });
assert.ok(arbCard.includes('icons.duckduckgo.com/ip3/unknown-site-xyz.org.ico'), 'Tier 1: DuckDuckGo favicon CDN');
assert.ok(arbCard.includes('google.com/s2/favicons?domain=unknown-site-xyz.org'), 'Tier 2: Google S2 64px fallback');
assert.ok(!arbCard.includes('chat-yt-box'), 'Generic web card must not use 16:9 chat-yt-box void');
assert.ok(arbCard.includes('chat-link-card'), 'Web card must have chat-link-card class');

console.log('✓ renderMediaCard test passed');

console.log('--- 3. Testing standalone bubble generation (bubble-free) ---');
const bData = bubble.generateMediaBubble({ media: web1, m: { id: 'm1', text: web1.canonicalUrl }, time: '14:30', mine: true, renderTicks: () => '✓✓' });
assert.ok(bData.bubbleClassExtra.includes('bubble-media-only'), 'Should have bubble-media-only');
assert.equal(bData.metaOutside, false, 'metaOutside should be false');

console.log('✓ generateMediaBubble test passed');

console.log('--- 4. Testing renderMarkdown with embedded cards ---');
const mdRes = utils.renderMarkdown('Boshida matn: https://kun.uz/news oxirida matn');
assert.ok(mdRes.includes('Boshida matn:'), 'Should preserve prefix text');
assert.ok(mdRes.includes('oxirida matn'), 'Should preserve suffix text');
assert.ok(mdRes.includes('chat-link-box'), 'Should embed link preview card');

console.log('✓ renderMarkdown test passed');

console.log('--- 5. Testing search bar hidden state in CSS ---');
import { readFileSync } from 'node:fs';
const featuresCss = readFileSync(new URL('../CSS/features.css', import.meta.url), 'utf8');
assert.ok(featuresCss.includes('.chat-thread-hdr:not(.search-active) #threadMsgSearchBar'), 'CSS must explicitly hide search when not search-active');
assert.ok(featuresCss.includes('.chat-thread-hdr.search-active #threadMsgSearchBar'), 'CSS must show search when search-active');
assert.ok(featuresCss.includes('mark.chat-search-mark'), 'CSS must define slim search mark');
assert.ok(featuresCss.includes('.chat-yt-card .cfm-media-badge'), 'Media card badge must be positioned for time/ticks');

console.log('✓ CSS search bar states valid');

console.log('ALL MEDIA PREVIEW TESTS PASSED SUCCESSFULLY!');
process.exit(0);
