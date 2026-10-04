import fs from 'fs';
let code = fs.readFileSync('modules/chat/chat.js', 'utf8');

const draftLoadDM = `
  const draft = localStorage.getItem('draft_' + uid) || '';
  $('chatThreadInput').value = draft;
  setTimeout(updateVoiceSendBtn, 50);
`;
code = code.replace("  $('chatThreadInput').value        = '';", draftLoadDM);

// Also add a saveDraft logic to _onChatInputTyping
const saveDraftLogic = `
function _onChatInputTyping(e) {
  if (state.currentChatId && !isEditing()) {
    const val = e.target.value;
    if (val) localStorage.setItem('draft_' + (state.currentChatUid || state.currentChatId), val);
    else localStorage.removeItem('draft_' + (state.currentChatUid || state.currentChatId));
  }
`;
code = code.replace("function _onChatInputTyping(e) {", saveDraftLogic);

fs.writeFileSync('modules/chat/chat.js', code);
