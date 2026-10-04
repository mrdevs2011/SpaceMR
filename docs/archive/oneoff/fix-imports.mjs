import fs from 'fs';
let content = fs.readFileSync('modules/chat/chat-actions.js', 'utf8');

content = content.replace(
  "import { _uuid, _setTyping, _reloadThread, _showPendingBubble, _updatePendingProgress, _removePendingBubble, sb, state, uploadViaControllerProgress } from '../core/config.js';",
  "import { sb, state, uploadViaControllerProgress } from '../core/config.js';"
);

// Actually, let's just rewrite the top of the file explicitly
const correctTop = `
import { sb, state, uploadViaControllerProgress } from '../core/config.js';
import { $, esc, fmtSz, fmtTime } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { chatState } from './chat-state.js';
import {
  paintMessages, clearPendingPostShare, updateVoiceSendBtn,
  setPendingPostShare, clearChatFile, _showOptimisticVoiceBubble,
  _uuid, _setTyping, _reloadThread, _showPendingBubble, _updatePendingProgress, _removePendingBubble
} from './chat.js';
import { inboxSend } from '../core/rt-bus.js';
import { sendGroupMessage, sendGroupVoice, sendGroupFile } from './groups.js';
import { commitEdit, isEditing } from './msg-menu.js';
`;

content = content.replace(/import \{.*?\}.*?msg-menu\.js';/s, correctTop.trim());
fs.writeFileSync('modules/chat/chat-actions.js', content);
console.log('done fixing imports');
