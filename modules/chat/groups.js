/**
 * SpaceMR — Guruhlar va Kanallar moduli
 * Groups & Channels for SpaceMR chat
 *
 * Ma'lumot shakli (Supabase qatorlaridan config.js dagi mapGroup()/mapMessage()
 * eski Firestore ko'rinishida yasaydi):
 *   groups/{groupId} {
 *     type: 'group',
 *     name, avatar, description?,
 *     ownerId, adminIds: [uid,...],
 *     members: [uid,...],
 *     lastMessage, lastSenderId, lastMessageAt,
 *     unreadCount: { [uid]: number },
 *     createdAt, subscriberCount (channel only)
 *   }
 *   groups/{groupId}/messages/{msgId} {
 *     senderId, text?, type?, mediaUrl?, mediaPath?,
 *     mediaType?, fileName?, fileSize?, duration?,
 *     createdAt, status: 'sent'
 *   }
 */

import { sb, state, uploadViaController, isAdmin, fetchAllRows, mapProfile, mapGroup, mapMessage, ts } from '../core/config.js';
import { isSyncV2Enabled, bindGroupTombstoneChannel, setCursor, loadGroupDelta } from '../core/store/sync.js';
import { $, esc, renderMarkdown, defAvi, fmt, fmtTime, fmtSz, lockScroll, unlockScroll, isOnline, isActiveUser, showConfirm } from '../core/utils.js';
import { toast }                                    from '../ui/toast.js';
import { rateOk }                                   from '../core/rate-limit.js';
import { emojiOnlyClass, wrapEmojiNoSelect, playRemoteEmoji } from '../ui/emoji-only.js';
import { encodeForSend } from '../ui/emoji-img.js';
import { registerLocalVoiceUrl, voiceBarCount, getVoiceWaveform } from './chat-voice-player.js';
import { openRtGroup }                              from './rt-chat.js';
import { fileMsgPreview }                           from './components/video-note.js';
import { busOn, groupJoin, groupInboxSend, isUidOnline } from '../core/rt-bus.js';
import {
  _toDateSafe, _isSameDay, _dateSepLabel,
  _showPendingBubble, _updatePendingProgress, _removePendingBubble,
  uploadViaControllerProgress, ensureChatsView,
} from './chat-shared.js';
import { chatUI } from './chat-state.js';
import { isEditing, commitEdit, getReplying, cancelReply } from './msg-menu.js';

/* ─────────────────────────────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────────────────────────────── */
let _groupsUnsub     = null;
let _groupThreadUnsub = null;
let _latestGroupMap  = {};   // groupId → group data (for list rendering)
export let groupListItems = []; // exported so chat.js can merge
let _currentGroupId  = null;
let _currentGroupData = null;
import { markDissolve } from '../ui/dissolve.js';
let _gMsgs = [];            // joriy guruh threadidagi xabarlar (realtime payload shu ro'yxatga qo'llanadi)
let _gLoaded = false;
let _gReadMax = 0;          // boshqa a'zolardan biri o'qigan eng so'nggi vaqt (ms) — 062 (last_read_at)
let _gRt = null;            // guruh uchun WebRTC mesh (zaxira: broadcast)
const _gPending = new Map(); // bazadan hali tasdiqlanmagan optimistik xabarlar
const _gUuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
let _groupChatSelFile = null;
let _reloadGroupThread = null;
let _groupsTick = null;

/* ── Vaqt konstantalari (ms) ─────────────────────────────────────────── */
const TYPING_EXPIRE_MS   = 5000; // "yozmoqda" belgisi avtomatik o'chishi
const TYPING_STOP_MS     = 2500; // yozishdan to'xtagach typing=false yuborish
const FOCUS_DELAY_MS     = 150;  // modal ochilgach inputga fokus
const OPEN_CHAT_DELAY_MS = 200;  // chat threadni ochishdan oldin kutish
const OPEN_GROUP_DELAY_MS = 300; // guruh threadni ochishdan oldin kutish

/* ── Yordamchilar (Supabase) ─────────────────────────────────────────── */
/** id lar bo'yicha profillar: { uid: mapProfile(...) } — bitta so'rov */
async function _profilesByIds(ids) {
  const out = {};
  const list = [...new Set((ids || []).filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const { data } = await sb.from('profiles').select('*').in('id', list.slice(i, i + 100));
    (data || []).forEach(r => { out[r.id] = mapProfile(r); });
  }
  return out;
}

/** Men a'zo bo'lgan guruh/kanallarni yuklab, ro'yxatni yangilaydi */
/* Birinchi yuklash tugaganini bildiradi (chatlar ro'yxati eski/yarim ma'lumotni chizmasligi uchun) */
let _gReadyRes = null;
let _gReadyP = new Promise(r => { _gReadyRes = r; });
export function groupsReady() { return _gReadyP; }

async function _loadGroups() {
  try { await _loadGroupsInner(); } finally { _gReadyRes?.(); }
}
async function _loadGroupsInner() {
  const me = state.me?.uid;
  if (!me) return;
  const { data: mine, error: e1 } = await sb.from('group_members').select('group_id').eq('user_id', me);
  if (state.me?.uid !== me) return;
  if (e1) { console.warn('[Groups] watcher error:', e1.message); return; }
  const ids = (mine || []).map(r => r.group_id);
  let rows = [];
  if (ids.length) {
    const { data, error } = await sb.from('groups')
      .select('*, group_members(user_id, role, unread_count)').in('id', ids);
    if (state.me?.uid !== me) return;
    if (error) { console.warn('[Groups] watcher error:', error.message); return; }
    rows = data || [];
  }
  _latestGroupMap = {};
  groupListItems = [];
  rows.forEach(r => {
    const g = mapGroup(r);
    _latestGroupMap[g.id] = g;
    groupListItems.push(g);
  });
  ids.forEach(groupJoin);
  if (_currentGroupId && _latestGroupMap[_currentGroupId]) _currentGroupData = _latestGroupMap[_currentGroupId];
  // Ochiq guruh ro'yxatdan yo'qoldi — o'chirilgan bo'lishi mumkin (realtime hodisa o'tib ketgan bo'lsa ham ushlaymiz)
  if (_currentGroupId && !_latestGroupMap[_currentGroupId]) _verifyCurrentGroupExists(_currentGroupId);
  // Thread ochiq bo'lsa — admin sozlamani o'zgartirgan bo'lishi mumkin: input qatorini qayta hisoblaymiz
  if (_currentGroupId && _currentGroupData) _applyGroupComposer(_currentGroupData);
  // Notify chat.js list to repaint
  if (state.view === 'chats') document.dispatchEvent(new CustomEvent('groupsUpdated'));
  handleGroupDeepLinks();
}

async function _addMembers(groupId, uids, writerSet = null) {
  const rows = uids.map(uid => ({
    group_id: groupId,
    user_id: uid,
    role: 'member',
    can_write: writerSet ? writerSet.has(uid) : true,
  }));
  const { error } = await sb.from('group_members')
    .upsert(rows, { onConflict: 'group_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
  // ignoreDuplicates may skip can_write — yangilash
  if (writerSet) {
    for (const uid of uids) {
      try {
        await sb.from('group_members').update({ can_write: writerSet.has(uid) })
          .eq('group_id', groupId).eq('user_id', uid);
      } catch (_) {}
    }
  }
  _loadGroups();
}

async function _removeMember(groupId, uid) {
  const { data, error } = await sb.from('group_members').delete()
    .eq('group_id', groupId).eq('user_id', uid).select();
  if (error) throw error;
  if (!data || !data.length) throw new Error("Ruxsat yo'q");
  _loadGroups();
}

function _myNoticeName() {
  return (state.me?.displayName || state.me?.username || 'User').trim() || 'User';
}
function _showNoticeNow(groupId, text) {
  if (_currentGroupId !== groupId || !_gLoaded || !text) return;
  const id = (crypto.randomUUID && crypto.randomUUID()) || ('nt_' + Date.now());
  _gIncoming(groupId, { id, from: state.me.uid, text, type: 'text', notice: true });
}
function _pushGroupLive(groupId, payload) {
  if (!groupId) return;
  groupInboxSend(groupId, { gid: groupId, from: state.me?.uid, ts: Date.now(), ...payload });
  if (_currentGroupId === groupId) {
    try { _gRt?.send({ id: payload.id, type: 'text', text: payload.text, notice: true }); } catch (_) {}
  }
}
async function _postGroupNotice(groupId, text) {
  if (!groupId || !state.me?.uid || !text) return;
  const id = (crypto.randomUUID && crypto.randomUUID()) || ('nt_' + Date.now());
  _showNoticeNow(groupId, text);
  _pushGroupLive(groupId, { id, kind: 'notice', text });
  const { error } = await sb.from('group_messages').insert({
    id, group_id: groupId, sender_id: state.me.uid, type: 'text', text,
  });
  if (error) console.warn('[group notice]', error.message);
}
function _pushGroupMeta(groupId, patch) {
  _pushGroupLive(groupId, { id: 'meta_' + Date.now(), kind: 'meta', text: patch.lastMessage || '', meta: patch });
}
async function _joinedNotices(groupId, uids) {
  const ids = [...new Set((uids || []).filter(Boolean))];
  if (!ids.length) return;
  const map = await _profilesByIds(ids);
  for (const uid of ids) {
    const u = map[uid];
    const name = (u?.fullName || u?.username || 'User').trim() || 'User';
    await _postGroupNotice(groupId, name + ' guruhga qo\'shildi');
  }
}

export async function joinGroup(groupId) {
  if (!state.me?.uid || !groupId) return;
  await _addMembers(groupId, [state.me.uid]);
  await _postGroupNotice(groupId, _myNoticeName() + ' guruhga qo\'shildi');
  _pushGroupMeta(groupId, { count: ((_latestGroupMap[groupId]?.members || []).length || 0) + 1 });
}

export async function leaveGroup(groupId) {
  if (!state.me?.uid || !groupId) return;
  const { error } = await sb.rpc('leave_group', { p_group: groupId });
  if (error && (error.code === '42501' || /egasi chiqa olmaydi|a'zo emassiz/i.test(error.message || ''))) {
    // Egasi chiqa olmaydi / a'zo emas — bu RPC'ning yo'qligi emas, qayta urinish (fallback) kerak emas
    const e = new Error(/egasi/i.test(error.message || '') ? "Egasi chiqa olmaydi — avval egalikni topshiring yoki o'chiring" : "Bu guruhda a'zo emassiz");
    e.expected = true;
    throw e;
  }
  if (error) {
    // RPC yo'q bo'lsa: avval xabar, keyin a'zolik (xabar a'zo bo'lib turib yoziladi)
    const name = (state.me.displayName || state.me.username || 'User').trim() || 'User';
    const note = await sb.from('group_messages').insert({
      group_id: groupId,
      sender_id: state.me.uid,
      type: 'text',
      text: name + ' guruhdan chiqdi',
    });
    if (note.error && !/left the group|guruhdan chiqdi/.test(note.error.message || '')) {
      console.warn('[leave] notice:', note.error.message);
    }
    await _removeMember(groupId, state.me.uid);
  }
  delete _latestGroupMap[groupId];
  if (_currentGroupId === groupId) {
    _currentGroupId = null;
    _currentGroupData = null;
  }
  await _loadGroups();
}

async function _updateGroup(groupId, patch) {
  const { data, error } = await sb.from('groups').update(patch).eq('id', groupId).select();
  if (error) throw error;
  if (!data || !data.length) throw new Error("Ruxsat yo'q");
  await _loadGroups();
}

let _gSelfDel = null;
async function _deleteGroup(groupId) {
  _gSelfDel = groupId; setTimeout(() => { if (_gSelfDel === groupId) _gSelfDel = null; }, 5000);
  const { data, error } = await sb.from('groups').delete().eq('id', groupId).select();
  if (error) throw error;
  if (!data || !data.length) throw new Error("Ruxsat yo'q");
  await _loadGroups();
}

function _resetGroupUnread(groupId) {
  const me = state.me?.uid;
  if (!me) return;
  // "O'qildi" faqat ekran ko'rinib turganda (tab yashirin bo'lsa — "kimlar ko'rdi" yolg'on bo'lmasin)
  if (document.visibilityState !== 'visible') return;
  if (_latestGroupMap[groupId]?.unreadCount) _latestGroupMap[groupId].unreadCount[me] = 0;
  sb.from('group_members').update({ unread_count: 0 })
    .eq('group_id', groupId).eq('user_id', me).then(() => {}, () => {});
}

// Ochiq guruh chati orqa fondan qaytganda — kelib turgan xabarlar endi o'qilgan hisoblanadi
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _currentGroupId) _resetGroupUnread(_currentGroupId);
});

/* ─────────────────────────────────────────────────────────────────────
   WATCHER — real-time listener for groups/channels the user is in
   ───────────────────────────────────────────────────────────────────── */
export function startGroupsWatcher() {
  if (_groupsUnsub || !state.me?.uid) return;
  // Realtime tinglovchilar alohida kanalda emas — chat.js 'chats-watcher' kanaliga
  // bindGroupsRealtime() orqali ulanadi (roadmap 5.3).
  // DELETE hodisalari filtr bilan kelmaydi (masalan guruhdan chiqarilish) — zaxira so'rov
  _groupsTick = setInterval(_loadGroups, 60000);
  _groupsUnsub = () => { clearTimeout(_groupsTimer); clearInterval(_groupsTick); _groupsTick = null; };
  _loadGroups();
}

let _groupsTimer = null;
const _groupsSched = () => { clearTimeout(_groupsTimer); _groupsTimer = setTimeout(_loadGroups, 0); };
/* Uyg'onish / internet qaytishi: guruhlar ro'yxati qayta yuklanadi */
window.addEventListener('spacemr:resync', () => { if (_groupsUnsub) _groupsSched(); });

/** Ochiq guruh o'chirildi — chat.js thread'ni yopib, chatlar ro'yxatiga qaytaradi */
function _notifyGroupGone(id) {
  if (!id || _gSelfDel === id || _currentGroupId !== id) return;
  document.dispatchEvent(new CustomEvent('chat:group-deleted', { detail: { id } }));
}
async function _verifyCurrentGroupExists(gid) {
  try {
    const { data, error } = await sb.from('groups').select('id').eq('id', gid).maybeSingle();
    if (!error && !data) _notifyGroupGone(gid);
  } catch (_) {}
}

/** Guruh o'zgarishlarini berilgan (hali subscribe qilinmagan) kanalga ulaydi. */
export function bindGroupsRealtime(ch) {
  const me = state.me?.uid;
  if (!me) return ch;
  return ch
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, p => {
      const id = p.new?.id || p.old?.id;
      if (p.eventType === 'DELETE' && id && id === _currentGroupId) _notifyGroupGone(id);
      if (id && _latestGroupMap[id]) _groupsSched();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `user_id=eq.${me}` }, _groupsSched);
}

export function stopGroupsWatcher() {
  if (_groupsUnsub) { _groupsUnsub(); _groupsUnsub = null; }
  if (_groupThreadUnsub) { _groupThreadUnsub(); _groupThreadUnsub = null; }
  _latestGroupMap  = {};
  groupListItems   = [];
  _gReadyP = new Promise(r => { _gReadyRes = r; });   // keyingi akkaunt/kirish uchun qayta
  _currentGroupId  = null;
  _currentGroupData = null;
}

/** P2P/broadcast orqali kelgan guruh xabari — bazadan oldin ko'rsatiladi (id bo'yicha dedup) */
function _gIncoming(groupId, m) {
  if (!m?.id || _currentGroupId !== groupId || !_gLoaded) return;
  if (_gPending.has(m.id) || _gMsgs.some(x => x.id === m.id)) return;
  if (m.from === state.me?.uid && !m.notice) return;
  const notice = m.notice || / (joined the group|left the group|changed the group photo|changed the group username|changed the group name|guruhga qo'shildi|guruhdan chiqdi|guruh nomini o'zgartirdi|guruh rasmini o'zgartirdi|guruh usernameini o'zgartirdi)$/.test(m.text || '');
  if (!notice && !(_currentGroupData?.members || []).includes(m.from) && m.from !== state.me?.uid) return;
  const now = Date.now();
  const type = m.type || 'text';
  const row = {
    id: m.id, group_id: groupId, sender_id: m.from, type,
    text: m.text || null,
    media_path: m.mediaPath || null,
    media_type: m.mediaType || null,
    file_name: m.fileName || null,
    file_size: m.fileSize ?? null,
    duration: m.duration ?? null,
    waveform: Array.isArray(m.waveform) ? m.waveform : null,
    created_at: new Date(now).toISOString(),
  };
  const msg = mapMessage(row);
  msg._at = now;
  _gPending.set(m.id, msg);
  _gMsgs = [..._gMsgs, msg];
  paintGroupMessages(_gMsgs, _currentGroupData);
  if (document.visibilityState === 'visible') _resetGroupUnread(groupId);
}

/* ── Tezkor kirish qutisi: guruh ro'yxati preview/unread shu zahoti ── */
busOn('ginbox', (o) => {
  const me = state.me?.uid;
  if (!me || !o || !o.gid || o.from === me) return;
  if (o.kind === 'notice' && _currentGroupId === o.gid) {
    _gIncoming(o.gid, { id: o.id, from: o.from, text: o.text, type: 'text', notice: true });
  }
  if (o.kind === 'meta' && _currentGroupId === o.gid && o.meta) {
    const g0 = _currentGroupData;
    if (g0 && g0.id === o.gid) {
      if (o.meta.name) { g0.name = o.meta.name; const n = document.getElementById('chatThreadName'); if (n) n.textContent = o.meta.name; }
      if (o.meta.avatar) { g0.avatar = o.meta.avatar; const a = document.getElementById('chatThreadAvi'); if (a) a.innerHTML = `<img src="${esc(o.meta.avatar)}" onerror="this.style.display='none'">`; }
      if (o.meta.username != null) g0.username = o.meta.username;
      if (o.meta.count != null) _setGroupPeopleLabel(o.meta.count);
    }
  }
  const g = _latestGroupMap[o.gid];
  if (!g) return;
  if (o.kind === 'meta' && o.meta) {
    if (o.meta.name) g.name = o.meta.name;
    if (o.meta.avatar) g.avatar = o.meta.avatar;
    if (o.meta.username != null) g.username = o.meta.username;
    if (o.meta.count != null) g.subscriberCount = o.meta.count;
    if (state.view === 'chats') document.dispatchEvent(new CustomEvent('groupsUpdated'));
    if (_currentGroupId === o.gid) return;
  }
  if (_currentGroupId === o.gid) return;            // ochiq thread o'zi yangilanadi
  if (g._lastId === o.id) return;
  g._lastId = o.id;
  g.lastMessage = String(o.text || '').slice(0, 120);
  g.lastSenderId = o.from;
  g.lastMessageAt = o.ts || Date.now();
  g.unreadCount = { ...(g.unreadCount || {}), [me]: ((g.unreadCount || {})[me] || 0) + 1 };
  if (state.view === 'chats') document.dispatchEvent(new CustomEvent('groupsUpdated'));
});

/* ─────────────────────────────────────────────────────────────────────
   OPEN GROUP/CHANNEL THREAD
   ───────────────────────────────────────────────────────────────────── */
function _setGroupPeopleLabel(n) {
  const el = document.getElementById('chatTypingStatus');
  if (!el) return;
  const count = Math.max(0, Number(n) || 0);
  el.textContent = count + ' ta odam';
  el.dataset.people = String(count);
}

async function _loadGroupPeople(groupId) {
  const g = _latestGroupMap[groupId] || _currentGroupData;
  if (!g) return [];
  try {
    const { data, error } = await sb.from('group_members')
      .select('user_id, role').eq('group_id', groupId);
    if (error || !data) return g.members || [];
    const members = [];
    const adminIds = [];
    data.forEach(m => {
      if (!m.user_id) return;
      members.push(m.user_id);
      if (m.role === 'owner' || m.role === 'admin') adminIds.push(m.user_id);
    });
    g.members = [...new Set(members)];
    g.adminIds = [...new Set(adminIds)];
    g.subscriberCount = g.members.length;
    if (_currentGroupData && _currentGroupData.id === groupId) _currentGroupData = g;
    _latestGroupMap[groupId] = g;
    return g.members;
  } catch (_) {
    return g.members || [];
  }
}

function _restoreInputRow() {
  // Join/Leave barni o'chirish
  document.getElementById('channelActionBar')?.remove();
  document.getElementById('groupJoinBar')?.remove();
  // Input row ni qayta ko'rsatish
  const inputRow = document.querySelector('.chat-thread-input-row');
  if (inputRow) inputRow.style.display = '';
  // Cheklangan guruhdan chiqqanda DM inputi qulflangan qolib ketmasin
  const inp = document.getElementById('chatThreadInput');
  if (inp) { inp.disabled = false; inp.placeholder = 'Xabar...'; }
  ['chatAttachBtn', 'chatVoiceBtn'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.style.opacity = ''; el.style.pointerEvents = ''; }
  });
}

/** Guruh composer holati:
 *  1) Agar a'zo bo'lmasa — input o'rnida "Guruhga qo'shilish" tugmasi.
 *  2) A'zo bo'lgach agar yozish huquqi bo'lsa — input ochiladi.
 *  3) Agar yozish huquqi bo'lmasa — tugma kulrang bo'lib "Faqat guruhni yaratgan odam yoza oladi" ko'rsatiladi. */
function _applyGroupComposer(g) {
  if (!g || !state.me) return;
  const me  = state.me.uid;
  const isMember = (g.members || []).includes(me) || g.ownerId === me;
  const can = g.ownerId === me || (g.adminIds || []).includes(me) || g.msgPermission !== 'admins';
  const row = document.querySelector('.chat-thread-input-row');
  const inp = $('chatThreadInput');
  document.getElementById('channelActionBar')?.remove();
  document.getElementById('groupJoinBar')?.remove();
  const resetBtn = id => { const el = $(id); if (el) { el.style.opacity = ''; el.style.pointerEvents = ''; } };

  if (!isMember) {
    // Input o'rnida: qatorni yashirish + o'sha joyda Qo'shilish
    const inputRow = document.getElementById('chatThreadInputRow') || row;
    if (inputRow) inputRow.style.display = 'none';
    if (row && row !== inputRow) row.style.display = 'none';
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.id = 'groupJoinBar';
    bar.className = 'group-join-bar';
    bar.textContent = "Qo'shilish";
    const parent = inputRow?.parentNode || row?.parentNode;
    if (parent) {
      if (inputRow) parent.insertBefore(bar, inputRow);
      else parent.appendChild(bar);
    }

    bar.addEventListener('click', async () => {
      bar.disabled = true;
      try {
        await joinGroup(g.id);
        g.members = [...new Set([...(g.members || []), me])];
        _setGroupPeopleLabel(g.members.length);
        toast("Guruhga qo'shildingiz", "success");
        _applyGroupComposer(g);
      } catch (err) {
        bar.disabled = false;
        toast("Guruhga qo'shilishda xatolik", "error");
      }
    });
    return;
  }

  if (can) {
    const inputRow = document.getElementById('chatThreadInputRow') || row;
    if (inputRow) inputRow.style.display = '';
    if (row && row !== inputRow) row.style.display = '';
    if (inp) { inp.disabled = false; inp.placeholder = 'Xabar yozing...'; }
    resetBtn('chatAttachBtn'); resetBtn('chatVoiceBtn');
    return;
  }

  // A'zo, lekin yozish huquqi yo'q (faqat egasi/admini yoza oladi)
  if (inp) { inp.value = ''; inp.disabled = true; inp.blur(); }
  if (row) row.style.display = 'none';
  const bar = document.createElement('div');
  bar.id = 'groupJoinBar';
  bar.className = 'group-join-bar';
  bar.innerHTML = `
    <div class="group-join-btn group-join-btn--disabled">
      <span>Faqat guruhni yaratgan odam yoza oladi</span>
    </div>`;
  if (row && row.parentNode) row.parentNode.insertBefore(bar, row);
}

export async function searchGroups(term) {
  if (!term) return [];
  try {
    const clean = term.replace(/^@/, '').trim();
    if (!clean) return [];
    // Faqat OMMAVIY guruhlar nom/username bo'yicha; maxfiy hech qachon chiqmaydi
    const { data, error } = await sb.from('groups')
      .select('*, group_members(user_id, role, unread_count)')
      .eq('is_private', false)
      .or(`username.ilike.%${clean}%,name.ilike.%${clean}%`)
      .limit(20);
    if (error || !data) return [];
    const res = data.map(mapGroup).filter(g => !g.isPrivate);
    res.forEach(g => { _latestGroupMap[g.id] = g; });
    return res;
  } catch { return []; }
}

/** Invite URL / koddan guruh topish — faqat aniq kod (qisman qidiruv yo'q) */
export async function resolveGroupInvite(raw) {
  const token = String(raw || '').trim();
  if (!token || token.length < 8) return { success: false, error: "Havola yoki kod kiriting" };
  try {
    const { data, error } = await sb.rpc('resolve_group_invite', { p_token: token });
    if (error) return { success: false, error: error.message || 'Xatolik' };
    return data || { success: false, error: 'Guruh topilmadi' };
  } catch (e) {
    return { success: false, error: e?.message || 'Xatolik' };
  }
}

export async function joinGroupByToken(raw) {
  const token = String(raw || '').trim();
  if (!token) return { success: false, error: "Havola yoki kod kiriting" };
  try {
    const { data, error } = await sb.rpc('join_group_by_token', { p_token: token });
    if (error) return { success: false, error: error.message || 'Xatolik' };
    return data || { success: false, error: 'Guruh topilmadi' };
  } catch (e) {
    return { success: false, error: e?.message || 'Xatolik' };
  }
}

export async function openGroupThread(groupId) {
  document.getElementById('chatThreadModal')?.classList.remove('is-saved');
  let groupData = _latestGroupMap[groupId];
  if (!groupData && state.me && groupId) {
    try {
      const { data, error } = await sb.from('groups')
        .select('*, group_members(user_id, role, unread_count)').eq('id', groupId).maybeSingle();
      if (data && !error) {
        groupData = mapGroup(data);
        _latestGroupMap[groupId] = groupData;
      }
    } catch (_) {}
  }
  if (!groupData || !state.me) return;
  await ensureChatsView();

  _currentGroupId   = groupId;
  _currentGroupData = groupData;
  state.currentChatKind = groupData.type; // har doim 'group' (kanal turi olib tashlangan, 3.2)

  const modal = $('chatThreadModal');
  modal.classList.add('show');
  lockScroll('chatThreadModal');
  modal.dataset.kind = groupData.type;
  modal.dataset.gid  = groupId;

  document.getElementById('chatHeaderDropdown')?.remove();
  chatUI.initChatHeaderMenu();

  // Header
  const av = groupData.avatar || defAvi(groupData.name || 'G');
  $('chatThreadAvi').innerHTML = `<img src="${esc(av)}" onerror="this.style.display='none'">`;

  // Guruh avatar ustidagi type badge olib tashlandi
  modal.querySelectorAll('.grp-avi-badge').forEach(el => el.remove());

  $('chatThreadName').textContent = groupData.name || 'Guruh';
  _setGroupPeopleLabel((groupData.members || []).length);
  _loadGroupPeople(groupId).then(members => {
    if (_currentGroupId !== groupId) return;
    _setGroupPeopleLabel(members.length);
  });

  // Hide call buttons for groups/channels
  ['chatVoiceCallBtn','chatVideoCallBtn'].forEach(id => {
    const el = $(id); if (el) el.style.display = 'none';
  });

  // Input qatori: yozish huquqiga qarab ko'rsatiladi/yashiriladi (keyin ham jonli yangilanadi)
  _applyGroupComposer(groupData);
  chatUI.updatePostAttachBar();

  // Info button (tap header → group info)
  $('chatThreadAvi').style.cursor  = 'pointer';
  $('chatThreadName').style.cursor = 'pointer';
  const openInfo = () => openGroupInfo(groupId);
  $('chatThreadAvi')._grpInfoHandler  = openInfo;
  $('chatThreadName')._grpInfoHandler = openInfo;
  $('chatThreadAvi').addEventListener('click', openInfo);
  $('chatThreadName').addEventListener('click', openInfo);

  // Messages spinner
  $('chatThreadMessages').innerHTML = `<div class="spin-wrap pt-60px"><div class="spinner"></div></div>`;

  // Mark my unread as 0
  _resetGroupUnread(groupId);

  // Subscribe to messages
  if (_groupThreadUnsub) { _groupThreadUnsub(); _groupThreadUnsub = null; }
  let _gDead = false, _gTimer = null;
  _gMsgs = []; _gLoaded = false; _gReadMax = 0; _gPending.clear();
  // Tezkor yo'l: a'zolar bilan to'liq mesh (WebRTC DataChannel); baza baribir asosiy
  if (_gRt) { _gRt.close(); _gRt = null; }
  _gRt = openRtGroup(groupId, (_currentGroupData || groupData)?.members || [], {
    onMsg: (m) => { _gOnTyping(false, m.from); _gIncoming(groupId, m); },
    onTyping: (v, from) => _gOnTyping(v, from),
    onEmo: (id, k) => { if (_currentGroupId === groupId) playRemoteEmoji(id, k); },
    onRetract: (id) => {
      if (!_gPending.has(id) || _currentGroupId !== groupId) return;   // faqat hali bazada tasdiqlanmagan nusxa
      _gPending.delete(id);
      markDissolve([id]);
      _gMsgs = _gMsgs.filter(x => x.id !== id);
      paintGroupMessages(_gMsgs, _currentGroupData);
    },
  });
  _gTyp.forEach(t => clearTimeout(t)); _gTyp.clear(); _gIamTyping = false;
  chatUI.resetSeenMsgs('g:' + groupId);
  // Yuboruvchi ismlarini oldindan isitamiz (birinchi chizishda "Foydalanuvchi" bo'lib qolmasin)
  _profilesByIds((_currentGroupData || groupData)?.members || []).then(r => {
    Object.assign(_senderCache, r);
    if (_currentGroupId === groupId && _gLoaded) paintGroupMessages(_gMsgs, _currentGroupData);
  }).catch(() => {});
  const loadMsgs = async () => {
    const _readP = _gLoadReadMax(groupId);   // xabarlar bilan bir vaqtda so'raladi

    // Phase 4/8: seq-delta
    if (isSyncV2Enabled()) {
      try {
        const delta = await loadGroupDelta(groupId, _gMsgs || []);
        if (_gDead || _currentGroupId !== groupId) return;
        if (delta && !delta.reset) {
          let msgs = delta.msgs.slice();
          if (_gPending.size) {
            const have = new Set(msgs.map(m => m.id));
            for (const [pid, pm] of _gPending) {
              if (have.has(pid) || Date.now() - pm._at > 20000) _gPending.delete(pid); else msgs.push(pm);
            }
          }
          await _readP;
          if (_gDead || _currentGroupId !== groupId) return;
          _gMsgs = msgs; _gLoaded = true;
          paintGroupMessages(msgs, _currentGroupData || groupData);
          if ((_latestGroupMap[groupId]?.unreadCount?.[state.me.uid] || 0) > 0) _resetGroupUnread(groupId);
          return;
        }
      } catch (e) {
        console.warn('[Groups] sync delta fallback', e?.message || e);
      }
    }

    const { data, error } = await sb.from('group_messages').select('id, group_id, sender_id, type, text, media_path, media_type, file_name, file_size, duration, edited_at, created_at, reply_to, waveform, seq')
      .eq('group_id', groupId).order('created_at', { ascending: false }).limit(60);
    if (_gDead || _currentGroupId !== groupId) return;
    if (error) {
      console.warn('[Groups] thread error:', error.message);
      $('chatThreadMessages').innerHTML = `<div class="empty pt-30vh tac"><div class="fs-13px c-text2">Xabarlar yuklanmadi</div></div>`;
      return;
    }
    const msgs = (data || []).map(mapMessage).reverse();
    // Hali bazadan tasdiqlanmagan (optimistik) xabarlarni yo'qotmaymiz
    if (_gPending.size) {
      const have = new Set(msgs.map(m => m.id));
      for (const [pid, pm] of _gPending) {
        if (have.has(pid) || Date.now() - pm._at > 20000) _gPending.delete(pid); else msgs.push(pm);
      }
    }
    await _readP;
    if (_gDead || _currentGroupId !== groupId) return;
    _gMsgs = msgs; _gLoaded = true;
    try {
      let mx = 0;
      for (const m of msgs) if (m.seq != null && m.seq > mx) mx = m.seq;
      if (mx) setCursor('grp:' + groupId, mx);
    } catch (_) {}
    paintGroupMessages(msgs, _currentGroupData || groupData);
    // Thread ochiq turganda kelgan xabarlar o'qilmagan bo'lib qolmasin
    if ((_latestGroupMap[groupId]?.unreadCount?.[state.me.uid] || 0) > 0) _resetGroupUnread(groupId);
  };
  const sched = () => { clearTimeout(_gTimer); _gTimer = setTimeout(loadMsgs, 0); };
  // Realtime payload'ni qayta yuklamasdan shu zahoti qo'llaymiz
  const applyGroupPayload = (p) => {
    if (_gDead || _currentGroupId !== groupId) return;
    if (!_gLoaded) { sched(); return; }
    if (p.eventType === 'DELETE') {
      if (isSyncV2Enabled()) return; // Phase 5: tombstone kanal
      const did = p.old?.id;
      if (!did) { sched(); return; }
      _gPending.delete(did);
      markDissolve([did]);
      _gMsgs = _gMsgs.filter(x => x.id !== did);
    } else {
      const m = mapMessage(p.new);
      if (!m || !m.id) { sched(); return; }
      _gPending.delete(m.id);
      const i = _gMsgs.findIndex(x => String(x.id) === String(m.id));
      if (i >= 0) {
        const prev = _gMsgs[i];
        _gMsgs = _gMsgs.slice();
        _gMsgs[i] = {
          ...m,
          replyTo: m.replyTo || prev.replyTo || null,
          replyPreview: m.replyPreview || prev.replyPreview || null,
        };
      } else if (p.eventType === 'INSERT') _gMsgs = [..._gMsgs, m];
      else { sched(); return; }
      if ((_latestGroupMap[groupId]?.unreadCount?.[state.me.uid] || 0) > 0 || m.senderId !== state.me.uid) _resetGroupUnread(groupId);
    }
    paintGroupMessages(_gMsgs, _currentGroupData || groupData);
  };
  window.addEventListener('spacemr:resync', sched);   // ochiq guruh chati ham uyg'onganda yangilanadi
  // P11: birinchi yuklash faqat loadMsgs(); SUBSCRIBED da faqat reconnect bo'lsa qayta
  let _gWasSub = false;
  const gch = sb.channel('gthread-' + groupId);
  if (isSyncV2Enabled()) {
    gch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, applyGroupPayload);
    gch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, applyGroupPayload);
  } else {
    gch.on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, applyGroupPayload);
  }
  gch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, (p) => {
      if (_gDead || _currentGroupId !== groupId || !_gLoaded) return;
      const r = p.new;
      if (!r || r.user_id === state.me?.uid || !r.last_read_at) return;
      const t = Date.parse(r.last_read_at) || 0;
      if (t <= _gReadMax) return;
      _gReadMax = t;
      paintGroupMessages(_gMsgs, _currentGroupData || groupData);
    })
    .subscribe(st => {
      if (st === 'SUBSCRIBED') {
        if (_gWasSub && _gLoaded) sched(); // reconnect / gap
        _gWasSub = true;
      }
    });
  let _gTombUnsub = null;
  if (isSyncV2Enabled()) {
    _gTombUnsub = bindGroupTombstoneChannel(groupId, (row) => {
      if (_gDead || _currentGroupId !== groupId) return;
      const did = row?.message_id;
      if (!did) return;
      _gPending.delete(did);
      markDissolve([did]);
      _gMsgs = _gMsgs.filter(x => x.id !== did);
      paintGroupMessages(_gMsgs, _currentGroupData || groupData);
    });
  }
    _groupThreadUnsub = () => {
    _gDead = true; clearTimeout(_gTimer); sb.removeChannel(gch);
    try { _gTombUnsub?.(); } catch (_) {}
    window.removeEventListener('spacemr:resync', sched);
    if (_gRt) { _gRt.close(); _gRt = null; }
    if (_reloadGroupThread === loadMsgs) _reloadGroupThread = null;
  };
  _reloadGroupThread = loadMsgs;
  loadMsgs();
}

export function closeGroupThread() {
  _gTyp.forEach(t => clearTimeout(t)); _gTyp.clear(); clearTimeout(_gTypTimer); _gSetTyping(false);
  if (_groupThreadUnsub) { _groupThreadUnsub(); _groupThreadUnsub = null; }

  // Restore call buttons
  ['chatVoiceCallBtn','chatVideoCallBtn'].forEach(id => {
    const el = $(id); if (el) el.style.display = '';
  });

  // Remove info click handlers
  ['chatThreadAvi','chatThreadName'].forEach(id => {
    const el = $(id);
    if (el && el._grpInfoHandler) {
      el.removeEventListener('click', el._grpInfoHandler);
      el._grpInfoHandler = null;
      el.style.cursor = '';
    }
  });

  // Remove avi badge
  const modal = $('chatThreadModal');
  if (modal) {
    modal.dataset.kind = '';
    modal.querySelector('.grp-avi-badge')?.remove();
  }

  // Restore input
  _restoreInputRow();
  document.getElementById('chatHeaderDropdown')?.remove();
  $('chatThreadInput').disabled = false;
  $('chatThreadInput').placeholder = 'Xabar yozing...';
  $('chatThreadInput').value = '';
  setTimeout(() => window.updateVoiceSendBtn && window.updateVoiceSendBtn(), 50);
  [$('chatAttachBtn'), $('chatVoiceBtn')].forEach(el => {
    if (!el) return;
    el.style.opacity = '';
    el.style.pointerEvents = '';
  });

  const typingEl = $('chatTypingStatus');
  if (typingEl) typingEl.textContent = '';

  _currentGroupId   = null;
  _currentGroupData = null;
  state.currentChatKind = 'dm';
  unlockScroll('chatThreadModal'); // Modal yopildi — body scrollini qayta ochamiz
}

/* ─────────────────────────────────────────────────────────────────────
   PAINT GROUP MESSAGES (reuses same bubble structure as DM)
   ───────────────────────────────────────────────────────────────────── */
const _senderCache = {};   // uid → profil (ism/avatar) — har chizishda tarmoqqa bormaslik uchun
let _paintSeq = 0;
/* Guruhda o'z xabarimni kamida 1 kishi o'qigan bo'lsa — 2 chek (status='read') */
const _gTime = v => Number(v) || Date.parse(v) || 0;
function _gTicked(msgs) {
  if (!_gReadMax) return msgs;
  const me = state.me?.uid;
  return msgs.map(m => (m.senderId === me && m.status !== 'sending' && m.status !== 'read' && _gTime(m.createdAt) <= _gReadMax)
    ? { ...m, status: 'read' } : m);
}
async function _gLoadReadMax(groupId) {
  try {
    const { data, error } = await sb.from('group_members').select('user_id, last_read_at').eq('group_id', groupId);
    if (error) throw error;
    _gReadMax = (data || []).reduce((mx, r) => (r.user_id !== state.me?.uid && r.last_read_at) ? Math.max(mx, Date.parse(r.last_read_at) || 0) : mx, 0);
  } catch (_) { /* 062 hali ishga tushmagan — 1 chek qoladi */ }
}

/* chat.js / msg-menu uchun: joriy guruhda men owner/admin'manmi (boshqalarning xabarini o'chirish huquqi) */
chatUI.isGroupModerator = () => {
  const g = _currentGroupData, me = state.me?.uid;
  return !!(g && me && (g.ownerId === me || (g.adminIds || []).includes(me)));
};
chatUI.groupNames = () => _gNames();
/* Lokal (optimistik) o'chirishda guruh xabarlar keshidan ham darhol olib tashlaymiz — DELETE hodisasi kelguncha qayta chizilsa xabar qaytib chiqmasin */
chatUI.dropGroupMsgs = (ids) => { const set = new Set((ids || []).map(String)); _gMsgs = _gMsgs.filter(x => !set.has(String(x.id))); };

/* Yuboruvchi ismlari + guruhdagi roli (owner/admin) — sarlavhada nishon uchun */
function _gNames() {
  const out = { ..._senderCache };
  const g = _currentGroupData;
  if (g) {
    if (g.ownerId && out[g.ownerId]) out[g.ownerId] = { ...out[g.ownerId], role: 'owner' };
    (g.adminIds || []).forEach(u => { if (u !== g.ownerId && out[u]) out[u] = { ...out[u], role: 'admin' }; });
  }
  return out;
}

async function paintGroupMessages(msgs, groupData) {
  if (!$('chatThreadMessages')) return;
  msgs = _gTicked(msgs);
  // DM bilan BIR XIL painter (chat.js paintMessages); yagona farq — pufak sarlavhasida yuboruvchi ismi.
  // Avval keshdagi ismlar bilan darhol chizamiz, yetishmaganlari kelgach qayta chizamiz.
  chatUI.paintGroupThread(msgs, _gNames());
  const missing = [...new Set(msgs.map(m => m.senderId).filter(u => u && !_senderCache[u]))];
  if (!missing.length) return;
  const seq = ++_paintSeq;
  const got = await _profilesByIds(missing);
  Object.assign(_senderCache, got);
  missing.forEach(u => { if (!_senderCache[u]) _senderCache[u] = { fullName: 'Foydalanuvchi', avatar: '' }; });
  if (seq === _paintSeq && _currentGroupId && _gLoaded) {
    chatUI.paintGroupThread(_gTicked(_gMsgs), _gNames());
    // Patch mavjud avatar <img> src (agar DOM saqlangan bo'lsa)
    try {
      const box = document.getElementById('chatThreadMessages');
      if (box) {
        box.querySelectorAll('.msg-avi-btn.grp-avi[data-uid]').forEach(btn => {
          const u = btn.dataset.uid;
          const pr = _senderCache[u];
          if (!pr) return;
          const im = btn.querySelector('img');
          if (!im) return;
          const next = pr.avatar || '';
          if (next && im.getAttribute('src') !== next) {
            im.src = next;
            im.dataset.n = pr.fullName || im.dataset.n || '';
          }
        });
      }
    } catch (_) {}
  }
}

/* ── "Yozmoqda..." (DM bilan bir xil, sarlavhada; guruhda kim yozayotgani) ── */
const _gTyp = new Map();   // uid → timer
let _gIamTyping = false, _gTypTimer = null;
function _gPaintSub() {
  const el = $('chatTypingStatus');
  if (!el || !_currentGroupData) return;
  if (_gTyp.size) {
    const names = [..._gTyp.keys()].map(u => (_senderCache[u]?.fullName || 'Kimdir').split(' ')[0]);
    el.textContent = (names.length > 2 ? `${names.length} kishi` : names.join(', ')) + ' yozmoqda...';
    el.classList.add('online');
  } else {
    el.textContent = `${(_currentGroupData.members || []).length} ta odam`;
    el.classList.remove('online');
  }
}
function _gOnTyping(v, from) {
  clearTimeout(_gTyp.get(from));
  if (v) _gTyp.set(from, setTimeout(() => { _gTyp.delete(from); _gPaintSub(); }, TYPING_EXPIRE_MS));
  else _gTyp.delete(from);
  _gPaintSub();
}
// Katta emoji bosildi / BOOM — guruh a'zolariga uzatamiz (DM da chat.js)
document.addEventListener('emo-tap', e => {
  if (!_currentGroupId || !(state.currentChatKind && state.currentChatKind !== 'dm')) return;
  try { _gRt?.sendEmo(e.detail.id, e.detail.k); } catch (_) {}
});
function _gSetTyping(v) {
  if (_gIamTyping === v) return;
  _gIamTyping = v;
  try { _gRt?.sendTyping(v); } catch (_) {}
}
export function groupTypingInput() {
  _gSetTyping(true);
  clearTimeout(_gTypTimer);
  _gTypTimer = setTimeout(() => _gSetTyping(false), TYPING_STOP_MS);
}
export function reloadGroupThread() { _reloadGroupThread && _reloadGroupThread(); }

/* ─────────────────────────────────────────────────────────────────────
   SEND MESSAGE TO GROUP / CHANNEL
   ───────────────────────────────────────────────────────────────────── */
export async function sendGroupMessage(opts) {
  const gifText = opts && typeof opts.text === 'string' ? opts.text : null;   // GIF: tayyor JSON matn (inputga tegilmaydi)
  if (!_currentGroupId || !state.me) return;
  if (gifText == null && isEditing()) { await commitEdit($('chatThreadInput')?.value); return; }
  const inp  = $('chatThreadInput');
  const userText = gifText != null ? gifText : (inp?.value || '').trim();
  const postShare = gifText != null ? null : (chatUI.getPendingPostShare ? chatUI.getPendingPostShare() : null);

  if (!userText && !postShare) return;
  if (!rateOk('msg', 8, 10000)) return;

  if (gifText == null) inp.value = '';
  if (postShare && chatUI.clearPendingPostShare) {
    chatUI.clearPendingPostShare();
  } else {
    chatUI.updateVoiceSendBtn();
  }
  clearTimeout(_gTypTimer); _gSetTyping(false);

  // Bazaga emoji RASM/BELGI emas, PATH yoziladi: [[emoji/2d/<kalit>.png]] (GIF/JSON xabarlarga tegilmaydi)
  const finalMsgText = postShare
    ? JSON.stringify({ __postShare: true, post: postShare, comment: encodeForSend(userText) })
    : (gifText != null ? userText : encodeForSend(userText));

  const replyInfo = getReplying();
  const replyToId = replyInfo?.id ? String(replyInfo.id) : null;
  if (replyInfo) cancelReply(false);

  const previewText = postShare
    ? (userText ? userText : `Yozuv: ${postShare.authorName || 'Yozuv'}`)
    : (gifText != null ? 'GIF' : userText.slice(0, 120));

  const groupId = _currentGroupId;
  const groupData = _currentGroupData;
  const members   = groupData?.members || [];

  // Optimistik: o'z xabarimiz shu zahoti ekranda, baza orqada (xuddi shu ID bilan — dedup)
  const mid = _gUuid();
  const nowMs = Date.now();
  const localMsg = mapMessage({ id: mid, group_id: groupId, sender_id: state.me.uid, type: 'text', text: finalMsgText, created_at: new Date(nowMs).toISOString(), reply_to: replyToId });
  if (replyInfo) localMsg.replyPreview = { name: replyInfo.name, text: replyInfo.preview, type: replyInfo.type };
  localMsg._at = nowMs;
  localMsg.status = 'sending';
  _gPending.set(mid, localMsg);
  _gMsgs = [..._gMsgs, localMsg];
  paintGroupMessages(_gMsgs, groupData);
  _gRt?.send(mid, finalMsgText);
  groupInboxSend(groupId, { gid: groupId, from: state.me.uid, id: mid, text: previewText.slice(0, 120), ts: nowMs });

  try {
    const { error } = await sb.from('group_messages')
      .insert({ id: mid, group_id: groupId, sender_id: state.me.uid, type: 'text', text: finalMsgText, reply_to: replyToId });
    if (error) throw error;
    // DB tasdiqladi — clock → 1 chek (tez: faqat tick)
    const conf = _gPending.get(mid);
    if (conf) { conf.status = 'sent'; _gPending.set(mid, conf); }
    _gMsgs = _gMsgs.map(m => m.id === mid ? { ...m, status: 'sent' } : m);
    if (_currentGroupId === groupId) {
      if (typeof chatUI.updateMsgTicks === 'function') chatUI.updateMsgTicks(mid, 'sent');
      else paintGroupMessages(_gMsgs, groupData);
    }
  } catch (err) {
    console.error('[Groups] send failed:', err);
    toast('Xabar yuborilmadi', 'error');
    _gPending.delete(mid);
    _gRt?.retract(mid);
    _gMsgs = _gMsgs.filter(x => x.id !== mid);
    if (_currentGroupId === groupId) paintGroupMessages(_gMsgs, groupData);
    if (gifText == null) inp.value = userText;
    if (postShare) chatUI.setPendingPostShare?.(postShare);
    chatUI.updateVoiceSendBtn();
    return;
  }
}

export async function sendGroupFile(file, caption = '') {
  if (!_currentGroupId || !state.me || !file) return;
  const groupId = _currentGroupId;
  const captionText = (typeof caption === 'string' ? caption : '').trim();
  const _fReply = getReplying();
  const _fReplyTo = _fReply?.id ? String(_fReply.id) : null;
  if (_fReply) cancelReply(false);
  const id = _gUuid();
  const pendingId = id;
  _showPendingBubble(pendingId, 'file', file.size, file.name, file.type);
  try {
    const result = await uploadViaControllerProgress(file, 'group-files', pct => _updatePendingProgress(pendingId, pct));
    _removePendingBubble(pendingId);
    const { error } = await sb.from('group_messages').insert({
      id, group_id: groupId, sender_id: state.me.uid, type: 'file',
      media_path: result.path, media_type: file.type || null,
      file_name: file.name, file_size: file.size,
      text: captionText || null,
      reply_to: _fReplyTo,
    });
    if (error) throw error;
    const previewText = fileMsgPreview({ caption: captionText, fileName: file.name });
    _gRt?.send({
      id, type: 'file', text: captionText || null,
      mediaPath: result.path, mediaType: file.type || null,
      fileName: file.name, fileSize: file.size,
      replyTo: _fReplyTo,
    });
    groupInboxSend(groupId, { gid: groupId, from: state.me.uid, id, text: previewText.slice(0, 120), ts: Date.now() });
    _reloadGroupThread && _reloadGroupThread();
  } catch (err) {
    console.error('[Groups] file send failed:', err);
    _removePendingBubble(pendingId);
    const inp = $('chatThreadInput');
    if (inp && captionText) { inp.value = captionText; chatUI.updateVoiceSendBtn(); }
    toast('Fayl yuborilmadi', 'error');
  }
}

/** Ovozli xabar (DM bilan bir xil oqim). Bazada `group_messages.duration` va type='voice' kerak: supabase/unfulfilled/016_group-voice.sql */
export async function sendGroupVoice(blob, duration) {
  if (!_currentGroupId || !state.me || !blob) return;
  if (!rateOk('msg', 8, 10000)) return;
  const groupId = _currentGroupId;
  const groupData = _currentGroupData;
  const _vReply = getReplying();
  const _vReplyTo = _vReply?.id ? String(_vReply.id) : null;
  if (_vReply) cancelReply(false);
  const mid = _gUuid();
  const nowMs = Date.now();
  const localUrl = URL.createObjectURL(blob);
  registerLocalVoiceUrl(mid, localUrl, voiceBarCount(duration));
  // Oddiy xabar kabi: darhol ro'yxatda (id bilan), repaint'da yo'qolmaydi, server xabari kelganda jimgina almashadi
  const localMsg = mapMessage({ id: mid, group_id: groupId, sender_id: state.me.uid, type: 'voice',
    media_type: blob.type || null, duration: Math.round(duration || 0), created_at: new Date(nowMs).toISOString(), reply_to: _vReplyTo });
  localMsg.mediaUrl = localUrl;
  localMsg._at = nowMs + 120000;
  localMsg.status = 'sending';
  if (_vReply) localMsg.replyPreview = { name: _vReply.name, text: _vReply.preview, type: _vReply.type };
  _gPending.set(mid, localMsg);
  _gMsgs = [..._gMsgs, localMsg];
  paintGroupMessages(_gMsgs, groupData);
  try {
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });
    const result = await uploadViaControllerProgress(file, 'chat-voice');
    const waveform = await getVoiceWaveform(localUrl, voiceBarCount(duration));
    const row = {
      id: mid, group_id: groupId, sender_id: state.me.uid, type: 'voice',
      media_path: result.path, media_type: blob.type || null,
      duration: Math.round(duration || 0),
      reply_to: _vReplyTo,
      ...(waveform ? { waveform } : {}),
    };
    let { error } = await sb.from('group_messages').insert(row);
    // 069 migratsiya hali yurgizilmagan bo'lsa — to'lqinsiz qayta urinamiz
    if (error && waveform && /waveform|PGRST204|42703/i.test(`${error.code || ''} ${error.message || ''}`)) {
      delete row.waveform;
      ({ error } = await sb.from('group_messages').insert(row));
    }
    if (error) throw error;
    const conf = _gPending.get(mid);
    if (conf) {
      conf.waveform = waveform;
      conf.status = 'sent';
      conf.mediaPath = result.path;
      conf.mediaUrl = result.url || conf.mediaUrl;
      conf._at = Date.now();
      _gPending.set(mid, conf);
    }
    _gRt?.send({
      id: mid, type: 'voice', mediaPath: result.path,
      mediaType: blob.type || null, duration: Math.round(duration || 0),
      waveform: waveform || null,
    });
    groupInboxSend(groupId, { gid: groupId, from: state.me.uid, id: mid, text: 'Ovozli xabar', ts: Date.now() });
    _gMsgs = _gMsgs.map(m => m.id === mid ? { ...m, status: 'sent', mediaPath: result.path, mediaUrl: result.url || m.mediaUrl } : m);
    if (_currentGroupId === groupId) paintGroupMessages(_gMsgs, groupData);
    _reloadGroupThread && _reloadGroupThread();
  } catch (err) {
    console.error('[Groups] voice send failed:', err);
    _gPending.delete(mid);
    _gMsgs = _gMsgs.filter(x => x.id !== mid);
    if (_currentGroupId === groupId) paintGroupMessages(_gMsgs, groupData);
    try { URL.revokeObjectURL(localUrl); } catch (_) {}
    toast('Guruh ovozi yuborilmadi: ' + String(err?.message || err?.error || err?.statusCode || err).slice(0, 140) + (err?.code ? ' [' + err.code + ']' : ''), 'error');
  }
}

/* ─────────────────────────────────────────────────────────────────────
   GROUP/CHANNEL INFO PANEL
   ───────────────────────────────────────────────────────────────────── */
export async function openGroupInfo(groupId) {
  const g = _latestGroupMap[groupId];
  if (!g) return;
  const isOwner   = g.ownerId === state.me?.uid;
  const isGrpAdm  = (g.adminIds || []).includes(state.me?.uid);
  const canManage = isOwner || isGrpAdm || isAdmin();
  const members   = g.members || [];
  const typeLabel  = 'Guruh';

  const panel = document.getElementById('grpInfoOverlay');
  if (!panel) return;

  // Open panel immediately with loading state
  panel.classList.add('show');

  /* ── Hero section ─────────────────────────── */
  const av = g.avatar || defAvi(g.name || 'G');
  const aviEl = panel.querySelector('#grpInfoAvi');
  if (aviEl) {
    aviEl.innerHTML = `<img src="${esc(av)}" onerror="this.style.display='none'">`;
    aviEl.style.cursor = 'pointer';

    // Click: faqat zoom (X va "rasm o'zgartirish" tugmalari yo'q — hech kimga)
    aviEl.onclick = async () => {
      const { openZoom } = await import('../core/utils.js');
      openZoom(av, 'avatar');
    };
  }

  const nameEl  = panel.querySelector('#grpInfoName');
  const badgeEl = panel.querySelector('#grpInfoTypeBadge');
  const linkRow = panel.querySelector('#grpInfoLinkRow');
  const linkTxt = panel.querySelector('#grpInfoLinkText');
  const descEl  = panel.querySelector('#grpInfoDesc');
  const cntEl   = panel.querySelector('#grpInfoMemberCount');
  const lblEl   = panel.querySelector('#grpInfoMemberLbl');

  if (nameEl)  nameEl.textContent  = g.name || '';
  if (badgeEl) badgeEl.textContent = typeLabel;

  if (linkRow && linkTxt) {
    if (!g.isPrivate && g.username) {
      linkRow.style.display = 'flex';
      linkRow.style.cursor = 'pointer';
      linkTxt.textContent = '@' + g.username;
      linkRow.onclick = () => {
        const url = `${window.location.origin}/chats/g/${g.username}`;
        navigator.clipboard?.writeText(url);
        toast(`Havola nusxalandi: @${g.username}`, 'success');
      };
    } else if (g.isPrivate && g.inviteCode) {
      linkRow.style.display = 'flex';
      linkRow.style.cursor = 'pointer';
      linkTxt.textContent = `Maxfiy havola: ${g.inviteCode.slice(0, 14)}...`;
      linkRow.onclick = () => {
        const url = `${window.location.origin}/chats/g/${g.inviteCode}`;
        navigator.clipboard?.writeText(url);
        toast('Maxfiy taklif havolasi nusxalandi', 'success');
      };
    } else {
      linkRow.style.display = 'none';
      linkRow.onclick = null;
    }
  }

  if (descEl) {
    if (g.description) { descEl.textContent = g.description; descEl.style.display = ''; }
    else descEl.style.display = 'none';
  }

  if (cntEl) cntEl.textContent = members.length;
  if (lblEl) lblEl.textContent = 'odam';
  _loadGroupPeople(groupId).then(ids => {
    if (!document.getElementById('grpInfoOverlay')?.classList.contains('show')) return;
    const fresh = _latestGroupMap[groupId];
    if (cntEl) cntEl.textContent = (fresh?.members || ids).length;
  });

  /* ── Buttons ── */
  const isMemberNow = (g.members || []).includes(state.me?.uid) || isOwner;
  panel.querySelector('#grpInfoLeaveBtn').style.display      = (isOwner || !isMemberNow) ? 'none' : '';
  panel.querySelector('#grpInfoDeleteBtn').style.display     = isOwner ? '' : 'none';
  panel.querySelector('#grpInfoAddMemberBtn').style.display  = canManage ? '' : 'none';
  panel.querySelector('#grpInfoEditBtn').style.display       = canManage ? '' : 'none';

  /* ── Button handlers ── */
  panel.querySelector('#grpInfoLeaveBtn').onclick = () => {
    showConfirm(`${typeLabel}dan chiqmoqchimisiz?`, async () => {
      try {
        await leaveGroup(groupId);
        panel.classList.remove('show');
        closeGroupThread();
        $('chatThreadModal').classList.remove('show');
        toast(`${typeLabel}dan chiqdingiz`, 'info');
      } catch(e) { toast('Xato yuz berdi', 'error'); }
    }, 'Chiqish', 'Chiqish');
  };

  panel.querySelector('#grpInfoDeleteBtn').onclick = () => {
    showConfirm(`${typeLabel}ni o'chirasizmi? Bu amalni qaytarib bo'lmaydi!`, async () => {
      try {
        await _deleteGroup(groupId);
        panel.classList.remove('show');
        closeGroupThread();
        $('chatThreadModal').classList.remove('show');
        toast(`${typeLabel} o'chirildi`, 'success');
      } catch(e) { toast('Xato yuz berdi', 'error'); }
    }, "O'chirish", "O'chirish");
  };

  panel.querySelector('#grpInfoAddMemberBtn').onclick = () => {
    panel.classList.remove('show');
    openMemberPicker(groupId, 'add');
  };

  panel.querySelector('#grpInfoEditBtn').onclick = () => {
    panel.classList.remove('show');
    openGroupEdit(groupId, g);
  };

  /* ── Load members list (group only) in parallel ── */
  {
    const membersEl = panel.querySelector('#grpMembersList');
    if (membersEl) {
      membersEl.innerHTML = '<div class="gi-media-spin"><div class="spinner"></div></div>';
      const ids = await _loadGroupPeople(groupId);
      const fresh = _latestGroupMap[groupId];
      const showIds = (fresh && fresh.members && fresh.members.length) ? fresh.members : (ids.length ? ids : members);
      if (cntEl) cntEl.textContent = showIds.length;
      _profilesByIds(showIds)
        .then(pmap => {
          const html = showIds.map(uid => {
            const u = pmap[uid] || { fullName: 'Foydalanuvchi', avatar: '', uid };
            const av   = u.avatar || defAvi(u.fullName || 'U');
            const role = uid === g.ownerId ? 'Egasi' : (g.adminIds||[]).includes(uid) ? 'Admin' : '';
            const isSelf = uid === state.me?.uid;
            const online = isUidOnline(u.uid, isOnline(u.lastSeenAt));
            return `<div class="grp-member-row" data-uid="${uid}">
              <div class="grp-member-avi-wrap">
                <div class="grp-member-avi"><img src="${esc(av)}" onerror="this.style.display='none'"></div>
                ${online ? '<span class="presence-dot" title="onlayn"></span>' : ''}
              </div>
              <div class="grp-member-info">
                <div class="grp-member-name">${esc(u.fullName||'Foydalanuvchi')}</div>
                ${role ? `<div class="grp-member-role">${role}</div>` : ''}
              </div>

            </div>`;
          }).join('');
          membersEl.innerHTML = html || '<div class="gi-empty">A\'zolar topilmadi</div>';
        }).catch(() => { if (membersEl) membersEl.innerHTML = ''; });
    }
  }

  /* ── Load media files (images) ── */
  const mediaGrid = panel.querySelector('#grpInfoMediaGrid');
  const mediaStat = panel.querySelector('#grpInfoMediaStat');
  const mediaCount = panel.querySelector('#grpInfoMediaCount');
  if (mediaGrid) {
    mediaGrid.innerHTML = '<div class="gi-media-spin"><div class="spinner"></div></div>';
    try {
      const { data: mrows, error: mErr } = await sb.from('group_messages').select('id, group_id, sender_id, type, text, media_path, media_type, file_name, file_size, duration, edited_at, created_at, reply_to, waveform, seq')
        .eq('group_id', groupId).eq('type', 'file')
        .order('created_at', { ascending: false }).limit(60);
      if (mErr) throw mErr;
      const mediaMsgs = (mrows || [])
        .map(mapMessage)
        .filter(m => {
          const mime = (m.mediaType || '').toLowerCase();
          const ext  = (m.fileName || '').toLowerCase().split('.').pop();
          return mime.startsWith('image') ||
                 ['jpg','jpeg','png','gif','webp','avif'].includes(ext);
        });

      if (mediaStat) mediaStat.style.display = mediaMsgs.length ? '' : 'none';
      if (mediaCount) mediaCount.textContent = mediaMsgs.length;

      if (!mediaMsgs.length) {
        mediaGrid.innerHTML = '<div class="gi-empty">Media fayllar yo\'q</div>';
      } else {
        mediaGrid.innerHTML = mediaMsgs.map(m => {
          const safeUrl = (m.mediaUrl || '').replace(/"/g, '&quot;');
          return `<div class="gi-media-cell" data-url="${safeUrl}" data-type="image">
            <img src="${esc(safeUrl)}" loading="lazy" onerror="this.closest('.gi-media-cell').style.display='none'">
          </div>`;
        }).join('');

        // Click → open in zoom modal
        mediaGrid.querySelectorAll('.gi-media-cell').forEach(cell => {
          cell.addEventListener('click', async () => {
            const { openZoom } = await import('../core/utils.js');
            if (typeof openZoom === 'function') {
              openZoom(cell.dataset.url, cell.dataset.type);
            } else {
              location.assign(cell.dataset.url);
            }
          });
        });
      }
    } catch(e) {
      mediaGrid.innerHTML = '<div class="gi-empty">Media yuklanmadi</div>';
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────
   CREATE FLOW: action choice → form
   ───────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   EDIT GROUP / CHANNEL — owner & admin can update everything
   ───────────────────────────────────────────────────────────────────── */
export function generate64HexToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function checkGroupUsernameAvailable(rawUsername, currentGroupId = null) {
  const clean = (rawUsername || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (clean.length < 2) return { ok: false, error: "Username kamida 2 ta belgi bo'lishi kerak (a-z, 0-9, _)" };
  if (clean.length > 40) return { ok: false, error: "Username 40 ta belgidan oshmasligi kerak" };

  /* Guruh username lari foydalanuvchi username lari bilan ALOHIDA fazo: faqat boshqa guruhlar bilan solishtiriladi. */
  try {
    const { data: free, error } = await sb.rpc('group_username_available', { p_username: clean, p_exclude: currentGroupId });
    if (!error && typeof free === 'boolean') {
      return free ? { ok: true, username: clean } : { ok: false, error: 'Bu nom allaqachon band' };
    }
  } catch (_) {}

  // RPC yo'q bo'lsa: to'g'ridan-to'g'ri groups jadvali (profiles tekshirilmaydi)
  try {
    let q = sb.from('groups').select('id').ilike('username', clean);
    if (currentGroupId) q = q.neq('id', currentGroupId);
    const { data: grps } = await q.limit(1);
    if (grps && grps.length > 0) return { ok: false, error: 'Bu nom allaqachon band' };
  } catch (_) {}

  return { ok: true, username: clean };
}

/* ─────────────────────────────────────────────────────────────────────
   GURUHNI TAHRIRLASH — "Yangi guruh" formasining o'zi (#grpCreateFormOverlay)
   edit rejimida ochiladi: avatar, nom, tur (ommaviy/maxfiy), username/havola,
   tavsif, yozish huquqi va a'zolar tanlovi — yaratishdagi bilan bir xil.
   ───────────────────────────────────────────────────────────────────── */
let _editGroupData = null;
let _editWriterMode = false;          // mavjud a'zolar uchun ham yozish huquqi tugmalari
let _editOwnerId = null;
let _editWritersBase = new Map();     // uid -> can_write (ochilgandagi holat)

const _MSG_PERM_LABELS = {
  all: "Xabar yuborish: barcha a'zolar",
  admins: "Xabar yuborish: faqat adminlar (kanal kabi)",
  selected: "Xabar yuborish: faqat tanlanganlar",
};

function _setInviteTools(overlay, on) {
  const c = overlay.querySelector('#grpCreateCopyInviteBtn');
  const r = overlay.querySelector('#grpCreateRegenInviteBtn');
  if (c) c.style.display = on ? '' : 'none';
  if (r) r.style.display = on ? '' : 'none';
}

function _setMsgPermUI(overlay, v) {
  if (!_MSG_PERM_LABELS[v]) v = 'all';
  const hidden = overlay.querySelector('#grpFormMsgPerm');
  if (hidden) hidden.value = v;
  const wrap = overlay.querySelector('#grpFormMsgPermWrap');
  if (wrap) wrap.dataset.value = v;
  const label = overlay.querySelector('#grpFormMsgPermLabel');
  if (label) label.textContent = _MSG_PERM_LABELS[v];
  overlay.querySelectorAll('.grp-msg-perm-item').forEach(el => el.classList.toggle('is-active', el.dataset.perm === v));
  document.body.classList.toggle('grp-perm-selected', v === 'selected');
  overlay.querySelector('#grpMemberPickerSection')?.classList.toggle('perm-selected', v === 'selected');
  wrap?.classList.toggle('is-selected-mode', v === 'selected');
}

export async function openGroupEdit(groupId, g) {
  const overlay = document.getElementById('grpCreateFormOverlay');
  if (!overlay) return;

  _createType = 'group';
  _editGroupData = g;
  _editOwnerId = g.ownerId || null;
  _editWriterMode = true;
  _selectedMembers = new Set();
  _wasPicked = new Set();
  _removeSet = new Set();
  _selectedWriters = new Set();
  _editWritersBase = new Map();
  _pendingPhotoUrl = null;
  _usersForPicker = [];
  _createIsPublic = !g.isPrivate;
  _pendingInviteCode = g.inviteCode || generate64HexToken();
  _existingMemberUids = new Set(g.members || []);

  overlay.dataset.addMode = '';
  overlay.dataset.editMode = groupId;

  overlay.querySelector('.grp-form-title').textContent = 'Guruhni sozlash';
  overlay.querySelector('#grpFormDescWrap').style.display = '';
  overlay.querySelector('#grpFormPrivacyWrap').style.display = '';
  overlay.querySelector('.grp-form-avi-wrap').style.display = '';
  overlay.querySelector('#grpFormName').style.display = '';
  overlay.querySelector('#grpFormCreateBtn').textContent = 'Saqlash';
  overlay.querySelector('#grpFormCreateBtn').disabled = false;

  overlay.querySelector('#grpFormName').value = g.name || '';
  overlay.querySelector('#grpFormDesc').value = g.description || '';
  overlay.querySelector('#grpFormUsername').value = g.username || '';
  overlay.querySelector('.grp-form-desc-hint').textContent = '';

  /* Ommaviy / maxfiy */
  const pubBtn = overlay.querySelector('#grpCreatePublicBtn');
  const privBtn = overlay.querySelector('#grpCreatePrivateBtn');
  const pubSec = overlay.querySelector('#grpCreatePublicSection');
  const privSec = overlay.querySelector('#grpCreatePrivateSection');
  const tokenEl = overlay.querySelector('#grpCreateInviteToken');
  const paintPrivacy = () => {
    pubBtn?.classList.toggle('active', _createIsPublic);
    privBtn?.classList.toggle('active', !_createIsPublic);
    if (pubSec) pubSec.style.display = _createIsPublic ? '' : 'none';
    if (privSec) privSec.style.display = _createIsPublic ? 'none' : '';
    if (tokenEl) tokenEl.textContent = `${window.location.origin}/chats/g/${_pendingInviteCode}`;
  };
  paintPrivacy();
  if (pubBtn) pubBtn.onclick = () => { _createIsPublic = true; paintPrivacy(); };
  if (privBtn) privBtn.onclick = () => { _createIsPublic = false; paintPrivacy(); };

  _setInviteTools(overlay, true);
  const copyBtn = overlay.querySelector('#grpCreateCopyInviteBtn');
  if (copyBtn) copyBtn.onclick = () => {
    navigator.clipboard?.writeText(`${window.location.origin}/chats/g/${_pendingInviteCode}`);
    toast('Taklif havolasi nusxalandi', 'success');
  };
  const regenBtn = overlay.querySelector('#grpCreateRegenInviteBtn');
  if (regenBtn) regenBtn.onclick = () => {
    _pendingInviteCode = generate64HexToken();
    if (tokenEl) tokenEl.textContent = `${window.location.origin}/chats/g/${_pendingInviteCode}`;
    toast('Yangi 64-xonali taklif havolasi yaratildi', 'info');
  };

  /* Yozish huquqi */
  _setMsgPermUI(overlay, g.msgPermission || 'all');

  /* Avatar */
  const aviImg = overlay.querySelector('.grp-form-avi-img');
  aviImg.src = g.avatar || defAvi(g.name || 'G');
  aviImg.style.display = '';
  overlay.querySelector('.grp-form-avi-placeholder').style.display = 'none';

  /* A'zolar */
  const pickerSection = overlay.querySelector('#grpMemberPickerSection');
  pickerSection.innerHTML = '<div class="spin-wrap pt-20px"><div class="spinner"></div></div>';

  overlay.classList.add('show');

  const [users] = await Promise.all([
    _loadContactsForPicker(),
    (async () => {
      try {
        const { data } = await sb.from('group_members').select('user_id, can_write').eq('group_id', groupId);
        for (const r of data || []) {
          const w = r.can_write !== false;
          _editWritersBase.set(r.user_id, w);
          if (w) _selectedWriters.add(r.user_id);
        }
      } catch (_) {}
      if (!_editWritersBase.size) {
        for (const uid of _existingMemberUids) { _editWritersBase.set(uid, true); _selectedWriters.add(uid); }
      }
    })(),
  ]);
  if (overlay.dataset.editMode !== groupId) return; // shu orada yopilgan
  _usersForPicker = users;
  _renderMemberPicker(pickerSection, users, { existingMembers: _existingMemberUids });
  _setMsgPermUI(overlay, overlay.querySelector('#grpFormMsgPerm').value);
}

async function _submitGroupEdit(groupId) {
  const overlay = document.getElementById('grpCreateFormOverlay');
  const g = _editGroupData || _latestGroupMap[groupId] || {};

  const name = overlay.querySelector('#grpFormName').value.trim();
  if (!name) { toast('Nom kiriting', 'error'); return; }
  const desc = overlay.querySelector('#grpFormDesc').value.trim();
  const permRaw = overlay.querySelector('#grpFormMsgPerm')?.value;
  const perm = ['all', 'admins', 'selected'].includes(permRaw) ? permRaw : 'all';

  const updates = { name, description: desc, msg_permission: perm };
  if (_pendingPhotoUrl) updates.avatar = _pendingPhotoUrl;

  if (_createIsPublic) {
    const rawUser = overlay.querySelector('#grpFormUsername')?.value?.trim();
    if (!rawUser) { toast('Ommaviy guruh uchun username kiriting', 'error'); return; }
    const avail = await checkGroupUsernameAvailable(rawUser, groupId);
    if (!avail.ok) { toast(avail.error || 'Bu nom allaqachon band', 'error'); return; }
    updates.is_private = false;
    updates.username = avail.username;
    updates.invite_code = null;
  } else {
    updates.is_private = true;
    updates.username = null;
    updates.invite_code = _pendingInviteCode;
  }

  const btn = overlay.querySelector('#grpFormCreateBtn');
  btn.disabled = true;
  btn.textContent = 'Saqlanmoqda...';
  try {
    const who = _myNoticeName();
    const notices = [];
    if (name !== (g.name || '')) notices.push(who + ' guruh nomini o\'zgartirdi');
    if (_pendingPhotoUrl && _pendingPhotoUrl !== (g.avatar || '')) notices.push(who + ' guruh rasmini o\'zgartirdi');
    if ((updates.username || '') !== (g.username || '')) notices.push(who + ' guruh usernameini o\'zgartirdi');

    await _updateGroup(groupId, updates);

    /* Yangi tanlangan a'zolar */
    const added = Array.from(_selectedMembers);
    if (added.length) {
      await _addMembers(groupId, added, perm === 'selected' ? new Set(_selectedWriters) : null);
      await _joinedNotices(groupId, added);
    }
    /* Chiqariladigan a'zolar */
    let removed = 0, removeFail = 0;
    for (const uid of _removeSet) {
      try { await _removeMember(groupId, uid); removed++; } catch (_) { removeFail++; }
    }
    /* Mavjud a'zolarning yozish huquqi */
    if (perm === 'selected') {
      for (const [uid, was] of _editWritersBase) {
        if (uid === g.ownerId || _removeSet.has(uid)) continue;
        const now = _selectedWriters.has(uid);
        if (now === was) continue;
        try { await sb.from('group_members').update({ can_write: now }).eq('group_id', groupId).eq('user_id', uid); } catch (_) {}
      }
    }

    for (const line of notices) await _postGroupNotice(groupId, line);
    _pushGroupMeta(groupId, {
      name: updates.name,
      avatar: updates.avatar || g.avatar || '',
      username: updates.username || '',
      count: (g.members || []).length + added.length - removed,
      lastMessage: notices[0] || '',
    });
    overlay.classList.remove('show');
    overlay.dataset.editMode = '';
    toast(removeFail ? `Guruh yangilandi, ${removeFail} ta a'zoni chiqarib bo'lmadi` : 'Guruh yangilandi', removeFail ? 'error' : 'success');
    openGroupInfo(groupId);
  } catch (e) {
    toast('Xato: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = overlay.dataset.editMode ? 'Saqlash' : 'Yaratish';
  }
}

// Q: kanal turi yo'q — "+" to'g'ridan-to'g'ri guruh yaratish formasini ochadi
export function openCreateChoice() {
  // + tugmasi: dropdown — Guruh yaratish | Guruhga qo'shilish
  let menu = document.getElementById('chatsAddMenu');
  if (menu) { menu.remove(); return; }
  const btn = document.getElementById('chatsAddBtn');
  if (!btn) { openCreateForm('group'); return; }
  menu = document.createElement('div');
  menu.id = 'chatsAddMenu';
  menu.className = 'chats-add-menu';
  menu.innerHTML = `
    <button type="button" class="chats-add-menu-item" data-act="create">
      <span>Guruh yaratish</span>
    </button>
    <button type="button" class="chats-add-menu-item" data-act="join">
      <span>Guruhga qo'shilish</span>
    </button>`;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const mw = menu.offsetWidth || 200;
  let left = r.right - mw;
  if (left < 8) left = 8;
  menu.style.left = left + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  const close = () => { menu.remove(); document.removeEventListener('click', onDoc, true); };
  const onDoc = (e) => {
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    close();
  };
  setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  menu.addEventListener('click', (e) => {
    const it = e.target.closest('[data-act]');
    if (!it) return;
    close();
    if (it.dataset.act === 'create') openCreateForm('group');
    else if (it.dataset.act === 'join') openJoinGroupModal();
  });
}

export function openJoinGroupModal() {
  document.getElementById('grpJoinOverlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'grpJoinOverlay';
  ov.className = 'grp-join-overlay';
  ov.innerHTML = `
    <div class="grp-join-card" role="dialog" aria-label="Guruhga qo'shilish">
      <div class="grp-join-hdr">
        <span class="grp-join-title">Guruhga qo'shilish</span>
        <button type="button" class="grp-join-close" aria-label="Yopish">×</button>
      </div>
      <p class="grp-join-hint">Ommaviy guruhni nomi yoki @username bo'yicha qidiring. Maxfiy guruh uchun havola yoki kodni to'liq kiriting.</p>
      <input type="text" class="grp-join-input" id="grpJoinInput" placeholder="Guruh nomi, @username, havola yoki kod" autocomplete="off" spellcheck="false">
      <div class="grp-join-status" id="grpJoinStatus" hidden></div>
      <div class="grp-join-results" id="grpJoinResults" hidden></div>
      <div class="grp-join-preview" id="grpJoinPreview" hidden></div>
      <button type="button" class="grp-join-submit" id="grpJoinSubmit" disabled hidden>Qo'shilish</button>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  const inp = ov.querySelector('#grpJoinInput');
  const st = ov.querySelector('#grpJoinStatus');
  const prev = ov.querySelector('#grpJoinPreview');
  const sub = ov.querySelector('#grpJoinSubmit');
  const results = ov.querySelector('#grpJoinResults');
  let resolved = null;
  let timer = null;
  let searchSeq = 0;
  // Havola (http…, "/" bor) yoki uzun kod (hex) — maxfiy/aniq qo'shilish; qolgani — ommaviy guruhlarni nom/@username bo'yicha qidirish
  const isTokenLike = raw => /^https?:\/\//i.test(raw) || raw.includes('/') || /^[a-f0-9]{32,}$/i.test(raw);
  const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 150); };
  ov.querySelector('.grp-join-close').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  const setStatus = (msg, ok) => {
    st.hidden = !msg;
    st.textContent = msg || '';
    st.className = 'grp-join-status' + (ok === true ? ' ok' : ok === false ? ' err' : '');
  };
  const renderResults = list => {
    results.hidden = !list.length;
    results.innerHTML = list.map(g => {
      const joined = (g.members || []).includes(state.me?.uid);
      const cnt = g.subscriberCount || (g.members || []).length || 0;
      return `<div class="grp-join-row" data-gid="${esc(g.id)}">
        <img class="grp-join-row-avi" src="${esc(g.avatar || defAvi(g.name || 'G'))}" alt="" onerror="this.style.visibility='hidden'">
        <div class="grp-join-row-body">
          <div class="grp-join-row-name">${esc(g.name || 'Guruh')}</div>
          <div class="grp-join-row-meta">${g.username ? '@' + esc(g.username) + ' · ' : ''}${cnt} a'zo</div>
        </div>
        <button type="button" class="grp-join-row-btn${joined ? ' is-open' : ''}" data-act="${joined ? 'open' : 'join'}">${joined ? 'Ochish' : "Qo'shilish"}</button>
      </div>`;
    }).join('');
    results._list = list;
  };
  const runSearch = async raw => {
    const seq = ++searchSeq;
    setStatus('Qidirilmoqda…');
    const list = await searchGroups(raw);   // faqat OMMAVIY guruhlar (maxfiy hech qachon chiqmaydi)
    if (seq !== searchSeq) return;
    renderResults(list);
    setStatus(list.length ? '' : 'Ommaviy guruh topilmadi', list.length ? undefined : false);
  };
  results.addEventListener('click', async e => {
    const btn = e.target.closest('.grp-join-row-btn');
    const row = e.target.closest('.grp-join-row');
    if (!btn || !row) return;
    const gid = row.dataset.gid;
    if (btn.dataset.act === 'join') {
      btn.disabled = true;
      try {
        await joinGroup(gid);
        toast("Guruhga qo'shildingiz", 'success');
      } catch (_) {
        btn.disabled = false;
        toast("Guruhga qo'shilishda xatolik", 'error');
        return;
      }
      try { await _loadGroups(); } catch (_) {}
    }
    close();
    openGroupThread(gid);
  });
  const tryResolve = async () => {
    const raw = (inp.value || '').trim();
    resolved = null;
    sub.disabled = true;
    sub.hidden = false;
    prev.hidden = true;
    prev.innerHTML = '';
    if (raw.length < 12) { setStatus(''); return; }
    // Qisman qidiruv yo'q — faqat yetarli uzun aniq kod/URL
    setStatus('Tekshirilmoqda…');
    const r = await resolveGroupInvite(raw);
    if ((inp.value || '').trim() !== raw) return;
    if (!r?.success) {
      setStatus(r?.error || 'Guruh topilmadi', false);
      return;
    }
    resolved = r;
    setStatus('');
    prev.hidden = false;
    prev.innerHTML = `<div class="grp-join-prev-name">${esc(r.name || 'Guruh')}</div>
      <div class="grp-join-prev-meta">${r.is_private ? 'Maxfiy guruh' : 'Ommaviy guruh'}</div>`;
    sub.disabled = false;
  };
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    searchSeq++;
    sub.disabled = true;
    resolved = null;
    prev.hidden = true;
    renderResults([]);
    const raw = (inp.value || '').trim();
    if (isTokenLike(raw)) {
      sub.hidden = false;
      if (raw.length < 12) { setStatus(''); return; }
      timer = setTimeout(tryResolve, 400);
      return;
    }
    sub.hidden = true;
    if (raw.replace(/^@/, '').length < 2) { setStatus(''); return; }
    timer = setTimeout(() => runSearch(raw), 300);
  });
  sub.addEventListener('click', async () => {
    if (!resolved) return;
    sub.disabled = true;
    const r = await joinGroupByToken(inp.value.trim());
    if (!r?.success) {
      setStatus(r?.error || "Qo'shilish amalga oshmadi", false);
      sub.disabled = false;
      return;
    }
    toast("Guruhga qo'shildingiz", 'success');
    close();
    try { await _loadGroups(); } catch (_) {}
    if (r.group_id) openGroupThread(r.group_id);
  });
  setTimeout(() => inp.focus(), 50);
}

let _createType    = 'group';
let _selectedMembers = new Set();
let _existingMemberUids = new Set();
/** msg_permission=selected: yozish mumkin bo'lgan uid lar */
let _selectedWriters = new Set();
let _removeSet = new Set();   /* sozlamalarda 'chiqariladi' deb belgilangan mavjud a'zolar */
let _wasPicked = new Set();   /* tugma/qator orqali qo'lda tanlanganlar (qayta bosilsa bekor bo'ladi) */
let _pendingPhotoUrl = null;
let _usersForPicker = [];
let _createIsPublic = true;
let _pendingInviteCode = null;

export function openCreateForm(type) {
  _createType      = type;
  _selectedMembers = new Set();
  _wasPicked = new Set();
  _removeSet = new Set();
  _pendingPhotoUrl = null;
  _usersForPicker  = [];
  _createIsPublic  = true;
  _pendingInviteCode = generate64HexToken();
  _selectedWriters = new Set();
  _existingMemberUids = new Set();
  _editWriterMode = false;
  _editOwnerId = null;
  _editGroupData = null;

  const overlay = document.getElementById('grpCreateFormOverlay');
  if (!overlay) return;
  overlay.dataset.editMode = '';
  _setInviteTools(overlay, false);

  overlay.querySelector('.grp-form-title').textContent = 'Yangi guruh';
  overlay.querySelector('#grpFormDescWrap').style.display = '';
  overlay.querySelector('#grpFormPrivacyWrap').style.display = '';
  overlay.querySelector('.grp-form-avi-wrap').style.display = '';
  overlay.querySelector('#grpFormName').style.display = '';
  overlay.querySelector('#grpFormCreateBtn').textContent = 'Yaratish';
  overlay.dataset.addMode = '';

  const pubBtn = overlay.querySelector('#grpCreatePublicBtn');
  const privBtn = overlay.querySelector('#grpCreatePrivateBtn');
  const pubSec = overlay.querySelector('#grpCreatePublicSection');
  const privSec = overlay.querySelector('#grpCreatePrivateSection');
  const tokenEl = overlay.querySelector('#grpCreateInviteToken');

  const updateCreatePrivacyUI = () => {
    if (_createIsPublic) {
      pubBtn?.classList.add('active');
      privBtn?.classList.remove('active');
      if (pubSec) pubSec.style.display = '';
      if (privSec) privSec.style.display = 'none';
    } else {
      privBtn?.classList.add('active');
      pubBtn?.classList.remove('active');
      if (pubSec) pubSec.style.display = 'none';
      if (privSec) privSec.style.display = '';
      if (tokenEl) tokenEl.textContent = `${window.location.origin}/chats/g/${_pendingInviteCode}`;
    }
  };
  updateCreatePrivacyUI();

  if (pubBtn) pubBtn.onclick = () => { _createIsPublic = true; updateCreatePrivacyUI(); };
  if (privBtn) privBtn.onclick = () => { _createIsPublic = false; updateCreatePrivacyUI(); };

  overlay.querySelector('#grpFormUsername').value = '';
  overlay.querySelector('#grpFormName').value = '';
  overlay.querySelector('#grpFormDesc').value = '';
  overlay.querySelector('.grp-form-desc-hint').textContent = '';
  const _perm = overlay.querySelector('#grpFormMsgPerm');
  if (_perm) _perm.value = 'all';
  const _pl = overlay.querySelector('#grpFormMsgPermLabel');
  if (_pl) _pl.textContent = "Xabar yuborish: barcha a'zolar";
  document.body.classList.remove('grp-perm-selected');
  overlay.querySelector('#grpMemberPickerSection')?.classList.remove('perm-selected');
  if (_perm) _perm.value = 'all';

  // Member picker section — channels can have members too (subscribers)
  const pickerSection = overlay.querySelector('#grpMemberPickerSection');
  pickerSection.innerHTML = '<div class="spin-wrap pt-20px"><div class="spinner"></div></div>';

  // Load users
  _loadContactsForPicker().then(users => {
    _usersForPicker = users;
    _renderMemberPicker(pickerSection, users);
  });

  overlay.querySelector('.grp-form-avi-img').src = '';
  overlay.querySelector('.grp-form-avi-img').style.display = 'none';
  overlay.querySelector('.grp-form-avi-placeholder').style.display = '';

  overlay.classList.add('show');
}

async function _loadUsersForPicker() {
  // Eski API: endi ham faqat kontaktlar (barcha foydalanuvchilar emas)
  return _loadContactsForPicker();
}

/**
 * Guruh a'zo picker: FAQAT mening kontaktlarim.
 * contacts jadvali — hech qachon butun profiles va DM zaxirasi emas.
 */
async function _loadContactsForPicker() {
  const me = state.me?.uid;
  if (!me) return [];
  try {
    const idSet = new Set();

    // 1) contacts
    const { data: crows, error: cErr } = await sb
      .from('contacts')
      .select('contact_id')
      .eq('owner_id', me);
    if (cErr) console.warn('[Groups] contacts:', cErr.message);
    for (const r of crows || []) {
      if (r.contact_id && r.contact_id !== me) idSet.add(r.contact_id);
    }

    // Faqat contacts. DM sheriklari va barcha SpaceMR userlari ko'rsatilmaydi.
    if (!idSet.size) return [];

    const ids = [...idSet];
    // Faqat shu ID lar — profiles ni butunlay yuklamaymiz
    const { data: prows, error: pErr } = await sb
      .from('profiles')
      .select('id, username, full_name, avatar, approval, blocked, blocked_until')
      .in('id', ids);
    if (pErr) throw pErr;

    return (prows || [])
      .map(mapProfile)
      .filter(u => u && u.uid !== me && isActiveUser(u))
      .sort((a, b) => (a.fullName || a.username || '').localeCompare(b.fullName || b.username || '', 'uz'));
  } catch (e) {
    console.warn('[Groups] contacts picker:', e?.message || e);
    return [];
  }
}


function _updateSelCount() {
  const cnt = document.getElementById('grpSelCount');
  if (!cnt) return;
  cnt.textContent = `${_selectedMembers.size} ta tanlangan` + (_removeSet.size ? ` · ${_removeSet.size} ta chiqariladi` : '');
}

function _syncPickerWriteMode() {
  const listEl = document.getElementById('grpPickerList');
  const mode = document.getElementById('grpFormMsgPerm')?.value === 'selected';
  document.getElementById('grpFormMsgPermWrap')?.classList.toggle('is-selected-mode', mode);
  if (!listEl) return;
  // qayta chizish uchun current users from rows data-uid — oddiy class sync
  listEl.querySelectorAll('.grp-picker-row').forEach(row => {
    const uid = row.dataset.uid;
    const sel = _selectedMembers.has(uid);
    if (!mode) {
      row.querySelector('.grp-picker-write-tools')?.remove();
      row.classList.remove('can-write', 'no-write');
      return;
    }
    if (sel && !row.querySelector('.grp-picker-write-tools')) {
      // tools yo'q — to'liq qayta render kerak; eng oson: trigger search input
    }
  });
  // Qayta render (qidiruv matni o'zgarmagan bo'lsa ham)
  const sec = document.getElementById('grpMemberPickerSection');
  const all = sec?._pickerUsers;
  if (all) {
    const q = (document.getElementById('grpPickerSearch')?.value || '').trim().toLowerCase();
    const list = q ? all.filter(u => (u.fullName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)) : all;
    _renderPickerRows(list, listEl, q);
  }
}

function _bindMsgPermDropdown() {
  const wrap = document.getElementById('grpFormMsgPermWrap');
  const btn = document.getElementById('grpFormMsgPermBtn');
  const menu = document.getElementById('grpFormMsgPermMenu');
  const hidden = document.getElementById('grpFormMsgPerm');
  const label = document.getElementById('grpFormMsgPermLabel');
  if (!wrap || !btn || wrap.dataset.bound) return;
  wrap.dataset.bound = '1';
  const LABELS = {
    all: "Xabar yuborish: barcha a'zolar",
    admins: "Xabar yuborish: faqat adminlar (kanal kabi)",
    selected: "Xabar yuborish: faqat tanlanganlar",
  };
  const close = () => {
    menu.hidden = true;
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    document.querySelectorAll('.grp-msg-perm-menu').forEach(m => { m.hidden = true; });
    if (open) {
      menu.hidden = false;
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    } else close();
  });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-perm]');
    if (!item) return;
    const v = item.getAttribute('data-perm');
    hidden.value = v;
    wrap.dataset.value = v;
    label.textContent = LABELS[v] || LABELS.all;
    menu.querySelectorAll('.grp-msg-perm-item').forEach(el => el.classList.toggle('is-active', el === item));
    close();
    document.body.classList.toggle('grp-perm-selected', v === 'selected');
    const sec = document.getElementById('grpMemberPickerSection');
    sec?.classList.toggle('perm-selected', v === 'selected');
    const listEl = document.getElementById('grpPickerList');
    const allUsers = sec?._pickerUsers;
    if (listEl && allUsers) {
      const q = (document.getElementById('grpPickerSearch')?.value || '').trim().toLowerCase();
      const filtered = q ? allUsers.filter(u =>
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q)
      ) : allUsers;
      _renderPickerRows(filtered, listEl, q);
    }
    // noop keep next line if any
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });
}

function _renderMemberPicker(container, users, opts = {}) {
  const existing = opts.existingMembers || _existingMemberUids || new Set();
  _existingMemberUids = existing;
  if (!users.length) {
    container.innerHTML = `<div class="grp-empty-users">Kontaktlaringiz yo'q.
Avval kimdir bilan suhbat oching — keyin shu yerda chiqadi.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="grp-picker-search-wrap">
      <img src="./svg/extra/icon-34d2886eafb1.svg" alt="" class="icon" width="14" height="14">
      <input class="grp-picker-search" id="grpPickerSearch" placeholder="Ism yoki username..." autocomplete="off" spellcheck="false">
    </div>
    <div class="grp-picker-list" id="grpPickerList"></div>
    <div class="grp-sel-count" id="grpSelCount">0 ta tanlangan</div>
  `;
  const listEl = container.querySelector('#grpPickerList');
  const searchEl = container.querySelector('#grpPickerSearch');
  container._pickerUsers = users;
  _renderPickerRows(users, listEl);

  // Event delegation — har filterda listener qayta bog'lanmasin
  if (!listEl._pickerClickBound) {
    listEl._pickerClickBound = true;
    listEl.addEventListener('click', e => {
      /* Qalam / block — yozish ruxsati */
      const writeBtn = e.target.closest?.('[data-write-toggle]');
      if (writeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const row = writeBtn.closest('.grp-picker-row');
        const uid = row?.dataset?.uid;
        if (!uid) return;
        const isExisting = _existingMemberUids.has(uid);
        if (isExisting && !_editWriterMode) return;
        if (!isExisting && !_selectedMembers.has(uid)) _selectedMembers.add(uid);
        const allow = writeBtn.getAttribute('data-write-toggle') === '1';
        if (!isExisting) { _selectedMembers.add(uid); _wasPicked.add(uid); }
        if (allow) _selectedWriters.add(uid); else _selectedWriters.delete(uid);
        _updateSelCount();
        _syncPickerWriteMode();
        return;
      }
      const row = e.target.closest?.('.grp-picker-row');
      if (!row || !listEl.contains(row)) return;
      const uid = row.dataset.uid;
      if (!uid) return;
      /* Allaqachon guruhda — o'zgartirib bo'lmaydi */
      if (row.classList.contains('is-member') || (_existingMemberUids && _existingMemberUids.has(uid))) {
        /* Sozlamalarda: mavjud a'zoni bosish = chiqarish uchun belgilash (qizil X), qayta bossang bekor */
        if (_editWriterMode && uid !== _editOwnerId && uid !== state.me?.uid) {
          if (_removeSet.has(uid)) _removeSet.delete(uid); else _removeSet.add(uid);
          _updateSelCount();
          _syncPickerWriteMode();
        }
        return;
      }
      if (_selectedMembers.has(uid)) {
        _selectedMembers.delete(uid);
        _selectedWriters.delete(uid);
        _wasPicked.delete(uid);
      } else {
        _selectedMembers.add(uid);
        _selectedWriters.add(uid);
        _wasPicked.add(uid);
      }
      row.classList.toggle('selected', _selectedMembers.has(uid));
      row.querySelector('.grp-picker-check')?.classList.toggle('on', _selectedMembers.has(uid));
      const canW = _selectedWriters.has(uid);
      row.classList.toggle('can-write', _selectedMembers.has(uid) && canW);
      row.classList.toggle('no-write', _selectedMembers.has(uid) && !canW);
      _updateSelCount();
      _syncPickerWriteMode();
    });
  }

  let _qTimer = 0;
  let _lastQ = '';
  searchEl.addEventListener('input', () => {
    clearTimeout(_qTimer);
    _qTimer = setTimeout(() => {
      const q = (searchEl.value || '').trim().toLowerCase();
      if (q === _lastQ) return;
      _lastQ = q;
      const filtered = q ? users.filter(u =>
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q)
      ) : users;
      _renderPickerRows(filtered, listEl, q);
    }, 120);
  });
}

function _renderPickerRows(users, listEl, q = '') {
  if (!listEl) return;
  if (!users.length) {
    listEl.innerHTML = '<div class="grp-picker-empty">' + (q ? 'Hech kim topilmadi' : "Ro'yxat bo'sh") + '</div>';
    return;
  }
  // Avvalgi scroll joyini saqlash
  const prevTop = listEl.scrollTop;
  const selectedMode = (document.getElementById('grpFormMsgPerm')?.value === 'selected');
  listEl.innerHTML = users.map(u => {
    const av   = u.avatar || defAvi(u.fullName || 'U');
    const isMem = !!( _existingMemberUids && _existingMemberUids.has(u.uid) );
    const sel  = isMem || _selectedMembers.has(u.uid);
    const canW = _selectedWriters.has(u.uid);
    const rm = isMem && _editWriterMode && _removeSet.has(u.uid);
    const canToggle = selectedMode && !rm && u.uid !== _editOwnerId && (!isMem || _editWriterMode);
    const writeTools = canToggle ? `
      <div class="grp-picker-write-tools" title="Yozish ruxsati">
        <button type="button" class="grp-write-switch ${!sel ? 'is-idle' : (canW ? 'is-on' : 'is-off')}" data-write-toggle="${sel && canW ? '0' : '1'}" role="switch" aria-checked="${sel && canW ? 'true' : 'false'}" title="${sel && canW ? 'Yoza oladi — o\'chirish' : 'Yoza olmaydi — yoqish'}" aria-label="Yozish ruxsati">
          <span class="grp-write-knob"></span>
        </button>
      </div>` : '';
    return `<div class="grp-picker-row ${sel ? 'selected' : ''} ${isMem ? 'is-member' : ''} ${rm ? 'to-remove' : ''} ${canToggle && sel ? (canW ? 'can-write' : 'no-write') : ''}" data-uid="${u.uid}">
      <div class="grp-picker-avi"><img src="${esc(av)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'"></div>
      <div class="grp-picker-info">
        <div class="grp-picker-name">${esc(u.fullName||'Foydalanuvchi')}</div>
        ${u.username ? `<div class="grp-picker-user">@${esc(u.username)}</div>` : ''}
      </div>
      ${writeTools}
      <div class="grp-picker-check ${sel ? 'on' : ''} ${rm ? 'rm' : ''}">
        <img src="${rm ? './svg/action/close.svg' : './svg/ui/check.svg'}" alt="" class="icon" width="11" height="11">
      </div>
    </div>`;
  }).join('');
  listEl.scrollTop = prevTop;
}

/* ─────────────────────────────────────────────────────────────────────
   ADD USER BY USERNAME (start a private chat)
   ───────────────────────────────────────────────────────────────────── */
export function openAddUserByUsername() {
  const overlay = document.getElementById('grpAddUserOverlay');
  if (!overlay) return;
  const inp = overlay.querySelector('#grpAddUserInput');
  const err = overlay.querySelector('#grpAddUserErr');
  inp.value = '';
  err.textContent = '';
  err.style.display = 'none';
  overlay.classList.add('show');
  setTimeout(() => inp.focus(), FOCUS_DELAY_MS);
}

async function _submitAddUserByUsername() {
  const overlay = document.getElementById('grpAddUserOverlay');
  const inp     = overlay.querySelector('#grpAddUserInput');
  const err     = overlay.querySelector('#grpAddUserErr');
  const btn     = overlay.querySelector('#grpAddUserSubmitBtn');
  let uname = inp.value.trim();
  if (uname.startsWith('@')) uname = uname.slice(1);
  if (!uname) {
    err.textContent = "Username kiriting";
    err.style.display = '';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Qidirilmoqda...';
  try {
    const users = await _loadUsersForPicker();
    const found = users.find(u => (u.username || '').toLowerCase() === uname.toLowerCase());
    if (!found) {
      err.textContent = `"@${uname}" topilmadi`;
      err.style.display = '';
      return;
    }
    overlay.classList.remove('show');
    const { openChatThread } = await import('./chat.js');
    toast(`@${found.username} bilan suhbat ochildi`, 'success');
    setTimeout(() => openChatThread(found.uid), OPEN_CHAT_DELAY_MS);
  } catch (e) {
    err.textContent = 'Xato yuz berdi';
    err.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = "Qo'shish";
  }
}

/* ─────────────────────────────────────────────────────────────────────
   ADD MEMBER to existing group
   ───────────────────────────────────────────────────────────────────── */
export async function openMemberPicker(groupId, mode) {
  // Re-open create form overlay as add-member flow (reuse UI)
  _selectedMembers = new Set();
  _wasPicked = new Set();
  _removeSet = new Set();
  const g = _latestGroupMap[groupId];
  const existingMembers = new Set(g?.members || []);

  const overlay = document.getElementById('grpCreateFormOverlay');
  if (!overlay) return;

  overlay.querySelector('.grp-form-title').textContent = "A'zo qo'shish";
  overlay.querySelector('#grpFormDescWrap').style.display = 'none';
  overlay.querySelector('#grpFormPrivacyWrap').style.display = 'none';
  overlay.querySelector('#grpCreatePublicSection').style.display = 'none';
  overlay.querySelector('#grpCreatePrivateSection').style.display = 'none';
  overlay.querySelector('.grp-form-avi-wrap').style.display = 'none';
  overlay.querySelector('.grp-form-desc-hint').textContent = '';
  overlay.querySelector('#grpFormName').style.display = 'none';
  overlay.querySelector('#grpFormCreateBtn').textContent = "Qo'shish";
  overlay.dataset.addMode = groupId;
  overlay.dataset.editMode = '';
  _editWriterMode = false;
  _editOwnerId = null;

  const pickerSection = overlay.querySelector('#grpMemberPickerSection');
  pickerSection.innerHTML = '<div class="spin-wrap pt-20px"><div class="spinner"></div></div>';
  const users = await _loadContactsForPicker();
  /* Barcha kontaktlar: guruhda borlari galochka + qayta tanlab bo'lmaydi */
  _existingMemberUids = existingMembers;
  _selectedMembers = new Set();
  _wasPicked = new Set();
  _removeSet = new Set();
  _usersForPicker = users;
  _renderMemberPicker(pickerSection, users, { existingMembers });

  overlay.classList.add('show');
}

/* ─────────────────────────────────────────────────────────────────────
   SUBMIT CREATE / ADD MEMBER
   ───────────────────────────────────────────────────────────────────── */
export async function submitCreateGroup() {
  const overlay  = document.getElementById('grpCreateFormOverlay');
  const addMode  = overlay?.dataset?.addMode;
  const editId   = overlay?.dataset?.editMode;

  if (editId) { await _submitGroupEdit(editId); return; }

  if (addMode) {
    // Add members to existing group
    if (!_selectedMembers.size) { toast('Kamida 1 ta a\'zo tanlang', 'error'); return; }
    try {
      const added = Array.from(_selectedMembers);
      await _addMembers(addMode, added);
      await _joinedNotices(addMode, added);
      overlay.classList.remove('show');
      overlay.dataset.addMode = '';
      // Reset hidden elements
      overlay.querySelector('.grp-form-avi-wrap').style.display = '';
      overlay.querySelector('#grpFormName').style.display = '';
      overlay.querySelector('#grpFormCreateBtn').textContent = 'Yaratish';
      toast(`${_selectedMembers.size} ta a'zo qo'shildi`, 'success');
    } catch(e) { toast('Xato yuz berdi', 'error'); }
    return;
  }

  const name = overlay?.querySelector('#grpFormName').value?.trim();
  if (!name) { toast('Nom kiriting', 'error'); return; }

  let groupUsername = null;
  let inviteCode = null;

  if (_createIsPublic) {
    const rawUser = overlay?.querySelector('#grpFormUsername')?.value?.trim();
    if (!rawUser) { toast('Ommaviy guruh uchun username kiriting', 'error'); return; }
    const avail = await checkGroupUsernameAvailable(rawUser);
    if (!avail.ok) { toast(avail.error || 'Bu nom allaqachon band', 'error'); return; }
    groupUsername = avail.username;
  } else {
    inviteCode = _pendingInviteCode || generate64HexToken();
  }

  const btn = overlay?.querySelector('#grpFormCreateBtn');
  btn.disabled = true;
  btn.textContent = 'Yaratilmoqda...';

  try {
    // id ni o'zimiz beramiz: yopiq guruhda insert...select RLS'dan o'tmasligi mumkin
    const newId = crypto.randomUUID();
    const { error: gErr } = await sb.from('groups').insert({
      id:          newId,
      type:        'group',
      name,
      avatar:      _pendingPhotoUrl || '',
      description: overlay.querySelector('#grpFormDesc')?.value?.trim() || '',
      msg_permission: (['all','admins','selected'].includes(overlay.querySelector('#grpFormMsgPerm')?.value)
        ? overlay.querySelector('#grpFormMsgPerm').value : 'all'),
      owner_id:    state.me.uid,
      is_private:  !_createIsPublic,
      username:    groupUsername,
      invite_code: inviteCode,
    });
    if (gErr) throw gErr;
    // Egasi trigger orqali qo'shiladi; tanlangan a'zolarni qo'shamiz
    if (_selectedMembers.size) {
      try {
        const perm = overlay.querySelector('#grpFormMsgPerm')?.value || 'all';
        const writers = perm === 'selected' ? new Set(_selectedWriters) : null;
        await _addMembers(newId, Array.from(_selectedMembers), writers);
      }
      catch (e) { console.warn('[Groups] a\'zolarni qo\'shib bo\'lmadi:', e.message); }
    }
    await _loadGroups();
    overlay.classList.remove('show');
    toast('Guruh yaratildi!', 'success');
    setTimeout(() => openGroupThread(newId), 100);
  } catch(err) {
    console.error('[Groups] create failed:', err);
    toast('Yaratib bo\'lmadi: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Yaratish';
  }
}

/* ─────────────────────────────────────────────────────────────────────
   PHOTO UPLOAD for group/channel
   ───────────────────────────────────────────────────────────────────── */
export async function pickGroupPhoto() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Rasm 5 MB dan kichik bo\'lishi kerak', 'error'); return; }
    toast('Rasm yuklanmoqda...', 'info', 2000);
    try {
      const result = await uploadViaController(file, 'group-avatars');
      _pendingPhotoUrl = result.url;
      const img = document.querySelector('#grpCreateFormOverlay .grp-form-avi-img');
      const ph  = document.querySelector('#grpCreateFormOverlay .grp-form-avi-placeholder');
      if (img) { img.src = result.url; img.style.display = ''; }
      if (ph)  ph.style.display = 'none';
      toast('Rasm yuklandi', 'success');
    } catch(e) { toast('Rasm yuklanmadi' + (e && e.message ? ': ' + e.message : ''), 'error'); }
  };
  input.click();
}

/* ─────────────────────────────────────────────────────────────────────
   INJECT DOM — all overlays/panels added once to body
   ───────────────────────────────────────────────────────────────────── */
export function injectGroupsDOM() {
  if (document.getElementById('grpCreateFormOverlay')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <!-- Add user by username sheet -->
    <div class="overlay" id="grpAddUserOverlay">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Foydalanuvchi qo'shish</div>
        <input class="field mb-12px" id="grpAddUserInput" placeholder="@username" maxlength="32" autocomplete="off">
        <div class="grp-form-desc-hint" id="grpAddUserErr" style="display:none;color:var(--red,#f4212e)"></div>
        <div class="grp-form-actions">
          <button class="btn-ghost" id="grpAddUserCancelBtn">Bekor qilish</button>
          <button class="btn-primary" id="grpAddUserSubmitBtn">Qo'shish</button>
        </div>
      </div>
    </div>

    <!-- Create form sheet -->
    <div class="overlay" id="grpCreateFormOverlay">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="grp-form-head">
          <button type="button" class="grp-form-back" id="grpFormCancelBtn" aria-label="Orqaga" title="Orqaga">
            <img src="./svg/nav/chevron-left.svg" alt="" class="icon" width="22" height="22">
          </button>
          <div class="grp-form-title sheet-title">Yangi guruh</div>
        </div>

        <!-- Avatar picker -->
        <div class="grp-form-avi-wrap" id="grpFormAviWrap">
          <div class="grp-form-avi" id="grpFormAvi">
            <div class="grp-form-avi-placeholder">
              <img src="./svg/media/camera.svg" alt="" class="icon" width="28" height="28">
            </div>
            <img class="grp-form-avi-img" src="" style="display:none;" alt="">
          </div>
          <div class="grp-form-avi-hint">Rasm tanlash</div>
        </div>

        <!-- Name -->
        <input class="field mb-12px" id="grpFormName" placeholder="Guruh nomi" maxlength="64" autocomplete="off">

        <!-- Privacy Toggle (Ommaviy / Maxfiy) -->
        <div class="grp-form-privacy-wrap mb-12px" id="grpFormPrivacyWrap">
          <div class="pe-field-label">Guruh turi</div>
          <div class="grp-privacy-toggle">
            <button type="button" class="grp-privacy-btn active" id="grpCreatePublicBtn">
              <img src="./svg/extra/icon-f57c0d2780e7.svg" alt="" class="icon" width="15" height="15">
              Ommaviy
            </button>
            <button type="button" class="grp-privacy-btn" id="grpCreatePrivateBtn">
              <img src="./svg/auth/lock.svg" alt="" class="icon" width="15" height="15">
              Maxfiy
            </button>
          </div>
        </div>

        <!-- Ommaviy username -->
        <div id="grpCreatePublicSection" class="mb-12px">
          <div class="pe-field-label">Ommaviy username (@) *</div>
          <div class="grp-username-input-wrap">
            <span class="grp-username-prefix">@</span>
            <input class="field" id="grpFormUsername" placeholder="username (masalan: spacemr_uz)" maxlength="40" autocomplete="off">
          </div>
          <div class="grp-form-desc-hint" id="grpFormUsernameHint">Ommaviy guruh username orqali topiladi va hamma qo'shila oladi</div>
        </div>

        <!-- Maxfiy invite link preview -->
        <div id="grpCreatePrivateSection" class="mb-12px" style="display:none">
          <div class="pe-field-label">Maxfiy taklif havolasi (64 xonali)</div>
          <div class="grp-invite-preview">
            <span class="grp-invite-token" id="grpCreateInviteToken"></span>
            <button type="button" class="grp-invite-copy-btn" id="grpCreateCopyInviteBtn" style="display:none">Nusxa</button>
            <button type="button" class="grp-invite-regen-btn" id="grpCreateRegenInviteBtn" style="display:none" title="Yangi havola yaratish" aria-label="Yangi havola yaratish"><img src="./svg/action/refresh.svg" alt="" class="icon" width="14" height="14"></button>
          </div>
          <div class="grp-form-desc-hint">Faqat ushbu maxfiy havola orqali guruhga qo'shilish mumkin</div>
        </div>

        <!-- Tavsif + xabar yuborish huquqi (a'zo qo'shish rejimida yashiriladi) -->
        <div id="grpFormDescWrap">
          <textarea class="ta mb-12px" id="grpFormDesc" placeholder="Tavsif (ixtiyoriy)" rows="2" maxlength="300"></textarea>
          <div class="grp-msg-perm" id="grpFormMsgPermWrap" data-value="all">
            <button type="button" class="grp-msg-perm-btn" id="grpFormMsgPermBtn" aria-expanded="false">
              <span class="grp-msg-perm-label" id="grpFormMsgPermLabel">Xabar yuborish: barcha a'zolar</span>
              <img src="./svg/nav/chevron-down-alt.svg" alt="" class="icon grp-msg-perm-chev" width="16" height="16">
            </button>
            <div class="grp-msg-perm-menu" id="grpFormMsgPermMenu" hidden>
              <button type="button" class="grp-msg-perm-item is-active" data-perm="all">Xabar yuborish: barcha a'zolar</button>
              <button type="button" class="grp-msg-perm-item" data-perm="admins">Xabar yuborish: faqat adminlar (kanal kabi)</button>
              <button type="button" class="grp-msg-perm-item" data-perm="selected">Xabar yuborish: faqat tanlanganlar</button>
            </div>
            <input type="hidden" id="grpFormMsgPerm" value="all">
          </div>
        </div>

        <div class="grp-form-desc-hint"></div>

        <!-- Member picker -->
        <div class="grp-form-section-title">A'zolar qo'shish</div>
        <div id="grpMemberPickerSection"></div>

        <div class="grp-form-actions">
          <button class="btn-primary" id="grpFormCreateBtn">Yaratish</button>
        </div>
      </div>
    </div>

    <!-- Group / Channel info panel -->
    <!-- Group / Channel info (full-screen page, like userProfileModal) -->
    <div id="grpInfoOverlay">
      <button class="gi-back-btn" id="grpInfoCloseBtn" title="Orqaga">
        <img src="./svg/nav/arrow-left-white.svg" alt="" class="icon" width="18" height="18">
      </button>

      <div class="gi-body">

          <!-- Avatar -->
          <div class="gi-head" id="grpInfoHead">
            <div class="gi-avi-wrap">
              <div class="gi-avi" id="grpInfoAvi" title="Rasmni ko'rish"></div>
            </div>
          </div>

          <!-- Info -->
          <div class="gi-info">
            <div class="gi-name" id="grpInfoName"></div>
            <div class="gi-type-badge" id="grpInfoTypeBadge"></div>
            <div class="gi-link-row" id="grpInfoLinkRow" style="display:none">
              <img src="./svg/extra/icon-9a45b4993686.svg" alt="" class="icon" width="13" height="13">
              <span id="grpInfoLinkText"></span>
            </div>
            <div class="gi-desc" id="grpInfoDesc" style="display:none"></div>

            <!-- Stats row -->
            <div class="gi-stats-row">
              <div class="gi-stat">
                <div class="gi-stat-val" id="grpInfoMemberCount">0</div>
                <div class="gi-stat-lbl" id="grpInfoMemberLbl">a'zo</div>
              </div>
              <div class="gi-stat" id="grpInfoMediaStat" style="display:none">
                <div class="gi-stat-val" id="grpInfoMediaCount">0</div>
                <div class="gi-stat-lbl">media</div>
              </div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="gi-actions">
            <button class="gi-action-btn" id="grpInfoEditBtn" style="display:none">
              <span class="gi-action-icon"><img src="./svg/action/edit.svg" alt="" class="icon" width="16" height="16"></span>
              <span>Sozlamalar</span>
            </button>
            <button class="gi-action-btn" id="grpInfoAddMemberBtn" style="display:none">
              <span class="gi-action-icon"><img src="./svg/extra/icon-886b6ae85bc6.svg" alt="" class="icon" width="16" height="16"></span>
              <span>A'zo qo'shish</span>
            </button>
            <button class="gi-action-btn gi-action-danger" id="grpInfoLeaveBtn">
              <span class="gi-action-icon"><img src="./svg/action/logout.svg" alt="" class="icon" width="16" height="16"></span>
              <span>Chiqish</span>
            </button>
            <button class="gi-action-btn gi-action-delete" id="grpInfoDeleteBtn" style="display:none">
              <span class="gi-action-icon"><img src="./svg/extra/icon-43bf503445c5.svg" alt="" class="icon" width="16" height="16"></span>
              <span>O'chirish</span>
            </button>
          </div>

          <!-- Media grid -->
          <div class="gi-section" id="grpMediaSection">
            <div class="gi-section-title">
              <img src="./svg/extra/icon-6e134fdbda1e.svg" alt="" class="icon" width="13" height="13">
              Media fayllar
            </div>
            <div class="gi-media-grid" id="grpInfoMediaGrid">
              <div class="gi-media-spin"><div class="spinner"></div></div>
            </div>
          </div>

          <!-- Members list (group only, hidden for channel) -->
          <div class="gi-section" id="grpMembersSection">
            <div class="gi-section-title">
              <img src="./svg/extra/icon-a4ea72a360cc.svg" alt="" class="icon" width="13" height="13">
              A'zolar
            </div>
            <div class="grp-members-list" id="grpMembersList"></div>
          </div>

      </div><!-- /gi-body -->
    </div>

    <!-- GROUP/CHANNEL EDIT OVERLAY -->
    <div class="overlay" id="grpEditOverlay">
      <div class="sheet" style="padding-bottom: max(32px, env(safe-area-inset-bottom))">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="grpEditTitle">Guruhni sozlash</div>

        <!-- Avatar picker -->
        <div class="grp-edit-avi-wrap">
          <div class="grp-edit-avi" id="grpEditAviImg"></div>
          <div class="grp-edit-avi-badge" id="grpEditAviBadge" title="Rasm o'zgartirish">
            <img src="./svg/action/edit.svg" alt="" class="icon" width="13" height="13">
          </div>
          <input type="file" id="grpEditAviInput" accept="image/*" style="display:none">
        </div>

        <div class="pe-fields">
          <div class="pe-field-label" id="grpEditNameLabel">Guruh nomi *</div>
          <input class="field" type="text" id="grpEditName" placeholder="Guruh nomi">

          <!-- Privacy Toggle in Settings -->
          <div class="grp-form-privacy-wrap mb-12px" id="grpEditPrivacyWrap">
            <div class="pe-field-label">Guruh turi</div>
            <div class="grp-privacy-toggle">
              <button type="button" class="grp-privacy-btn" id="grpEditPublicBtn">
                <img src="./svg/extra/icon-f57c0d2780e7.svg" alt="" class="icon" width="15" height="15">
                Ommaviy
              </button>
              <button type="button" class="grp-privacy-btn" id="grpEditPrivateBtn">
                <img src="./svg/auth/lock.svg" alt="" class="icon" width="15" height="15">
                Maxfiy
              </button>
            </div>
          </div>

          <!-- Ommaviy Username in Settings -->
          <div id="grpEditPublicSection" class="mb-12px">
            <div class="pe-field-label">Ommaviy username (@) *</div>
            <div class="grp-username-input-wrap">
              <span class="grp-username-prefix">@</span>
              <input class="field" id="grpEditUsername" placeholder="username" maxlength="40" autocomplete="off">
            </div>
            <div class="grp-form-desc-hint" id="grpEditUsernameHint">Ommaviy guruh username orqali topiladi</div>
          </div>

          <!-- Maxfiy 64-xonali invite link in Settings -->
          <div id="grpEditPrivateSection" class="mb-12px" style="display:none">
            <div class="pe-field-label">Maxfiy taklif havolasi (64 xonali)</div>
            <div class="grp-invite-preview">
              <span class="grp-invite-token" id="grpEditInviteToken"></span>
              <button type="button" class="grp-invite-copy-btn" id="grpEditCopyInviteBtn">Nusxa</button>
              <button type="button" class="grp-invite-regen-btn" id="grpEditRegenInviteBtn" title="Yangi havola yaratish" aria-label="Yangi havola yaratish"><img src="./svg/action/refresh.svg" alt="" class="icon" width="14" height="14"></button>
            </div>
            <div class="grp-form-desc-hint">Ushbu 64 xonali havola orqali a'zolar qo'shiladi</div>
          </div>

          <div class="pe-field-label">Tavsif</div>
          <textarea class="ta" id="grpEditDesc" rows="3" placeholder="Guruh haqida..."></textarea>

          <!-- Group-only: settings -->
          <div id="grpEditGroupFields" style="display:none">
            <div class="pe-field-label">Xabar yuborish huquqi</div>
            <select class="field" id="grpEditMsgPerm">
              <option value="all">Barcha a'zolar</option>
              <option value="admins">Faqat adminlar</option>
              <option value="selected">Faqat tanlanganlar</option>
            </select>
          </div>
        </div>

        <button class="btn-primary" id="grpEditSaveBtn">
          <img src="./svg/action/save.svg" alt="" class="icon" width="15" height="15">
          Saqlash
        </button>
        <button class="btn-ghost" id="grpEditCancelBtn">Bekor qilish</button>
      </div>
    </div>
  `);

  // Wire events
  document.getElementById('grpAddUserSubmitBtn').onclick = _submitAddUserByUsername;
  document.getElementById('grpAddUserCancelBtn').onclick = () =>
    document.getElementById('grpAddUserOverlay').classList.remove('show');
  document.getElementById('grpAddUserInput')

  /* Faqat wrap'ga: #grpFormAvi uning ichida, bosish bubble bo'lib shu yerga keladi.
     Ikkalasiga ham qo'yilsa file chooser ikki marta ochilib "user activation" xatosi chiqadi. */
  document.getElementById('grpFormAviWrap').onclick = pickGroupPhoto;
  document.getElementById('grpFormCreateBtn').onclick = submitCreateGroup;
  _bindMsgPermDropdown();
  document.getElementById('grpFormCancelBtn').onclick = (ev) => {
    const ov = document.getElementById('grpCreateFormOverlay');
    const editId = ov.dataset.editMode;
    ov.classList.remove('show');
    ov.dataset.addMode = '';
    ov.dataset.editMode = '';
    if (editId && ev && ev.isTrusted) openGroupInfo(editId);
    ov.querySelector('.grp-form-avi-wrap').style.display = '';
    ov.querySelector('#grpFormName').style.display = '';
    ov.querySelector('#grpFormCreateBtn').textContent = 'Yaratish';
  };

  // Close info panel
  document.getElementById('grpInfoCloseBtn').onclick = () =>
    document.getElementById('grpInfoOverlay').classList.remove('show');

  // Backdrop click closes
  ['grpAddUserOverlay','grpCreateFormOverlay','grpInfoOverlay','grpEditOverlay'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target.id === id) { document.getElementById(id).classList.remove('show'); unlockScroll(id); }
    });
  });
}

/* ─────────────────────────────────────────────────────────────────────
   RENDER GROUP ROWS in chats list (called from chat.js)
   ───────────────────────────────────────────────────────────────────── */
export function getGroupRows() {
  return groupListItems;
}

export function getCurrentGroupId() { return _currentGroupId; }
export function getCurrentGroupData() { return _currentGroupData; }

/* Eski ?g= / ?join= / ?join_group= havolalari olib tashlandi (404). Havolalar: /chats/g/<username|invite-kod>, url-router.js. */
try { sessionStorage.removeItem('spacemr_pending_group'); } catch (_) {}
export async function handleGroupDeepLinks() { /* no-op: eski API moslik uchun */ }
