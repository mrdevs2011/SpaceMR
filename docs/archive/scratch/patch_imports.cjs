const fs = require('fs');

function addImport(file) {
  let code = fs.readFileSync(file, 'utf8');
  if (!code.includes('import { esc }') && !code.includes(' esc,')) {
    code = "import { esc } from '../core/utils.js';\n" + code;
    fs.writeFileSync(file, code);
  }
}

addImport('modules/auth/auth-settings.js');
addImport('modules/call/call.js');
addImport('modules/ui/ui.js');
// For message-bubble.js the path is different
let mbCode = fs.readFileSync('modules/chat/components/message-bubble.js', 'utf8');
if (!mbCode.includes('import { esc }') && !mbCode.includes(' esc,')) {
  mbCode = "import { esc } from '../../core/utils.js';\n" + mbCode;
  fs.writeFileSync('modules/chat/components/message-bubble.js', mbCode);
}
