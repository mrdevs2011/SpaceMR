import { readFileSync } from 'node:fs';

const feedSrc = readFileSync(new URL('../modules/feed/feed.js', import.meta.url), 'utf8');
const profileSrc = readFileSync(new URL('../modules/profile/profile.js', import.meta.url), 'utf8');
const cssSrc = readFileSync(new URL('../CSS/mono-x.css', import.meta.url), 'utf8');
const appCssSrc = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

let fail = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    fail++;
  } else {
    console.log('PASS:', msg);
  }
}

// 1. feed.js contains post-head-views element before post-more-btn
assert(
  feedSrc.includes('class="post-head-views"') &&
  feedSrc.includes('data-post-vc="${p.id}"') &&
  feedSrc.includes('class="post-views-count"'),
  'feed.js renders post-head-views with data-post-vc attribute'
);

// 2. recordPostView updates all data-post-vc elements
assert(
  feedSrc.includes('document.querySelectorAll(`[data-post-vc="${postId}"]`)') &&
  feedSrc.includes('recordPostView'),
  'recordPostView updates all matching views spans via data-post-vc querySelectorAll'
);

// 3. patchCounts updates data-post-vc
assert(
  feedSrc.includes('document.querySelectorAll(`[data-post-vc="${p.id}"]`)'),
  'patchCounts updates matching views spans'
);

// 4. profile.js detail modal renders post-head-views and updates views
assert(
  profileSrc.includes('class="post-head-views dm-head-views"') &&
  profileSrc.includes('data-post-vc="${id}"') &&
  profileSrc.includes('recordPostView'),
  'profile.js openDetail renders post-head-views and triggers recordPostView'
);

// 5. CSS styles exist in mono-x.css and app.css
assert(
  cssSrc.includes('.post-head-views') &&
  cssSrc.includes(':is(#app, #searchOverlay) .post > .post-head > .post-head-views') &&
  appCssSrc.includes('.post-head-views'),
  'CSS styles properly declared and compiled to app.css'
);

if (fail > 0) {
  console.error(`Post views tests failed with ${fail} errors.`);
  process.exit(1);
} else {
  console.log('ALL POST VIEWS AUDIT TESTS PASSED (100%)');
}
