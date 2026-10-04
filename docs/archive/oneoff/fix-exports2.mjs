import fs from 'fs';

// Fix chat.js exports
let chatContent = fs.readFileSync('modules/chat/chat.js', 'utf8');
const missingExports = [
  '_uuid', '_setTyping', '_reloadThread', 'clearChatFile',
  '_showOptimisticVoiceBubble', 'updateVoiceSendBtn', 'paintMessages',
  'clearPendingPostShare', 'setPendingPostShare', '_showPendingBubble',
  '_updatePendingProgress', '_removePendingBubble'
];
for (let func of missingExports) {
  // If it's `function func(` convert to `export function func(`
  // Or if it's `const _uuid` convert to `export const _uuid`
  chatContent = chatContent.replace(new RegExp(`^function ${func}\\b`, 'm'), `export function ${func}`);
  chatContent = chatContent.replace(new RegExp(`^const ${func}\\b`, 'm'), `export const ${func}`);
  chatContent = chatContent.replace(new RegExp(`^let ${func}\\b`, 'm'), `export let ${func}`);
}
fs.writeFileSync('modules/chat/chat.js', chatContent);

// Fix chat-actions.js imports
let actionsContent = fs.readFileSync('modules/chat/chat-actions.js', 'utf8');
actionsContent = actionsContent.replace(
  "import {",
  "import { _uuid, _setTyping, _reloadThread, _showPendingBubble, _updatePendingProgress, _removePendingBubble,"
);
fs.writeFileSync('modules/chat/chat-actions.js', actionsContent);
console.log('done fixing exports 2');
