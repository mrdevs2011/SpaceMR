const fs = require('fs');
let css = fs.readFileSync('CSS/mono-x.css', 'utf8');

css = css.replace(/nav\.bot-nav \{/g, 'nav.bot-nav { box-sizing: border-box;');
fs.writeFileSync('CSS/mono-x.css', css);
