import { readFileSync } from 'node:fs';

const mediaCache = readFileSync(new URL('../modules/core/store/media-cache.js', import.meta.url), 'utf8');
const featuresCss = readFileSync(new URL('../CSS/features.css', import.meta.url), 'utf8');
const monoCss = readFileSync(new URL('../CSS/mono-x.css', import.meta.url), 'utf8');
const comments = readFileSync(new URL('../modules/feed/comments.js', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../modules/profile/profile.js', import.meta.url), 'utf8');

let failed = 0;
function check(ok, label) {
  if (ok) console.log('PASS:', label);
  else { console.error('FAIL:', label); failed++; }
}

check(!mediaCache.includes('max-height: 520px'), 'post media aspect helper has no fixed max-height');
check(!mediaCache.includes('min-width: 220px'), 'post media aspect helper has no forced minimum width');
check(/\.dm-media img, \.dm-media video \{[^}]*max-height:\s*none/i.test(featuresCss), 'profile detail post images and videos have no viewport max-height');
check(profile.includes("p.mediaType?.startsWith('video')") && profile.includes('<video src='), 'profile post detail renders video media');
const postMediaRule = monoCss.match(/\.post-media\[style\*="aspect-ratio"\][^{]*\{([^}]+)\}/);
check(!!postMediaRule && !/max-height\s*:/i.test(postMediaRule[1]), 'feed/profile post media container has no max-height');
const postImageRule = monoCss.match(/\.post-media img\s*\{([^}]+)\}/);
check(!!postImageRule && !/max-height\s*:/i.test(postImageRule[1]), 'feed/profile post image has no max-height');
check(comments.includes("const wasOpen = !!m?.classList.contains('show');") && comments.includes('if (!wasOpen) {') && comments.includes('m.classList.remove(\'show\');'), 'closed comments sheet never releases a stale scroll lock');
check((comments.match(/focus\(\{ preventScroll: true \}\)/g) || []).length >= 2, 'inline and right-rail comment focus cannot scroll the page');

if (failed) process.exit(1);
console.log('ALL POST MEDIA / COMMENT SCROLL REGRESSION TESTS PASSED');
