
import { sb, state } from '../core/config.js';
import { $, esc, fmtSz, fmtTime } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { chatState, chatUI } from './chat-state.js';
import { uploadViaControllerProgress, _showPendingBubble, _updatePendingProgress, _removePendingBubble, _uuid } from './chat-shared.js';
import { inboxSend } from '../core/rt-bus.js';
import { sendGroupMessage, sendGroupVoice, sendGroupFile } from './groups.js';
import { commitEdit, isEditing, getReplying, cancelReply } from './msg-menu.js';
import { rateOk } from '../core/rate-limit.js';
import { fileMsgPreview } from './components/video-note.js';
import { registerLocalVoiceUrl, voiceBarCount } from './chat-voice-player.js';

export async function sendChatMessage() {
  // Route to group/channel send if in that mode
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    return sendGroupMessage();
  }
  if (isEditing()) { await commitEdit($('chatThreadInput')?.value); return; }
  const inp  = $('chatThreadInput');
  const userText = (inp?.value || '').trim();
  const postShare = chatState._pendingPostShare;

  if ((!userText && !postShare) || !state.currentChatId || !state.me) return;
  if (!rateOk('msg', 15, 60000)) return;

  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;

  inp.value = '';
  if (postShare) {
    chatUI.clearPendingPostShare();
  } else {
    chatUI.updateVoiceSendBtn();
  }
  clearTimeout(chatState._typingTimeout);
  chatUI._setTyping(false);

  const finalMsgText = postShare
    ? JSON.stringify({ __postShare: true, post: postShare, comment: userText })
    : userText;

  const replyInfo = getReplying();
  const replyToId = replyInfo?.id || null;
  if (replyInfo) cancelReply(false);

  const previewText = postShare
    ? (userText ? userText : `Post: ${postShare.authorName || 'Post'}`)
    : userText.slice(0, 120);

  // 1) Optimistik: o'z xabarimiz shu zahoti ekranda (DB javobini kutmaymiz)
  const id = _uuid();
  const nowMs = Date.now();
  const localMsg = {
    id, chatId, senderId: state.me.uid, type: 'text', text: finalMsgText,
    mediaPath: null, mediaUrl: '', mediaType: null, fileName: null, fileSize: null, duration: null,
    status: 'sending', readAt: null, editedAt: null, createdAt: nowMs, _at: nowMs,
    replyTo: replyToId,
    replyPreview: replyInfo ? { name: replyInfo.name, text: replyInfo.preview, type: replyInfo.type } : null,
  };
  chatState._rtLocal.set(id, localMsg);
  chatUI.paintMessages([...chatState._curMsgs, localMsg]);
  // 2) Peer'ga to'g'ridan-to'g'ri (WebRTC DataChannel; ulanmagan bo'lsa broadcast)
  if (chatState._rt && chatState._rtChatId === chatId) chatState._rt.send(id, finalMsgText);
  // 2b) Peer'ning suhbatlar ro'yxati/unread — suhbat ochiq bo'lmasa ham shu zahoti
  inboxSend(otherUid, { chatId, from: state.me.uid, id, text: previewText.slice(0, 120), ts: nowMs });

  // Chat ro'yxatida suhbat darhol saqlansin
  if (!chatState._latestChatMap[otherUid]) {
    chatState._latestChatMap[otherUid] = {
      id: chatId, participants: [state.me.uid, otherUid], createdAt: nowMs,
      lastMessage: previewText.slice(0, 120), lastSenderId: state.me.uid, lastMessageAt: nowMs, unreadCount: {}
    };
  } else {
    chatState._latestChatMap[otherUid].lastMessage = previewText.slice(0, 120);
    chatState._latestChatMap[otherUid].lastMessageAt = nowMs;
    chatState._latestChatMap[otherUid].lastSenderId = state.me.uid;
  }

  try {
    // 3) Baza (haqiqat manbai) — xuddi shu ID bilan, dedup uchun
    const { error } = await sb.from('messages')
      .insert({ id, chat_id: chatId, sender_id: state.me.uid, type: 'text', text: finalMsgText, reply_to: replyToId });
    if (error) throw error;
    // DB tasdiqladi — clock → 1 chek (faqat tick, to'liq paint YO'Q)
    const conf = chatState._rtLocal.get(id);
    if (conf) { conf.status = 'sent'; conf._at = Date.now(); chatState._rtLocal.set(id, conf); }
    if (state.currentChatId === chatId) {
      if (typeof chatUI.updateMsgTicks === 'function') chatUI.updateMsgTicks(id, 'sent');
      else chatUI.paintMessages(chatState._curMsgs.map(m => m.id === id ? { ...m, status: 'sent' } : m));
    }
    chatState._reloadThread && chatState._reloadThread();
    // Push bildirishnoma push.js bosqichida ulanadi (Edge Function / DB webhook)
  } catch (err) {
    console.error('sendChatMessage failed:', err.message);
    toast('Xabar yuborilmadi', 'error');
    chatState._rtLocal.delete(id);
    if (chatState._rt && chatState._rtChatId === chatId) chatState._rt.retract(id);
    if (state.currentChatId === chatId) chatUI.paintMessages(chatState._curMsgs.filter(x => x.id !== id));
    inp.value = userText; // qaytarib qo'yamiz, user qayta yuborishi uchun
    if (postShare) chatUI.setPendingPostShare(postShare);
    chatUI.updateVoiceSendBtn();
  }
}

/** Qo'ng'iroq tugagach chatga yozuv qo'shadi (chaqiruvchi tomondan). connected=false → bekor qilingan/o'tkazib yuborilgan. */
export async function sendCallLog(chatId, otherUid, { connected = false, seconds = 0 } = {}) {
  if (!chatId || !state.me) return;
  const id = _uuid();
  const nowMs = Date.now();
  const text = JSON.stringify({ __callLog: true, s: connected ? 'ok' : 'no', d: connected ? Math.max(0, Math.round(seconds || 0)) : 0 });
  try {
    const { error } = await sb.from('messages').insert({ id, chat_id: chatId, sender_id: state.me.uid, type: 'text', text });
    if (error) throw error;
    // Peer ro'yxatida: o'zining nuqtai nazaridan (kiruvchi / o'tkazib yuborilgan)
    inboxSend(otherUid, { chatId, from: state.me.uid, id, text: connected ? "Kiruvchi qo'ng'iroq" : "O'tkazib yuborilgan qo'ng'iroq", ts: nowMs });
    const lc = chatState._latestChatMap[otherUid];
    if (lc) { lc.lastMessage = text; lc.lastMessageAt = nowMs; lc.lastSenderId = state.me.uid; }
    chatState._reloadThread && chatState._reloadThread();
  } catch (e) {
    console.warn('[callLog]', e?.message || e);
  }
}

export async function sendVoiceMessage(blob, duration) {
  if (state.currentChatKind && state.currentChatKind !== 'dm') return sendGroupVoice(blob, duration);
  if (!state.currentChatId || !state.me) return;
  if (!rateOk('msg', 15, 60000)) return;
  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;

  // 0ms: oddiy xabar kabi (id bilan) paintMessages oqimiga qo'shiladi — repaint'da yo'qolmaydi,
  // yuklash fonda ketadi, server xabari kelganda xuddi shu id bilan jimgina almashadi.
  const id = _uuid();
  const nowMs = Date.now();
  const localUrl = URL.createObjectURL(blob);
  registerLocalVoiceUrl(id, localUrl, voiceBarCount(duration));
  const localMsg = {
    id, chatId, senderId: state.me.uid, type: 'voice', text: null,
    mediaPath: null, mediaUrl: localUrl, mediaType: blob.type || null, fileName: null, fileSize: null,
    duration: Math.round(duration || 0),
    status: 'sending', readAt: null, editedAt: null, createdAt: nowMs, _at: nowMs + 120000,
  };
  chatState._rtLocal.set(id, localMsg);
  chatUI.paintMessages([...chatState._curMsgs, localMsg]);

  try {
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });
    const result = await uploadViaControllerProgress(file, 'chat-voice');

    const { error } = await sb.from('messages').insert({
      id, chat_id: chatId, sender_id: state.me.uid, type: 'voice',
      media_path: result.path, media_type: blob.type || null,
      duration: Math.round(duration || 0),
    });
    if (error) throw error;
    const conf = chatState._rtLocal.get(id);
    if (conf) {
      conf.status = 'sent';
      conf.mediaPath = result.path;
      conf.mediaUrl = result.url || conf.mediaUrl;
      conf._at = Date.now();
      chatState._rtLocal.set(id, conf);
    }
    // Tezkor yo'l: peer darhol ko'rsin (upload tugagach)
    if (chatState._rt && chatState._rtChatId === chatId) {
      chatState._rt.send({
        id, type: 'voice', mediaPath: result.path,
        mediaType: blob.type || null, duration: Math.round(duration || 0),
      });
    }
    inboxSend(otherUid, { chatId, from: state.me.uid, id, text: 'Ovozli xabar', ts: Date.now() });
    if (chatState._latestChatMap[otherUid]) {
      chatState._latestChatMap[otherUid].lastMessage = 'Ovozli xabar';
      chatState._latestChatMap[otherUid].lastMessageAt = Date.now();
      chatState._latestChatMap[otherUid].lastSenderId = state.me.uid;
    }
    if (state.currentChatId === chatId) {
      // media path/url kerak — engil map + tick (to'liq HTML rebuild emas, lekin path yangilansin)
      chatState._curMsgs = chatState._curMsgs.map(m => m.id === id ? { ...m, status: 'sent', mediaPath: result.path, mediaUrl: result.url || m.mediaUrl } : m);
      if (typeof chatUI.updateMsgTicks === 'function') chatUI.updateMsgTicks(id, 'sent');
      else chatUI.paintMessages(chatState._curMsgs);
    }
    chatState._reloadThread && chatState._reloadThread();
  } catch (err) {
    console.error('Voice send failed:', err);
    chatState._rtLocal.delete(id);
    if (state.currentChatId === chatId) chatUI.paintMessages(chatState._curMsgs.filter(x => x.id !== id));
    try { URL.revokeObjectURL(localUrl); } catch (_) {}
    toast('Ovozli xabar yuborilmadi', 'error');
  }
}

export async function sendChatFile(fileOverride = null, captionOverride = null) {
  const file = fileOverride || chatState._chatSelFile;
  if (!file || !state.me) return;
  if (!rateOk('file', 5, 30000)) return;

  const caption = (captionOverride !== null && captionOverride !== undefined
    ? captionOverride
    : ($('chatThreadInput')?.value || '')
  ).trim();

  // Route to group file send if in group mode
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    chatUI.clearChatFile();
    return sendGroupFile(file, caption);
  }
  if (!state.currentChatId) return;
  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;

  chatUI.clearChatFile();

  const id = _uuid();
  const nowMs = Date.now();
  const pendingId = id; // dedup uchun haqiqiy id
  _showPendingBubble(pendingId, 'file', file.size, file.name, file.type);

  try {
    const result = await uploadViaControllerProgress(file, 'chat-files', pct => {
      _updatePendingProgress(pendingId, pct);
    });

    _removePendingBubble(pendingId);

    const { error } = await sb.from('messages').insert({
      id, chat_id: chatId, sender_id: state.me.uid, type: 'file',
      media_path: result.path, media_type: file.type || null,
      file_name: file.name, file_size: file.size,
      text: caption || null,
    });
    if (error) throw error;
    const previewText = fileMsgPreview({ caption, fileName: file.name });
    // Tezkor yo'l: peer darhol ko'rsin
    if (chatState._rt && chatState._rtChatId === chatId) {
      chatState._rt.send({
        id, type: 'file', text: caption || null,
        mediaPath: result.path, mediaType: file.type || null,
        fileName: file.name, fileSize: file.size,
      });
    }
    if (chatState._latestChatMap[otherUid]) {
      chatState._latestChatMap[otherUid].lastMessage = previewText.slice(0, 120);
      chatState._latestChatMap[otherUid].lastMessageAt = Date.now();
      chatState._latestChatMap[otherUid].lastSenderId = state.me.uid;
    }
    inboxSend(otherUid, { chatId, from: state.me.uid, id, text: previewText.slice(0, 120), ts: Date.now() });
    chatState._reloadThread && chatState._reloadThread();

  } catch (err) {
    console.error('File send failed:', err);
    _removePendingBubble(pendingId);
    const inp = $('chatThreadInput');
    if (inp && caption) { inp.value = caption; chatUI.updateVoiceSendBtn(); }
    toast('Fayl yuborilmadi', 'error');
  }
}

export async function handleSendAction() {
  if (chatState._chatSelFile) {
    const inp = $('chatThreadInput');
    const text = inp ? inp.value.trim() : '';
    if (inp) {
    localStorage.removeItem('draft_' + (state.currentChatUid || state.currentChatId));

      inp.value = '';
      inp.style.height = '';
    }
    chatUI.updateVoiceSendBtn();
    await sendChatFile(null, text);
  } else {
    await sendChatMessage();
  }
}


