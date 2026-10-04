import fs from 'fs';

let content = fs.readFileSync('modules/chat/chat.js', 'utf8');

function extractFunction(name, isAsync = false, isExport = false) {
  const prefix = (isExport ? 'export ' : '') + (isAsync ? 'async ' : '') + `function ${name}`;
  const startIdx = content.indexOf(prefix);
  if (startIdx === -1) return null;
  
  let braceCount = 0;
  let inFunction = false;
  let endIdx = startIdx;
  
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') {
      inFunction = true;
      braceCount++;
    } else if (content[i] === '}') {
      braceCount--;
    }
    
    if (inFunction && braceCount === 0) {
      endIdx = i + 1;
      break;
    }
  }
  
  const funcText = content.substring(startIdx, endIdx);
  content = content.substring(0, startIdx) + content.substring(endIdx);
  return funcText;
}

const funcsToExtract = [
  { name: 'sendChatMessage', isAsync: true, isExport: true },
  { name: 'sendVoiceMessage', isAsync: true, isExport: false },
  { name: 'sendChatFile', isAsync: true, isExport: false },
  { name: 'handleSendAction', isAsync: true, isExport: false },
];

let extracted = '';
for (let f of funcsToExtract) {
  const txt = extractFunction(f.name, f.isAsync, f.isExport);
  if (txt) {
    extracted += txt + '\n\n';
  } else {
    console.log('Could not find', f.name);
  }
}

// Convert extracted non-exported functions to exported so they can be imported
extracted = extracted.replace(/async function sendVoiceMessage/g, 'export async function sendVoiceMessage');
extracted = extracted.replace(/async function sendChatFile/g, 'export async function sendChatFile');
extracted = extracted.replace(/async function handleSendAction/g, 'export async function handleSendAction');

let actionsContent = `
import { sb, state, uploadViaControllerProgress } from '../core/config.js';
import { $, esc, fmtSz, fmtTime } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { chatState } from './chat-state.js';
// We need to import necessary helpers from chat.js
import {
  paintMessages, clearPendingPostShare, updateVoiceSendBtn,
  setPendingPostShare, clearChatFile, _showOptimisticVoiceBubble
} from './chat.js';
import { inboxSend } from '../core/rt-bus.js';
import { sendGroupMessage, sendGroupVoice, sendGroupFile } from './groups.js';
import { commitEdit, isEditing } from './msg-menu.js';

// ... plus uuid, _setTyping, etc. We will add those manually after.

${extracted}
`;

fs.writeFileSync('modules/chat/chat-actions.js', actionsContent);
fs.writeFileSync('modules/chat/chat.js', content);
console.log('done extracting actions');
