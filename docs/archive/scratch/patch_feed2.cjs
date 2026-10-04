const fs = require('fs');
let code = fs.readFileSync('modules/feed/feed.js', 'utf8');

code = code.replace(
  "if (state.visibleN < filtered().length) {\n    feedEl.insertAdjacentHTML('beforeend', '<div class=\"spin-wrap\"><div class=\"spinner\"></div></div>');\n  }",
  "if (state.visibleN < filtered().length || (!state.search && state.view === 'home')) {\n    feedEl.insertAdjacentHTML('beforeend', '<div class=\"spin-wrap\"><div class=\"spinner\"></div></div>');\n  }"
);
fs.writeFileSync('modules/feed/feed.js', code);
