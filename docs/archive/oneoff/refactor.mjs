import fs from 'fs';

let content = fs.readFileSync('modules/chat/chat.js', 'utf8');
const stateVars = [
  '_searchQuery', '_usersCache', '_latestChatMap', '_watcherPromise', '_noticeUnsub',
  '_loadNoticeFn', '_presenceRepaintTick', '_latestNotice', '_contactsUnsub', '_myContacts',
  '_groupsListenerAttached', '_otherUserAvi', '_otherUserUid', '_peerUserUnsub', '_peerStatusTick',
  '_peerLastSeenAt', '_chatDocUnsub', '_peerTyping', '_onPeerTyping', '_iAmTyping',
  '_typingTimeout', '_typingCh', '_typingChReady', '_seenMsgIdsChatId', '_seenMsgIds',
  '_seenBaselineDone', '_msgAnimStart', '_dissolving', '_readObs', '_pendingReadIds',
  '_readFlushTimer', '_locallyReadIds', '_pendingPostShare', '_rt', '_rtChatId',
  '_rtLocal', '_rtRead', '_threadUnsub', '_reloadThread', '_curMsgs', '_chatSelFile',
  '_chatsUnsub', '_postExistenceMap', '_userExistenceMap'
];

let stateJs = `export const chatState = {\n`;

for (let v of stateVars) {
  // Try to find the initialization: let _var = ...; or const _var = ...;
  const regex = new RegExp(`(?:let|const)\\s+${v}\\s*=\\s*(.*?);`, 'g');
  let match = regex.exec(content);
  if (match) {
    stateJs += `  ${v}: ${match[1]},\n`;
    // Remove the declaration from chat.js
    content = content.replace(match[0], '');
  } else {
    stateJs += `  ${v}: null,\n`;
  }
}
stateJs += `};\n`;
fs.writeFileSync('modules/chat/chat-state.js', stateJs);

for (let v of stateVars) {
  // Replace _var with chatState._var
  // Need word boundary, but _var starts with _, so \b doesn't match the start of _var if preceded by space.
  // Actually, \b_var matches if preceded by non-word.
  const regex = new RegExp(`(?<![a-zA-Z0-9_$])${v}(?![a-zA-Z0-9_$])`, 'g');
  content = content.replace(regex, `chatState.${v}`);
}

content = `import { chatState } from './chat-state.js';\n` + content;
fs.writeFileSync('modules/chat/chat.js.new', content);
console.log('done');
