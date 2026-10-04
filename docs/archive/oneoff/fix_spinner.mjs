import fs from 'fs';

let feedCode = fs.readFileSync('modules/feed/feed.js', 'utf8');
// Remove the ugly text overriding the beautiful empty state
feedCode = feedCode.replace(
  `  if (posts.length === 0 && window.__feedFullyLoaded) {\n    feedEl.innerHTML = '<div style="text-align:center; padding:40px; color:#888">Hozircha postlar yo\\'q</div>';\n  }`,
  ""
);
fs.writeFileSync('modules/feed/feed.js', feedCode);

let authCode = fs.readFileSync('modules/auth/auth.js', 'utf8');
// In auth.js render(), we must ALWAYS trigger renderFeed if posts length is 0 and it just loaded
authCode = authCode.replace(
  "const structural = _lastPostIds !== currentIds;",
  "const structural = _lastPostIds !== currentIds || (newPosts.length === 0 && window.__feedNeedsEmptyRender);"
);

authCode = authCode.replace(
  "if (data && data.length < POST_LIMIT) window.__feedFullyLoaded = true;\n    else window.__feedFullyLoaded = false;",
  "if (data && data.length < POST_LIMIT) { window.__feedFullyLoaded = true; window.__feedNeedsEmptyRender = true; }\n    else window.__feedFullyLoaded = false;"
);

// clear the flag after render
authCode = authCode.replace(
  "if (structural) cachePosts(myUid, newPosts);",
  "if (structural) cachePosts(myUid, newPosts);\n    window.__feedNeedsEmptyRender = false;"
);

fs.writeFileSync('modules/auth/auth.js', authCode);
