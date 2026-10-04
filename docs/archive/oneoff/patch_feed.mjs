import fs from 'fs';

let authCode = fs.readFileSync('modules/auth/auth.js', 'utf8');
authCode = authCode.replace(
  "if (error || !data || data.length === 0) return false;",
  "if (error || !data || data.length === 0) { window.__feedFullyLoaded = true; document.dispatchEvent(new CustomEvent('postsUpdated')); return false; }"
);
authCode = authCode.replace(
  "if (added > 0) _scheduleRender();",
  "if (data.length < 10) { window.__feedFullyLoaded = true; _scheduleRender(); }\n      if (added > 0) _scheduleRender();"
);

// We should also set __feedFullyLoaded in load() if initial load is < 10
authCode = authCode.replace(
  "for (const r of data || []) byId.set(r.id, mapPost(r));",
  "for (const r of data || []) byId.set(r.id, mapPost(r));\n    if (data && data.length < POST_LIMIT) window.__feedFullyLoaded = true;\n    else window.__feedFullyLoaded = false;"
);
fs.writeFileSync('modules/auth/auth.js', authCode);

let feedCode = fs.readFileSync('modules/feed/feed.js', 'utf8');
feedCode = feedCode.replace(
  "if (state.visibleN < filtered().length || (!state.search && state.view === 'home')) {",
  "if (state.visibleN < filtered().length || (!state.search && state.view === 'home' && !window.__feedFullyLoaded)) {"
);

// Also if posts is empty and __feedFullyLoaded is true, show empty message
feedCode = feedCode.replace(
  "await renderFeedTo(feedEl, posts);",
  "await renderFeedTo(feedEl, posts);\n  if (posts.length === 0 && window.__feedFullyLoaded) {\n    feedEl.innerHTML = '<div style=\"text-align:center; padding:40px; color:#888\">Hozircha postlar yo\\'q</div>';\n  }"
);
fs.writeFileSync('modules/feed/feed.js', feedCode);
