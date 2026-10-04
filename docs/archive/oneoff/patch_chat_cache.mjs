import fs from 'fs';

let chatCode = fs.readFileSync('modules/chat/chat.js', 'utf8');

// 1. Add cache map
chatCode = chatCode.replace(
  "export const chatState = {",
  "export const chatState = {\n  _threadCache: new Map(), // Caches messages by chatId"
);

// 2. In openChatThread, show cached messages if they exist instead of a spinner
const originalSpinner = `  if (!_tLoaded) {
    $('chatThreadMessages').innerHTML = \`<div class="spin-wrap pt-60px"><div class="spinner"></div></div>\`;
  }`;

const cachedSpinner = `  if (!_tLoaded) {
    if (chatId && chatState._threadCache.has(chatId)) {
      chatState._curMsgs = chatState._threadCache.get(chatId);
      paintMessages(chatState._curMsgs);
    } else {
      $('chatThreadMessages').innerHTML = \`<div class="spin-wrap pt-60px"><div class="spinner"></div></div>\`;
    }
  }`;

chatCode = chatCode.replace(originalSpinner, cachedSpinner);

// 3. In loadThread, save to cache
chatCode = chatCode.replace(
  "chatState._curMsgs = arr;",
  "chatState._curMsgs = arr;\n    if (chatId) chatState._threadCache.set(chatId, arr);"
);

// 4. Same for groups.js
let groupCode = fs.readFileSync('modules/chat/groups.js', 'utf8');
groupCode = groupCode.replace(
  "export let _currentGroupId = null;",
  "export let _currentGroupId = null;\nexport const _groupThreadCache = new Map();"
);

groupCode = groupCode.replace(
  "const msgsEl = document.getElementById('chatThreadMessages');\n  if (msgsEl) msgsEl.innerHTML = '<div class=\"spin-wrap pt-60px\"><div class=\"spinner\"></div></div>';",
  "const msgsEl = document.getElementById('chatThreadMessages');\n  if (msgsEl) {\n    if (_groupThreadCache.has(groupId)) {\n      const cached = _groupThreadCache.get(groupId);\n      if (cached && cached.length) {\n         const { paintGroupThread } = await import('./chat.js');\n         paintGroupThread(cached, _latestGroupMap[groupId]?.group_members?.reduce((a,c)=>{a[c.user_id]=c.role;return a},{}));\n      } else msgsEl.innerHTML = '<div class=\"spin-wrap pt-60px\"><div class=\"spinner\"></div></div>';\n    } else {\n      msgsEl.innerHTML = '<div class=\"spin-wrap pt-60px\"><div class=\"spinner\"></div></div>';\n    }\n  }"
);

groupCode = groupCode.replace(
  "  if (cb) cb(arr);",
  "  if (_currentGroupId) _groupThreadCache.set(_currentGroupId, arr);\n  if (cb) cb(arr);"
);

fs.writeFileSync('modules/chat/chat.js', chatCode);
fs.writeFileSync('modules/chat/groups.js', groupCode);
