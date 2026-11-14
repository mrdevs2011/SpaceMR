import { protectSecrets, maskSpoilers, redactSpoilersForStorage } from '../core/secrets.js';
import { clearDraft, setDraft, activeChatScope } from '../core/drafts.js';

import { sb, state } from '../core/config.js';
import { $, esc, fmtSz, fmtTime } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { chatState, chatUI } from './chat-state.js';
import { uploadViaControllerProgress, _showPendingBubble, _updatePendingProgress, _removePendingBubble, _uuid, enqueueSequentialUpload, cancelUpload } from './chat-shared.js';
import { inboxSend } from '../core/rt-bus.js';
import { sendGroupMessage, sendGroupVoice, sendGroupFile, sendGroupAlbum } from './groups.js';
import { commitEdit, isEditing, getReplying, cancelReply } from './msg-menu.js';
import { rateOk } from '../core/rate-limit.js';
import { encodeForSend } from '../ui/emoji-img.js';
import { fileMsgPreview } from './components/video-note.js';
import { registerLocalVoiceUrl, voiceBarCount, getVoiceWaveform } from './chat-voice-player.js';

export async function sendChatMessage(opts) {
  const gifText = opts && typeof opts.text === 'string' ? opts.text : null;   // GIF: tayyor JSON matn (inputga tegilmaydi)
  // Route to group/channel send if in that mode
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    return sendGroupMessage(opts);
  }
  if (gifText == null && isEditing()) { await commitEdit($('chatThreadInput')?.value); return; }
  const inp  = $('chatThreadInput');
  const userText = gifText != null ? gifText : protectSecrets((inp?.value || '').trim());
  const postShare = gifText != null ? null : chatState._pendingPostShare;

  if ((!userText && !postShare) || !state.currentChatId || !state.me) return;
  if (!rateOk('msg', 15, 60000)) return;

  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;

  if (gifText == null) inp.value = '';
  if (postShare) {
    chatUI.clearPendingPostShare();
  } else {
    chatUI.updateVoiceSendBtn();
  }
  clearTimeout(chatState._typingTimeout);
  chatUI._setTyping(false);

  // Bazaga emoji RASM/BELGI emas, PATH yoziladi: [[emoji/2d/<kalit>.png]] (GIF/JSON xabarlarga tegilmaydi)
  let finalMsgText = postShare
    ? JSON.stringify({ __postShare: true, post: postShare, comment: encodeForSend(userText) })
    : (gifText != null ? userText : encodeForSend(userText));
  let _spoilerSecrets = [];
  // Spoilers are preserved as client-side blurred markdown (Telegram style), no redaction needed

  const replyInfo = getReplying();
  const replyToId = replyInfo?.id ? String(replyInfo.id) : null;
  if (replyInfo) cancelReply(false);

  const previewText = postShare
    ? (userText ? maskSpoilers(userText) : `Yozuv: ${postShare.authorName || 'Yozuv'}`)
    : (gifText != null ? 'GIF' : maskSpoilers(userText).slice(0, 120));

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
  chatState._curMsgs = [...chatState._curMsgs, localMsg];
  chatUI.paintMessages(chatState._curMsgs);
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
    if (_spoilerSecrets.length) {
      const { error: se } = await sb.rpc('store_message_secrets', {
        p_scope: 'dm', p_message_id: id, p_secrets: _spoilerSecrets
      });
      if (se) console.warn('store_message_secrets:', se.message);
    }
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
    // Oflayn/tarmoq: xabar ekranda qoladi — "yuborilmadi" + qayta urinish (ROADMAP 4)
    const conf = chatState._rtLocal.get(id);
    if (conf) {
      conf.status = 'failed';
      conf._at = Date.now();
      conf._payload = { text: finalMsgText, reply_to: replyToId, type: 'text' };
      chatState._rtLocal.set(id, conf);
    }
    if (state.currentChatId === chatId) {
      if (typeof chatUI.updateMsgTicks === 'function') chatUI.updateMsgTicks(id, 'failed');
      else chatUI.paintMessages(chatState._curMsgs.map(m => m.id === id ? { ...m, status: 'failed' } : m));
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    toast(offline ? "Internet yo'q, qayta urinib ko'ring" : 'Xabar yuborilmadi', 'error');
  }
}

/** Failed xabarni qayta yuborish (tick ! bosilganda). */
export async function retryFailedMessage(msgId) {
  if (!msgId || !state.me) return;
  const conf = chatState._rtLocal.get(msgId);
  if (!conf || conf.status !== 'failed') return;
  const chatId = conf.chatId || state.currentChatId;
  if (!chatId) return;
  conf.status = 'sending';
  conf._at = Date.now();
  chatState._rtLocal.set(msgId, conf);
  if (state.currentChatId === chatId && typeof chatUI.updateMsgTicks === 'function') {
    chatUI.updateMsgTicks(msgId, 'sending');
  }
  const p = conf._payload || { text: conf.text, reply_to: conf.replyTo || null, type: conf.type || 'text' };
  try {
    const row = {
      id: msgId,
      chat_id: chatId,
      sender_id: state.me.uid,
      type: p.type || 'text',
      text: p.text ?? conf.text ?? null,
      reply_to: p.reply_to ?? conf.replyTo ?? null,
    };
    if (p.media_path) {
      row.media_path = p.media_path;
      row.media_type = p.media_type ?? null;
      row.file_name = p.file_name ?? null;
      row.file_size = p.file_size ?? null;
      row.duration = p.duration ?? null;
    }
    const { error } = await sb.from('messages').insert(row);
    if (error) throw error;
    conf.status = 'sent';
    conf._at = Date.now();
    chatState._rtLocal.set(msgId, conf);
    if (state.currentChatId === chatId && typeof chatUI.updateMsgTicks === 'function') {
      chatUI.updateMsgTicks(msgId, 'sent');
    }
  } catch (err) {
    console.error('retryFailedMessage:', err?.message || err);
    conf.status = 'failed';
    conf._at = Date.now();
    chatState._rtLocal.set(msgId, conf);
    if (state.currentChatId === chatId && typeof chatUI.updateMsgTicks === 'function') {
      chatUI.updateMsgTicks(msgId, 'failed');
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    toast(offline ? "Internet yo'q, qayta urinib ko'ring" : 'Xabar yuborilmadi', 'error');
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
  const _vReply = getReplying();
  const _vReplyTo = _vReply?.id ? String(_vReply.id) : null;
  if (_vReply) cancelReply(false);
  const localMsg = {
    id, chatId, senderId: state.me.uid, type: 'voice', text: null,
    mediaPath: null, mediaUrl: localUrl, mediaType: blob.type || null, fileName: null, fileSize: null,
    duration: Math.round(duration || 0),
    status: 'sending', readAt: null, editedAt: null, createdAt: nowMs, _at: nowMs + 120000,
    replyTo: _vReplyTo,
    replyPreview: _vReply ? { name: _vReply.name, text: _vReply.preview, type: _vReply.type } : null,
  };
  chatState._rtLocal.set(id, localMsg);
  chatState._curMsgs = [...chatState._curMsgs, localMsg];
  chatUI.paintMessages(chatState._curMsgs);

  try {
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });
    const result = await uploadViaControllerProgress(file, 'chat-voice');

    // To'lqin (0..31) — yozib olingan ovoz uchun serverda saqlanadi; mp3 kabi yuklangan fayllarda YO'Q
    const waveform = await getVoiceWaveform(localUrl, voiceBarCount(duration));
    const row = {
      id, chat_id: chatId, sender_id: state.me.uid, type: 'voice',
      media_path: result.path, media_type: blob.type || null,
      duration: Math.round(duration || 0),
      reply_to: _vReplyTo,
      ...(waveform ? { waveform } : {}),
    };
    let { error } = await sb.from('messages').insert(row);
    // 069 migratsiya hali yurgizilmagan bo'lsa (waveform ustuni yo'q) — to'lqinsiz qayta urinamiz
    if (error && waveform && /waveform|PGRST204|42703/i.test(`${error.code || ''} ${error.message || ''}`)) {
      delete row.waveform;
      ({ error } = await sb.from('messages').insert(row));
    }
    if (error) throw error;
    const conf = chatState._rtLocal.get(id);
    if (conf) {
      conf.waveform = waveform;
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
        waveform: waveform || null,
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
    toast('Ovozli xabar yuborilmadi: ' + String(err?.message || err?.error || err?.statusCode || err).slice(0, 140) + (err?.code ? ' [' + err.code + ']' : ''), 'error');
  }
}

export async function sendChatAlbum(mediaFiles, captionOverride = '') {
  if (!mediaFiles || !mediaFiles.length || !state.me) return;
  if (!state.currentChatId) return;

  const caption = protectSecrets((captionOverride || '').trim());
  const chatId = state.currentChatId;
  const otherUid = state.currentChatUid;
  const albumId = _uuid();
  const nowMs = Date.now();

  const _fReply = getReplying();
  const _fReplyTo = _fReply?.id ? String(_fReply.id) : null;
  if (_fReply) cancelReply(false);

  // 1) 0ms Optimistik albom elementlari
  const albumItems = mediaFiles.map((file, idx) => {
    const isVid = (file.type || '').startsWith('video/');
    let objUrl = '';
    try { objUrl = URL.createObjectURL(file); } catch (_) {}
    return {
      id: `${albumId}_${idx}`,
      file,
      url: objUrl,
      mediaUrl: objUrl,
      type: file.type || (isVid ? 'video/mp4' : 'image/jpeg'),
      name: file.name || (isVid ? 'video.mp4' : 'image.jpg'),
      size: file.size || 0,
      status: 'uploading',
      progress: 0,
      path: null,
    };
  });

  const optimisticMsg = {
    id: albumId,
    chatId,
    senderId: state.me.uid,
    type: 'album',
    albumId,
    items: albumItems,
    text: caption || null,
    status: 'sending',
    createdAt: nowMs,
    _at: nowMs,
    replyTo: _fReplyTo,
    replyPreview: _fReply ? { name: _fReply.name, text: _fReply.preview, type: _fReply.type } : null,
  };

  chatState._rtLocal.set(albumId, optimisticMsg);
  chatState._curMsgs = [...chatState._curMsgs, optimisticMsg];
  chatUI.paintMessages(chatState._curMsgs);

  // 2) Ketma-ket (sequential) navbatda bittalab yuklash (50kbps bardoshli)
  for (let i = 0; i < albumItems.length; i++) {
    const item = albumItems[i];
    if (item.status === 'cancelled') continue;
    try {
      const res = await enqueueSequentialUpload({
        id: item.id,
        file: item.file,
        folder: 'chat-files',
        onProgress: pct => {
          item.progress = pct;
        },
      });

      item.status = 'sent';
      item.path = res.path;
      item.url = res.url || item.url;
    } catch (err) {
      console.warn(`Album item [${i}] upload failed:`, err?.message || err);
      item.status = (err?.name === 'AbortError' || err?.message?.includes('cancelled')) ? 'cancelled' : 'failed';
    }
  }

  // 3) Muvaffaqiyatli yuklangan elementlarni saqlash
  const successfulItems = albumItems.filter(it => it.status === 'sent' && it.path);
  if (!successfulItems.length) {
    chatState._rtLocal.delete(albumId);
    chatUI.paintMessages(chatState._curMsgs.filter(m => m.id !== albumId));
    toast('Albom yuklanmadi', 'error');
    return;
  }

  const payloadText = JSON.stringify({
    __album: true,
    albumId,
    caption: caption || '',
    items: successfulItems.map(it => ({
      id: it.id,
      path: it.path,
      url: it.url || null,
      type: it.type,
      name: it.name,
      size: it.size,
    })),
  });

  try {
    const coverPath = successfulItems[0]?.path || null;
    const { error } = await sb.from('messages').insert({
      id: albumId,
      chat_id: chatId,
      sender_id: state.me.uid,
      type: 'file',
      text: payloadText,
      media_path: coverPath,
      media_type: successfulItems[0]?.type || 'image/jpeg',
      file_name: successfulItems[0]?.name || 'album',
      file_size: successfulItems.reduce((acc, it) => acc + (it.size || 0), 0),
      reply_to: _fReplyTo,
    });

    if (error) throw error;

    optimisticMsg.status = 'sent';
    optimisticMsg.items = successfulItems;
    chatState._curMsgs = chatState._curMsgs.map(m => m.id === albumId ? { ...m, status: 'sent', items: successfulItems } : m);
    if (typeof chatUI.updateMsgTicks === 'function') chatUI.updateMsgTicks(albumId, 'sent');
    else chatUI.paintMessages(chatState._curMsgs);

    const previewText = caption ? maskSpoilers(caption) : `Albom (${successfulItems.length} ta media)`;
    if (chatState._rt && chatState._rtChatId === chatId) {
      chatState._rt.send({
        id: albumId,
        type: 'album',
        albumId,
        text: caption || null,
        items: successfulItems,
        mediaPath: coverPath,
      });
    }
    inboxSend(otherUid, { chatId, from: state.me.uid, id: albumId, text: previewText.slice(0, 120), ts: Date.now() });
    if (chatState._latestChatMap[otherUid]) {
      chatState._latestChatMap[otherUid].lastMessage = previewText.slice(0, 120);
      chatState._latestChatMap[otherUid].lastMessageAt = Date.now();
      chatState._latestChatMap[otherUid].lastSenderId = state.me.uid;
    }
    chatState._reloadThread && chatState._reloadThread();
  } catch (err) {
    console.error('Album DB save failed:', err);
    toast('Albom saqlanmadi', 'error');
  }
}

export async function sendChatFile(fileOverride = null, captionOverride = null) {
  const file = fileOverride || chatState._chatSelFile;
  if (!file || !state.me) return;

  const caption = protectSecrets((captionOverride !== null && captionOverride !== undefined
    ? captionOverride
    : ($('chatThreadInput')?.value || '')
  ).trim());

  // Route to group file send if in group mode
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    chatUI.clearChatFile();
    return sendGroupFile(file, caption);
  }
  if (!state.currentChatId) return;
  const chatId   = state.currentChatId;
  const otherUid = state.currentChatUid;

  chatUI.clearChatFile();

  const _fReply = getReplying();
  const _fReplyTo = _fReply?.id ? String(_fReply.id) : null;
  if (_fReply) cancelReply(false);

  const id = _uuid();
  const nowMs = Date.now();
  const isMedia = (file.type || '').startsWith('image/') || (file.type || '').startsWith('video/');
  let localUrl = '';
  if (isMedia) {
    try { localUrl = URL.createObjectURL(file); } catch (_) {}
  }

  // 0ms Optimistik xabar — foydalanuvchi o'z faylini darhol chatda ko'radi
  const localMsg = {
    id, chatId, senderId: state.me.uid, type: 'file', text: caption || null,
    mediaPath: null, mediaUrl: localUrl || '', mediaType: file.type || null,
    fileName: file.name, fileSize: file.size, duration: null,
    status: 'sending', readAt: null, editedAt: null, createdAt: nowMs, _at: nowMs,
    replyTo: _fReplyTo,
    replyPreview: _fReply ? { name: _fReply.name, text: _fReply.preview, type: _fReply.type } : null,
  };
  chatState._rtLocal.set(id, localMsg);
  chatState._curMsgs = [...chatState._curMsgs, localMsg];
  chatUI.paintMessages(chatState._curMsgs);

  try {
    // Ketma-ket (sequential) navbat: tarmoq tiqilmaydi, retry bor, cancel qo'llab-quvvatlaydi
    const result = await enqueueSequentialUpload({
      id,
      file,
      folder: 'chat-files',
    });

    const { error } = await sb.from('messages').insert({
      id, chat_id: chatId, sender_id: state.me.uid, type: 'file',
      media_path: result.path, media_type: file.type || null,
      file_name: file.name, file_size: file.size,
      text: caption || null,
      reply_to: _fReplyTo,
    });
    if (error) throw error;

    localMsg.status = 'sent';
    localMsg.mediaPath = result.path;
    localMsg.mediaUrl = result.url || localUrl;
    chatState._curMsgs = chatState._curMsgs.map(m =>
      m.id === id ? { ...m, status: 'sent', mediaPath: result.path, mediaUrl: result.url || localUrl } : m
    );
    if (typeof chatUI.updateMsgTicks === 'function') chatUI.updateMsgTicks(id, 'sent');
    else chatUI.paintMessages(chatState._curMsgs);

    const previewText = fileMsgPreview({ caption: maskSpoilers(caption), fileName: file.name });
    if (chatState._rt && chatState._rtChatId === chatId) {
      chatState._rt.send({
        id, type: 'file', text: caption || null,
        mediaPath: result.path, mediaType: file.type || null,
        fileName: file.name, fileSize: file.size,
        replyTo: _fReplyTo,
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
    chatState._rtLocal.delete(id);
    chatState._curMsgs = chatState._curMsgs.filter(m => m.id !== id);
    chatUI.paintMessages(chatState._curMsgs);
    try { if (localUrl) URL.revokeObjectURL(localUrl); } catch (_) {}
    if (err?.name !== 'AbortError') {
      toast('Fayl yuborilmadi', 'error');
    }
  }
}

let _sendLock = false;
function _draftScope() { return activeChatScope(); }
export async function handleSendAction() {
  if (_sendLock) return;
  _sendLock = true;
  const scope = _draftScope();
  try {
    const multiFiles = chatState._chatSelFiles;
    const hasMulti = Array.isArray(multiFiles) && multiFiles.length > 0;
    const hasSingle = !hasMulti && !!chatState._chatSelFile;

    if (hasMulti || hasSingle) {
      const inp = $('chatThreadInput');
      const text = inp ? inp.value.trim() : '';
      if (inp) {
        inp.value = '';
        inp.style.height = '';
      }
      chatUI.updateVoiceSendBtn();

      const files = hasMulti ? multiFiles.map(f => f.file) : [chatState._chatSelFile];
      chatUI.clearChatFile();

      // Media (rasm/video) va boshqa hujjatlarni ajratamiz
      const mediaList = [];
      const docList = [];
      for (const f of files) {
        const mime = (f.type || '').toLowerCase();
        if (mime.startsWith('image/') || mime.startsWith('video/')) {
          mediaList.push(f);
        } else {
          docList.push(f);
        }
      }

      // 1. Agar medialar 2 yoki undan ko'p bo'lsa -> Telegram Albom (Kollaj)!
      if (mediaList.length >= 2) {
        if (state.currentChatKind && state.currentChatKind !== 'dm') {
          await sendGroupAlbum(mediaList, text);
        } else {
          await sendChatAlbum(mediaList, text);
        }
      } else if (mediaList.length === 1) {
        // Faqat bitta media bo'lsa
        if (state.currentChatKind && state.currentChatKind !== 'dm') {
          sendGroupFile(mediaList[0], text);
        } else {
          sendChatFile(mediaList[0], text);
        }
      }

      // 2. Oddiy fayllar (doc, pdf, zip...) har biri 0ms da chatga tushadi va sequential navbatda yuklanadi
      for (let i = 0; i < docList.length; i++) {
        const caption = (mediaList.length === 0 && i === 0) ? text : '';
        if (state.currentChatKind && state.currentChatKind !== 'dm') {
          sendGroupFile(docList[i], caption);
        } else {
          sendChatFile(docList[i], caption);
        }
      }

      clearDraft(scope);
    } else {
      await sendChatMessage();
      clearDraft(scope);
    }
  } finally {
    _sendLock = false;
  }
}




// Internet qaytganda failed xabarlarni avtomatik qayta urinish (ROADMAP 4)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const ids = [];
    try {
      for (const [id, m] of chatState._rtLocal.entries()) {
        if (m && m.status === 'failed') ids.push(id);
      }
    } catch (_) {}
    ids.forEach(id => { retryFailedMessage(id).catch(() => {}); });
  });
}
