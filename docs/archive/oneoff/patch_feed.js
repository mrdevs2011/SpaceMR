const fs = require('fs');

// Patch auth.js to set __feedFullyLoaded
let authCode = fs.readFileSync('modules/auth/auth.js', 'utf8');
authCode = authCode.replace(
  "if (error || !data || data.length === 0) return false;",
  "if (error || !data || data.length === 0) { window.__feedFullyLoaded = true; return false; }"
);
authCode = authCode.replace(
  "if (added > 0) _scheduleRender();",
  "if (data.length < 10) window.__feedFullyLoaded = true;\n      if (added > 0) _scheduleRender();"
);
fs.writeFileSync('modules/auth/auth.js', authCode);

// Patch feed.js to respect __feedFullyLoaded and not show spinner forever
let feedCode = fs.readFileSync('modules/feed/feed.js', 'utf8');
feedCode = feedCode.replace(
  "if (state.visibleN < filtered().length || (!state.search && state.view === 'home')) {",
  "if (state.visibleN < filtered().length || (!state.search && state.view === 'home' && !window.__feedFullyLoaded)) {"
);
fs.writeFileSync('modules/feed/feed.js', feedCode);
