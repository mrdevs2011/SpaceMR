import fs from 'fs';
let content = fs.readFileSync('modules/chat/chat.js', 'utf8');
content = `import { sendChatMessage, sendVoiceMessage, sendChatFile, handleSendAction } from './chat-actions.js';\nexport { sendChatMessage, handleSendAction };\n` + content;
fs.writeFileSync('modules/chat/chat.js', content);
