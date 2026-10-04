const fs = require('fs');
const glob = require('fs').readdirSync('modules', { recursive: true }).filter(f => f.endsWith('.js'));

for (const file of glob) {
  const path = 'modules/' + file;
  let code = fs.readFileSync(path, 'utf8');
  let changed = false;

  // Pattern: src="${var}" where var doesn't start with esc(
  code = code.replace(/src="\$\{([^}]+)\}"/g, (match, p1) => {
    if (p1.trim().startsWith('esc(')) return match;
    // Don't escape if it's result.url from local upload
    if (p1.trim() === 'result.url') return match; 
    changed = true;
    return `src="\${esc(${p1})}"`;
  });

  if (changed) {
    fs.writeFileSync(path, code);
    console.log('Patched', path);
  }
}
