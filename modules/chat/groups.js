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
import { $, esc, renderMarkdown, defAvi, fmt, fmtTime, fmtSz, lockScroll, unlockScroll, isOnline, isActiveUser, showConfirm } from '../core/utils.js';
import { toast }                                    from '../ui/toast.js';
import { rateOk }                                   from '../core/rate-limit.js';
import { emojiOnlyClass, wrapEmojiNoSelect, playRemoteEmoji } from '../ui/emoji-only.js';
import { registerLocalVoiceUrl, voiceBarCount } from './chat-voice-player.js';
import { openRtGroup }                              from './rt-chat.js';
import { fileMsgPreview }                           from './components/video-note.js';
import { busOn, groupJoin, groupInboxSend, isUidOnline } from '../core/rt-bus.js';
import {
  _toDateSafe, _isSameDay, _dateSepLabel,
  _showPendingBubble, _updatePendingProgress, _removePendingBubble,
  uploadViaControllerProgress, ensureChatsView,
} from './chat-shared.js';
import { chatUI } from './chat-state.js';
import { isEditing, commitEdit }                    from './msg-menu.js';

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
async function _loadGroups() {
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
  // Thread ochiq bo'lsa — admin sozlamani o'zgartirgan bo'lishi mumkin: input qatorini qayta hisoblaymiz
  if (_currentGroupId && _currentGroupData) _applyGroupComposer(_currentGroupData);
  // Notify chat.js list to repaint
  if (state.view === 'chats') document.dispatchEvent(new CustomEvent('groupsUpdated'));
  handleGroupDeepLinks();
}

async function _addMembers(groupId, uids) {
  const rows = uids.map(uid => ({ group_id: groupId, user_id: uid, role: 'member' }));
  const { error } = await sb.from('group_members')
    .upsert(rows, { onConflict: 'group_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
  _loadGroups();
}

async function _removeMember(groupId, uid) {
  const { data, error } = await sb.from('group_members').delete()
    .eq('group_id', groupId).eq('user_id', uid).select();
  if (error) throw error;
  if (!data || !data.length) throw new Error("Ruxsat yo'q");
  _loadGroups();
}

export async function joinGroup(groupId) {
  if (!state.me?.uid || !groupId) return;
  await _addMembers(groupId, [state.me.uid]);
}

export async function leaveGroup(groupId) {
  if (!state.me?.uid || !groupId) return;
  await _removeMember(groupId, state.me.uid);
}

async function _updateGroup(groupId, patch) {
  const { data, error } = await sb.from('groups').update(patch).eq('id', groupId).select();
  if (error) throw error;
  if (!data || !data.length) throw new Error("Ruxsat yo'q");
  await _loadGroups();
}

async function _deleteGroup(groupId) {
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

/** Guruh o'zgarishlarini berilgan (hali subscribe qilinmagan) kanalga ulaydi. */
export function bindGroupsRealtime(ch) {
  const me = state.me?.uid;
  if (!me) return ch;
  return ch
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, p => {
      const id = p.new?.id || p.old?.id;
      if (id && _latestGroupMap[id]) _groupsSched();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `user_id=eq.${me}` }, _groupsSched);
}

export function stopGroupsWatcher() {
  if (_groupsUnsub) { _groupsUnsub(); _groupsUnsub = null; }
  if (_groupThreadUnsub) { _groupThreadUnsub(); _groupThreadUnsub = null; }
  _latestGroupMap  = {};
  groupListItems   = [];
  _currentGroupId  = null;
  _currentGroupData = null;
}

/** P2P/broadcast orqali kelgan guruh xabari — bazadan oldin ko'rsatiladi (id bo'yicha dedup) */
function _gIncoming(groupId, m) {
  if (!m?.id || _currentGroupId !== groupId || !_gLoaded) return;
  if (_gPending.has(m.id) || _gMsgs.some(x => x.id === m.id)) return;
  if (m.from === state.me?.uid) return;
  if (!(_currentGroupData?.members || []).includes(m.from)) return;
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
  const g = _latestGroupMap[o.gid];
  if (!g) return;
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
    if (row) row.style.display = 'none';
    const bar = document.createElement('div');
    bar.id = 'groupJoinBar';
    bar.className = 'group-join-bar';
    bar.innerHTML = `
      <button type="button" class="group-join-btn" id="groupJoinBtn">
        <img src="./svg/extra/icon-886b6ae85bc6.svg" alt="" class="icon" width="18" height="18">
        <span>Guruhga qo'shilish</span>
      </button>`;
    if (row && row.parentNode) row.parentNode.insertBefore(bar, row);

    bar.querySelector('#groupJoinBtn')?.addEventListener('click', async () => {
      const btn = bar.querySelector('#groupJoinBtn');
      btn.disabled = true;
      try {
        await joinGroup(g.id);
        g.members = [...new Set([...(g.members || []), me])];
        toast("Guruhga qo'shildingiz", "success");
        _applyGroupComposer(g);
      } catch (err) {
        btn.disabled = false;
        toast("Guruhga qo'shilishda xatolik", "error");
      }
    });
    return;
  }

  if (can) {
    if (row) row.style.display = '';
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
    const { data, error } = await sb.from('groups')
      .select('*, group_members(user_id, role, unread_count)')
      .or(`username.ilike.%${clean}%,name.ilike.%${clean}%`)
      .limit(20);
    if (error || !data) return [];
    const res = data.map(mapGroup);
    res.forEach(g => { _latestGroupMap[g.id] = g; });
    return res;
  } catch { return []; }
}

export async function openGroupThread(groupId) {
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

  // Type badge on avi
  let existingBadge = modal.querySelector('.grp-avi-badge');
  if (existingBadge) existingBadge.remove();
  const badge = document.createElement('div');
  badge.className = 'grp-avi-badge grp-avi-badge--' + groupData.type;
  badge.innerHTML = `<img src="./svg/extra/icon-a4ea72a360cc.svg" alt="" class="icon" width="10" height="10">`;
  $('chatThreadAvi').appendChild(badge);

  const memberCount = (groupData.members || []).length;
  const subLabel = `${memberCount} ta a'zo`;
  $('chatThreadName').textContent = groupData.name || 'Guruh';

  // Subtitle (typing slot reused)
  const typingEl = $('chatTypingStatus');
  if (typingEl) typingEl.textContent = subLabel;

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
    const { data, error } = await sb.from('group_messages').select('*')
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
    await _gLoadReadMax(groupId);
    if (_gDead || _currentGroupId !== groupId) return;
    _gMsgs = msgs; _gLoaded = true;
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
      const did = p.old?.id;
      if (!did) { sched(); return; }
      _gPending.delete(did);
      markDissolve([did]);
      _gMsgs = _gMsgs.filter(x => x.id !== did);
    } else {
      const m = mapMessage(p.new);
      if (!m || !m.id) { sched(); return; }
      _gPending.delete(m.id);
      const i = _gMsgs.findIndex(x => x.id === m.id);
      if (i >= 0) { _gMsgs = _gMsgs.slice(); _gMsgs[i] = m; }
      else if (p.eventType === 'INSERT') _gMsgs = [..._gMsgs, m];
      else { sched(); return; }
      if ((_latestGroupMap[groupId]?.unreadCount?.[state.me.uid] || 0) > 0 || m.senderId !== state.me.uid) _resetGroupUnread(groupId);
    }
    paintGroupMessages(_gMsgs, _currentGroupData || groupData);
  };
  window.addEventListener('spacemr:resync', sched);   // ochiq guruh chati ham uyg'onganda yangilanadi
  const gch = sb.channel('gthread-' + groupId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, applyGroupPayload)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, (p) => {
      if (_gDead || _currentGroupId !== groupId || !_gLoaded) return;
      const r = p.new;
      if (!r || r.user_id === state.me?.uid || !r.last_read_at) return;
      const t = Date.parse(r.last_read_at) || 0;
      if (t <= _gReadMax) return;
      _gReadMax = t;
      paintGroupMessages(_gMsgs, _currentGroupData || groupData);
    })
    .subscribe(st => { if (st === 'SUBSCRIBED') sched(); });
  _groupThreadUnsub = () => {
    _gDead = true; clearTimeout(_gTimer); sb.removeChannel(gch);
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
  if (seq === _paintSeq && _currentGroupId && _gLoaded) chatUI.paintGroupThread(_gTicked(_gMsgs), _gNames());
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
    el.textContent = `${(_currentGroupData.members || []).length} ta a'zo`;
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
export async function sendGroupMessage() {
  if (!_currentGroupId || !state.me) return;
  if (isEditing()) { await commitEdit($('chatThreadInput')?.value); return; }
  const inp  = $('chatThreadInput');
  const userText = (inp?.value || '').trim();
  const postShare = chatUI.getPendingPostShare ? chatUI.getPendingPostShare() : null;

  if (!userText && !postShare) return;
  if (!rateOk('msg', 8, 10000)) return;

  inp.value = '';
  if (postShare && chatUI.clearPendingPostShare) {
    chatUI.clearPendingPostShare();
  } else {
    chatUI.updateVoiceSendBtn();
  }
  clearTimeout(_gTypTimer); _gSetTyping(false);

  const finalMsgText = postShare
    ? JSON.stringify({ __postShare: true, post: postShare, comment: userText })
    : userText;

  const previewText = postShare
    ? (userText ? `📌 ${userText}` : `📌 Post: ${postShare.authorName || 'Post'}`)
    : userText.slice(0, 120);

  const groupId = _currentGroupId;
  const groupData = _currentGroupData;
  const members   = groupData?.members || [];

  // Optimistik: o'z xabarimiz shu zahoti ekranda, baza orqada (xuddi shu ID bilan — dedup)
  const mid = _gUuid();
  const nowMs = Date.now();
  const localMsg = mapMessage({ id: mid, group_id: groupId, sender_id: state.me.uid, type: 'text', text: finalMsgText, created_at: new Date(nowMs).toISOString() });
  localMsg._at = nowMs;
  localMsg.status = 'sending';
  _gPending.set(mid, localMsg);
  _gMsgs = [..._gMsgs, localMsg];
  paintGroupMessages(_gMsgs, groupData);
  _gRt?.send(mid, finalMsgText);
  groupInboxSend(groupId, { gid: groupId, from: state.me.uid, id: mid, text: previewText.slice(0, 120), ts: nowMs });

  try {
    const { error } = await sb.from('group_messages')
      .insert({ id: mid, group_id: groupId, sender_id: state.me.uid, type: 'text', text: finalMsgText });
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
    inp.value = userText;
    if (postShare) chatUI.setPendingPostShare?.(postShare);
    chatUI.updateVoiceSendBtn();
    return;
  }
}

export async function sendGroupFile(file, caption = '') {
  if (!_currentGroupId || !state.me || !file) return;
  const groupId = _currentGroupId;
  const captionText = (typeof caption === 'string' ? caption : '').trim();
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
    });
    if (error) throw error;
    const previewText = fileMsgPreview({ caption: captionText, fileName: file.name });
    _gRt?.send({
      id, type: 'file', text: captionText || null,
      mediaPath: result.path, mediaType: file.type || null,
      fileName: file.name, fileSize: file.size,
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
  const mid = _gUuid();
  const nowMs = Date.now();
  const localUrl = URL.createObjectURL(blob);
  registerLocalVoiceUrl(mid, localUrl, voiceBarCount(duration));
  // Oddiy xabar kabi: darhol ro'yxatda (id bilan), repaint'da yo'qolmaydi, server xabari kelganda jimgina almashadi
  const localMsg = mapMessage({ id: mid, group_id: groupId, sender_id: state.me.uid, type: 'voice',
    media_type: blob.type || null, duration: Math.round(duration || 0), created_at: new Date(nowMs).toISOString() });
  localMsg.mediaUrl = localUrl;
  localMsg._at = nowMs + 120000;
  localMsg.status = 'sending';
  _gPending.set(mid, localMsg);
  _gMsgs = [..._gMsgs, localMsg];
  paintGroupMessages(_gMsgs, groupData);
  try {
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });
    const result = await uploadViaControllerProgress(file, 'chat-voice');
    const { error } = await sb.from('group_messages').insert({
      id: mid, group_id: groupId, sender_id: state.me.uid, type: 'voice',
      media_path: result.path, media_type: blob.type || null,
      duration: Math.round(duration || 0),
    });
    if (error) throw error;
    const conf = _gPending.get(mid);
    if (conf) {
      conf.status = 'sent';
      conf.mediaPath = result.path;
      conf.mediaUrl = result.url || conf.mediaUrl;
      conf._at = Date.now();
      _gPending.set(mid, conf);
    }
    _gRt?.send({
      id: mid, type: 'voice', mediaPath: result.path,
      mediaType: blob.type || null, duration: Math.round(duration || 0),
    });
    groupInboxSend(groupId, { gid: groupId, from: state.me.uid, id: mid, text: '🎤 Ovozli xabar', ts: Date.now() });
    _gMsgs = _gMsgs.map(m => m.id === mid ? { ...m, status: 'sent', mediaPath: result.path, mediaUrl: result.url || m.mediaUrl } : m);
    if (_currentGroupId === groupId) paintGroupMessages(_gMsgs, groupData);
    _reloadGroupThread && _reloadGroupThread();
  } catch (err) {
    console.error('[Groups] voice send failed:', err);
    _gPending.delete(mid);
    _gMsgs = _gMsgs.filter(x => x.id !== mid);
    if (_currentGroupId === groupId) paintGroupMessages(_gMsgs, groupData);
    try { URL.revokeObjectURL(localUrl); } catch (_) {}
    toast('Ovozli xabar yuborilmadi', 'error');
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
  if (lblEl) lblEl.textContent = "a'zo";

  /* ── Buttons ── */
  panel.querySelector('#grpInfoLeaveBtn').style.display      = isOwner ? 'none' : '';
  panel.querySelector('#grpInfoDeleteBtn').style.display     = isOwner ? '' : 'none';
  panel.querySelector('#grpInfoAddMemberBtn').style.display  = canManage ? '' : 'none';
  panel.querySelector('#grpInfoEditBtn').style.display       = canManage ? '' : 'none';

  /* ── Button handlers ── */
  panel.querySelector('#grpInfoLeaveBtn').onclick = () => {
    showConfirm(`${typeLabel}dan chiqmoqchimisiz?`, async () => {
      try {
        await _removeMember(groupId, state.me.uid);
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
      _profilesByIds(members)
        .then(pmap => {
          const html = members.map(uid => {
            const u = pmap[uid];
            if (!u) return '';
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
              ${(canManage && !isSelf && uid !== g.ownerId) ? `<button class="grp-member-kick" data-uid="${uid}" title="Chiqarish">
                <img src="./svg/action/close.svg" alt="" class="icon" width="14" height="14">
              </button>` : ''}
            </div>`;
          }).join('');
          membersEl.innerHTML = html || '<div class="gi-empty">A\'zolar topilmadi</div>';
          membersEl.querySelectorAll('.grp-member-kick').forEach(btn => {
            btn.onclick = () => {
              const uid = btn.dataset.uid;
              showConfirm('Bu foydalanuvchini chiqarasizmi?', async () => {
                try {
                  await _removeMember(groupId, uid);
                  toast("A'zo chiqarildi", 'success');
                  openGroupInfo(groupId);
                } catch(e) { toast('Xato yuz berdi', 'error'); }
              }, 'Chiqarish', 'Chiqarish');
            };
          });
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
      const { data: mrows, error: mErr } = await sb.from('group_messages').select('*')
        .eq('group_id', groupId).eq('type', 'file')
        .order('created_at', { ascending: false }).limit(60);
      if (mErr) throw mErr;
      const mediaMsgs = (mrows || [])
        .map(mapMessage)
        .filter(m => {
          const mime = (m.mediaType || '').toLowerCase();
          const ext  = (m.fileName || '').toLowerCase().split('.').pop();
          return mime.startsWith('image') ||
                 ['jpg','jpeg','png','gif','webp','avif','svg'].includes(ext);
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

let _editingGroupId = null;
let _grpEditPendingAviUrl = null;
let _editIsPublic = true;
let _editPendingInviteCode = null;

export function openGroupEdit(groupId, g) {
  const panel = document.getElementById('grpEditOverlay');
  if (!panel) return;

  _editingGroupId = groupId;
  _grpEditPendingAviUrl = null;
  _editIsPublic = !g.isPrivate;
  _editPendingInviteCode = g.inviteCode || generate64HexToken();

  const typeLabel = 'Guruh';
  panel.querySelector('#grpEditTitle').textContent = `${typeLabel}ni sozlash`;
  panel.querySelector('#grpEditNameLabel').textContent = `${typeLabel} nomi *`;
  panel.querySelector('#grpEditName').value = g.name || '';
  panel.querySelector('#grpEditDesc').value = g.description || '';

  const pubBtn = panel.querySelector('#grpEditPublicBtn');
  const privBtn = panel.querySelector('#grpEditPrivateBtn');
  const pubSec = panel.querySelector('#grpEditPublicSection');
  const privSec = panel.querySelector('#grpEditPrivateSection');
  const tokenEl = panel.querySelector('#grpEditInviteToken');
  const uInp = panel.querySelector('#grpEditUsername');
  if (uInp) uInp.value = g.username || '';

  const updateEditPrivacyUI = () => {
    if (_editIsPublic) {
      pubBtn?.classList.add('active');
      privBtn?.classList.remove('active');
      if (pubSec) pubSec.style.display = '';
      if (privSec) privSec.style.display = 'none';
    } else {
      privBtn?.classList.add('active');
      pubBtn?.classList.remove('active');
      if (pubSec) pubSec.style.display = 'none';
      if (privSec) privSec.style.display = '';
      if (tokenEl) tokenEl.textContent = `${window.location.origin}/chats/g/${_editPendingInviteCode}`;
    }
  };
  updateEditPrivacyUI();

  if (pubBtn) pubBtn.onclick = () => { _editIsPublic = true; updateEditPrivacyUI(); };
  if (privBtn) privBtn.onclick = () => { _editIsPublic = false; updateEditPrivacyUI(); };

  const copyBtn = panel.querySelector('#grpEditCopyInviteBtn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const link = `${window.location.origin}/chats/g/${_editPendingInviteCode}`;
      navigator.clipboard?.writeText(link);
      toast('Taklif havolasi nusxalandi', 'success');
    };
  }

  const regenBtn = panel.querySelector('#grpEditRegenInviteBtn');
  if (regenBtn) {
    regenBtn.onclick = () => {
      _editPendingInviteCode = generate64HexToken();
      if (tokenEl) tokenEl.textContent = `${window.location.origin}/chats/g/${_editPendingInviteCode}`;
      toast('Yangi 64-xonali taklif havolasi yaratildi', 'info');
    };
  }

  // Avatar preview
  const av = g.avatar || defAvi(g.name || 'G');
  const aviEl = panel.querySelector('#grpEditAviImg');
  aviEl.innerHTML = `<img src="${esc(av)}" onerror="this.style.display='none'">`;

  panel.querySelector('#grpEditGroupFields').style.display = '';
  panel.querySelector('#grpEditMsgPerm').value = g.msgPermission || 'all';

  // Avatar file input
  const aviBadge = panel.querySelector('#grpEditAviBadge');
  const aviInput = panel.querySelector('#grpEditAviInput');
  aviBadge.onclick = () => aviInput.click();
  aviInput.onchange = async ev => {
    const f = ev.target.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    if (f.size > 5*1024*1024) { toast('Rasm 5 MB dan kam bo\'lishi kerak', 'error'); return; }
    toast('Yuklanmoqda...', 'info');
    try {
      const result = await uploadViaController(f, 'group-avatars');
      _grpEditPendingAviUrl = result.url;
      aviEl.innerHTML = `<img src="${result.url}">`;
      toast('Rasm tanlandi (Saqlash tugmasini bosing)', 'success');
    } catch(e) { toast('Xato: ' + e.message, 'error'); }
  };

  // Save
  panel.querySelector('#grpEditSaveBtn').onclick = async () => {
    const name = panel.querySelector('#grpEditName').value.trim();
    if (!name) { toast('Nom kiritilishi shart', 'error'); return; }
    const desc = panel.querySelector('#grpEditDesc').value.trim();

    const updates = { name, description: desc };
    if (_grpEditPendingAviUrl) updates.avatar = _grpEditPendingAviUrl;
    updates.msg_permission = panel.querySelector('#grpEditMsgPerm').value;

    if (_editIsPublic) {
      const rawUser = panel.querySelector('#grpEditUsername')?.value?.trim();
      if (!rawUser) { toast('Ommaviy guruh uchun username kiriting', 'error'); return; }
      const avail = await checkGroupUsernameAvailable(rawUser, groupId);
      if (!avail.ok) { toast(avail.error || 'Bu nom allaqachon band', 'error'); return; }
      updates.is_private = false;
      updates.username = avail.username;
      updates.invite_code = null;
    } else {
      updates.is_private = true;
      updates.username = null;
      updates.invite_code = _editPendingInviteCode;
    }

    try {
      await _updateGroup(groupId, updates);
      panel.classList.remove('show');
      unlockScroll('grpEditOverlay');
      toast(`${typeLabel} yangilandi`, 'success');
      openGroupInfo(groupId);
    } catch(e) { toast('Xato: ' + e.message, 'error'); }
  };

  // Cancel
  panel.querySelector('#grpEditCancelBtn').onclick = () => {
    panel.classList.remove('show');
    unlockScroll('grpEditOverlay');
    openGroupInfo(groupId);
  };

  panel.classList.add('show');
  lockScroll('grpEditOverlay');
}

// Q: kanal turi yo'q — "+" to'g'ridan-to'g'ri guruh yaratish formasini ochadi
export function openCreateChoice() {
  openCreateForm('group');
}

let _createType    = 'group';
let _selectedMembers = new Set();
let _pendingPhotoUrl = null;
let _usersForPicker = [];
let _createIsPublic = true;
let _pendingInviteCode = null;

export function openCreateForm(type) {
  _createType      = type;
  _selectedMembers = new Set();
  _pendingPhotoUrl = null;
  _usersForPicker  = [];
  _createIsPublic  = true;
  _pendingInviteCode = generate64HexToken();

  const overlay = document.getElementById('grpCreateFormOverlay');
  if (!overlay) return;

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
  try {
    const rows = await fetchAllRows('profiles', '*', 'created_at');
    return rows.map(mapProfile).filter(u => u.uid !== state.me?.uid && isActiveUser(u));
  } catch(_) { return []; }
}

// Guruhga a'zo qo'shish: faqat mening kontaktlarim (contacts jadvali — suhbat ochilganda yoziladi)
async function _loadContactsForPicker() {
  try {
    const [{ data, error }, users] = await Promise.all([
      sb.from('contacts').select('contact_id').eq('owner_id', state.me.uid),
      _loadUsersForPicker(),
    ]);
    if (error) throw error;
    const ids = new Set((data || []).map(r => r.contact_id));
    return users.filter(u => ids.has(u.uid));
  } catch (_) { return []; }
}

function _renderMemberPicker(container, users) {
  if (!users.length) {
    container.innerHTML = `<div class="grp-empty-users">Kontaktlaringiz yo'q — avval foydalanuvchi bilan suhbat oching</div>`;
    return;
  }
  container.innerHTML = `
    <div class="grp-picker-search-wrap">
      <img src="./svg/extra/icon-34d2886eafb1.svg" alt="" class="icon" width="14" height="14">
      <input class="grp-picker-search" id="grpPickerSearch" placeholder="Ism yoki username..." autocomplete="off">
    </div>
    <div class="grp-picker-list" id="grpPickerList"></div>
    <div class="grp-sel-count" id="grpSelCount">0 ta tanlangan</div>
  `;
  _renderPickerRows(users, container.querySelector('#grpPickerList'));

  container.querySelector('#grpPickerSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = q ? users.filter(u =>
      (u.fullName||'').toLowerCase().includes(q) || (u.username||'').toLowerCase().includes(q)
    ) : users;
    _renderPickerRows(filtered, container.querySelector('#grpPickerList'));
  });
}

function _renderPickerRows(users, listEl) {
  if (!listEl) return;
  listEl.innerHTML = users.map(u => {
    const av   = u.avatar || defAvi(u.fullName || 'U');
    const sel  = _selectedMembers.has(u.uid);
    return `<div class="grp-picker-row ${sel ? 'selected' : ''}" data-uid="${u.uid}">
      <div class="grp-picker-avi"><img src="${esc(av)}" onerror="this.style.display='none'"></div>
      <div class="grp-picker-info">
        <div class="grp-picker-name">${esc(u.fullName||'Foydalanuvchi')}</div>
        ${u.username ? `<div class="grp-picker-user">@${esc(u.username)}</div>` : ''}
      </div>
      <div class="grp-picker-check ${sel ? 'on' : ''}">
        <img src="./svg/ui/check.svg" alt="" class="icon" width="11" height="11">
      </div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.grp-picker-row').forEach(row => {
    row.addEventListener('click', () => {
      const uid = row.dataset.uid;
      if (_selectedMembers.has(uid)) _selectedMembers.delete(uid);
      else _selectedMembers.add(uid);
      row.classList.toggle('selected');
      row.querySelector('.grp-picker-check').classList.toggle('on');
      const cnt = document.getElementById('grpSelCount');
      if (cnt) cnt.textContent = `${_selectedMembers.size} ta tanlangan`;
    });
  });
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

  const pickerSection = overlay.querySelector('#grpMemberPickerSection');
  pickerSection.innerHTML = '<div class="spin-wrap pt-20px"><div class="spinner"></div></div>';
  const users = await _loadContactsForPicker();
  const nonMembers = users.filter(u => !existingMembers.has(u.uid));
  _usersForPicker = nonMembers;
  _renderMemberPicker(pickerSection, nonMembers);

  overlay.classList.add('show');
}

/* ─────────────────────────────────────────────────────────────────────
   SUBMIT CREATE / ADD MEMBER
   ───────────────────────────────────────────────────────────────────── */
export async function submitCreateGroup() {
  const overlay  = document.getElementById('grpCreateFormOverlay');
  const addMode  = overlay?.dataset?.addMode;

  if (addMode) {
    // Add members to existing group
    if (!_selectedMembers.size) { toast('Kamida 1 ta a\'zo tanlang', 'error'); return; }
    try {
      await _addMembers(addMode, Array.from(_selectedMembers));
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
      msg_permission: overlay.querySelector('#grpFormMsgPerm')?.value === 'admins' ? 'admins' : 'all',
      owner_id:    state.me.uid,
      is_private:  !_createIsPublic,
      username:    groupUsername,
      invite_code: inviteCode,
    });
    if (gErr) throw gErr;
    // Egasi trigger orqali qo'shiladi; tanlangan a'zolarni qo'shamiz
    if (_selectedMembers.size) {
      try { await _addMembers(newId, Array.from(_selectedMembers)); }
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
          </div>
          <div class="grp-form-desc-hint">Faqat ushbu maxfiy havola orqali guruhga qo'shilish mumkin</div>
        </div>

        <!-- Tavsif + xabar yuborish huquqi (a'zo qo'shish rejimida yashiriladi) -->
        <div id="grpFormDescWrap">
          <textarea class="ta mb-12px" id="grpFormDesc" placeholder="Tavsif (ixtiyoriy)" rows="2" maxlength="300"></textarea>
          <select class="field mb-12px" id="grpFormMsgPerm">
            <option value="all">Xabar yuborish: barcha a'zolar</option>
            <option value="admins">Xabar yuborish: faqat adminlar (kanal kabi)</option>
          </select>
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
              <button type="button" class="grp-invite-regen-btn" id="grpEditRegenInviteBtn" title="Yangi havola yaratish" aria-label="Yangi havola yaratish"><img src="./svg/action/revoke.svg" alt="" class="icon" width="14" height="14"></button>
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
  document.getElementById('grpFormCancelBtn').onclick = () => {
    const ov = document.getElementById('grpCreateFormOverlay');
    ov.classList.remove('show');
    ov.dataset.addMode = '';
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
