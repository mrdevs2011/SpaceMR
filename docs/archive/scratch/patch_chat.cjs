const fs = require('fs');
let code = fs.readFileSync('modules/chat/chat.js', 'utf8');

const importStr = "sb, state, uploadViaController, isAdmin, fetchAllRows, mapProfile, mapChat, mapMessage,\n  mediaPublicUrl, ts, SUPABASE_URL, SUPABASE_ANON_KEY, MEDIA_BUCKET";
const newImportStr = "sb, state, uploadViaController, isAdmin, fetchAllRows, mapProfile, mapChat, mapMessage,\n  mediaPublicUrl, ts, SUPABASE_URL, SUPABASE_ANON_KEY, MEDIA_BUCKET, MAX_FILE";
code = code.replace(importStr, newImportStr);

const setChatFileStr = `function setChatFile(file) {
  chatState._chatSelFile = file;`;
const newSetChatFileStr = `function setChatFile(file) {
  if (file.size > MAX_FILE) {
    import('../ui/toast.js').then(m => m.toast('Fayl hajmi 50 MB dan oshmasligi kerak', 'error'));
    return;
  }
  chatState._chatSelFile = file;`;
code = code.replace(setChatFileStr, newSetChatFileStr);
fs.writeFileSync('modules/chat/chat.js', code);
