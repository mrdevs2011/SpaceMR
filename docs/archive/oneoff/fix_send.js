import fs from 'fs';

// Fix DM send
let chatActions = fs.readFileSync('modules/chat/chat-actions.js', 'utf8');
chatActions = chatActions.replace(
  "  if (inp) {",
  "  if (inp) {\n    localStorage.removeItem('draft_' + (state.currentChatUid || state.currentChatId));\n"
);
fs.writeFileSync('modules/chat/chat-actions.js', chatActions);

// Fix Group send
let groupActions = fs.readFileSync('modules/chat/groups.js', 'utf8');
groupActions = groupActions.replace(
  "  if (inp) {\n    inp.value = '';",
  "  if (inp) {\n    localStorage.removeItem('draft_' + _currentGroupId);\n    inp.value = '';"
);
fs.writeFileSync('modules/chat/groups.js', groupActions);

// And when opening a group, we should load its draft!
groupActions = fs.readFileSync('modules/chat/groups.js', 'utf8');
groupActions = groupActions.replace(
  "  $('chatThreadInput').placeholder = 'Xabar yozing...';",
  "  $('chatThreadInput').placeholder = 'Xabar yozing...';\n  $('chatThreadInput').value = localStorage.getItem('draft_' + groupId) || '';\n  setTimeout(() => window.updateVoiceSendBtn && window.updateVoiceSendBtn(), 50);"
);
fs.writeFileSync('modules/chat/groups.js', groupActions);

