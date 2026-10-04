const fs = require('fs');
let code = fs.readFileSync('modules/chat/chat.js', 'utf8');

const draftLoadDM = `
  const draft = localStorage.getItem('draft_dm_' + uid) || '';
  $('chatThreadInput').value = draft;
  setTimeout(updateVoiceSendBtn, 50);
`;
code = code.replace("  $('chatThreadInput').value        = '';", draftLoadDM);

fs.writeFileSync('modules/chat/chat.js', code);
