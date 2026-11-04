import { smoothScrollIntoView } from '../core/utils.js';
import { sb, state, mapProfile } from '../core/config.js';
import { $, esc, defAvi } from '../core/utils.js';

function preview(m) {
  if (m.type === 'voice') return 'Ovozli xabar';
  if (m.type === 'file' || m.type === 'image') return m.text || 'Fayl';
  if ((m.text || '').includes('"__callLog"')) { try { return JSON.parse(m.text).s === 'ok' ? 'Kiruvchi qo‘ng‘iroq' : 'O‘tkazib yuborilgan qo‘ng‘iroq'; } catch (_) {} }
  return (m.text || '').trim() || 'Xabar';
}
function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('uz', { day: 'numeric', month: 'short' });
}
function setBadge(n) {
  ['hdrNotifBadge', 'sbNotifBadge'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.classList.remove('d-none'); }
    else { el.textContent = ''; el.classList.add('d-none'); }
  });
}
function seenKey(uid) { return `spacemr_notif_seen_${uid}`; }
function getSeenAt(uid) {
  try { return Number(localStorage.getItem(seenKey(uid)) || 0) || 0; } catch (_) { return 0; }
}
function setSeenAt(uid, value) {
  try { localStorage.setItem(seenKey(uid), String(Math.max(getSeenAt(uid), value || 0))); } catch (_) {}
}
async function names(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data, error } = await sb.from('profiles').select('id, full_name, username, avatar').in('id', uniq);
  if (error) console.warn('[notifs] profiles:', error.message);
  return new Map((data || []).map(r => [r.id, mapProfile(r)]));
}

export function paintNotifsSkeleton(box, n = 5) {
  if (!box) return;
  const row = () => `<div class="nf-row-skel" aria-hidden="true"><div class="skel-nf-avi skel-shimmer"></div><div class="skel-nf-main"><div class="skel-nf-top" style="display:flex;justify-content:space-between;align-items:center"><div class="skel-nf-name skel-shimmer"></div><div class="skel-nf-time skel-shimmer"></div></div><div class="skel-nf-text skel-shimmer"></div></div></div>`;
  box.innerHTML = Array.from({ length: n }, row).join('');
}

let _loadSeq = 0;
export async function loadNotifs({ silent = false } = {}) {
  const box = $('notifsList');
  const me = state.me?.uid;
  if (!box || !me) return;
  const seq = ++_loadSeq;
  if (!silent || !box.children.length) paintNotifsSkeleton(box, 5);

  const items = [];
  let unreadMessages = 0;
  try {
    const { data: msgs, error } = await sb.from('messages')
      .select('id, chat_id, sender_id, text, type, created_at, status')
      .neq('sender_id', me).neq('status', 'read')
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const unread = msgs || [];
    unreadMessages += unread.length;
    const chatIds = [...new Set(unread.map(m => m.chat_id))];
    let members = [];
    if (chatIds.length) {
      const { data, error: memberError } = await sb.from('chat_members').select('chat_id, user_id').in('chat_id', chatIds);
      if (memberError) throw memberError;
      members = data || [];
    }
    const other = {};
    members.forEach(m => { if (m.user_id !== me) other[m.chat_id] = m.user_id; });
    unread.forEach(m => items.push({ id: `dm:${m.id}`, kind: 'dm', ref: other[m.chat_id] || m.sender_id, who: m.sender_id, msgId: m.id, text: preview(m), ts: m.created_at }));
  } catch (e) { console.warn('[notifs] dm:', e?.message || e); }

  try {
    const { data: mine, error } = await sb.from('group_members').select('group_id, unread_count').eq('user_id', me).gt('unread_count', 0);
    if (error) throw error;
    const gids = (mine || []).map(r => r.group_id);
    const cap = Object.fromEntries((mine || []).map(r => [r.group_id, r.unread_count || 0]));
    unreadMessages += Object.values(cap).reduce((a, b) => a + b, 0);
    if (gids.length) {
      const { data: gm, error: gmError } = await sb.from('group_messages').select('id, group_id, sender_id, text, type, created_at')
        .in('group_id', gids).neq('sender_id', me).order('created_at', { ascending: false }).limit(100);
      if (gmError) throw gmError;
      const used = {};
      (gm || []).forEach(m => {
        used[m.group_id] = used[m.group_id] || 0;
        if (used[m.group_id] >= (cap[m.group_id] || 0)) return;
        used[m.group_id] += 1;
        items.push({ id: `group:${m.id}`, kind: 'group', ref: m.group_id, who: m.sender_id, msgId: m.id, text: preview(m), ts: m.created_at });
      });
    }
  } catch (e) { console.warn('[notifs] group:', e?.message || e); }

  // Social activity: mavjud posts/comments/post_likes jadvallaridan olinadi — yangi SQL jadval talab qilmaydi.
  let socialUnread = 0;
  try {
    const { data: ownPosts, error: postError } = await sb.from('posts').select('id').eq('user_id', me).order('created_at', { ascending: false }).limit(120);
    if (postError) throw postError;
    const postIds = (ownPosts || []).map(p => p.id);
    if (postIds.length) {
      const [commentsRes, likesRes] = await Promise.all([
        sb.from('comments').select('id, post_id, user_id, user_name, text, created_at').in('post_id', postIds).neq('user_id', me).order('created_at', { ascending: false }).limit(100),
        sb.from('post_likes').select('post_id, user_id, created_at').in('post_id', postIds).neq('user_id', me).order('created_at', { ascending: false }).limit(100),
      ]);
      if (commentsRes.error) throw commentsRes.error;
      if (likesRes.error) throw likesRes.error;
      (commentsRes.data || []).forEach(c => items.push({
        id: `comment:${c.id}`, kind: 'comment', ref: c.post_id, who: c.user_id, msgId: c.id,
        text: `izoh qoldirdi: ${String(c.text || '').slice(0, 110)}`, ts: c.created_at,
      }));
      (likesRes.data || []).forEach(l => items.push({
        id: `like:${l.post_id}:${l.user_id}:${l.created_at}`, kind: 'like', ref: l.post_id, who: l.user_id,
        text: 'postingizga yoqdi', ts: l.created_at,
      }));
    }
  } catch (e) { console.warn('[notifs] social:', e?.message || e); }

  if (seq !== _loadSeq) return;
  items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const seenAt = getSeenAt(me);
  socialUnread = items.filter(i => (i.kind === 'like' || i.kind === 'comment') && new Date(i.ts).getTime() > seenAt).length;
  setBadge(unreadMessages + socialUnread);
  if (!items.length) {
    box.innerHTML = '<div class="empty pt-20vh tac"><div class="fs-15px c-text2">Hozircha bildirishnoma yo‘q</div></div>';
    return;
  }

  const people = await names(items.map(i => i.who));
  if (seq !== _loadSeq) return;
  const gids = [...new Set(items.filter(i => i.kind === 'group').map(i => i.ref))];
  let groups = new Map();
  if (gids.length) {
    const { data, error } = await sb.from('groups').select('id, name').in('id', gids);
    if (error) console.warn('[notifs] group names:', error.message);
    groups = new Map((data || []).map(g => [g.id, g.name]));
  }
  box.innerHTML = items.map(i => {
    const person = people.get(i.who);
    const name = i.kind === 'group' ? (groups.get(i.ref) || 'Guruh') : (person?.fullName || (person?.username ? '@' + person.username : 'Foydalanuvchi'));
    const sub = i.kind === 'group' ? (person?.fullName || person?.username || '') : '';
    const avatar = person?.avatar || defAvi(name);
    const activity = i.kind === 'like' || i.kind === 'comment';
    const isNew = activity && new Date(i.ts).getTime() > seenAt;
    const icon = i.kind === 'like' ? '♥' : i.kind === 'comment' ? '✎' : '';
    return `<button type="button" class="nf-row${isNew ? ' nf-unread' : ''}" data-kind="${i.kind}" data-ref="${esc(i.ref)}" data-mid="${esc(i.msgId || '')}" data-ts="${esc(new Date(i.ts).getTime())}">
      <span class="nf-avatar-wrap"><img class="nf-avi" src="${esc(avatar)}" alt="">${icon ? `<span class="nf-activity-icon ${i.kind}">${icon}</span>` : ''}</span>
      <span class="nf-main"><span class="nf-name">${esc(name)}</span><span class="nf-text">${sub ? esc(sub) + ': ' : ''}${esc(i.text)}</span></span>
      <span class="nf-time">${esc(when(i.ts))}</span>
      ${isNew ? '<span class="nf-unread-dot" aria-label="Yangi"></span>' : ''}
    </button>`;
  }).join('');

  // Sahifa ochiq paytda ko‘rilgan activity shu qurilmada o‘qilgan deb belgilanadi.
  // Serverda notification jadvali yo‘qligi sababli bu marker qurilmalar orasida sinxronlanmaydi.
  const newestSocial = items.filter(i => i.kind === 'like' || i.kind === 'comment').reduce((max, i) => Math.max(max, new Date(i.ts).getTime() || 0), seenAt);
  if (state.view === 'notifs' && newestSocial > seenAt) {
    setSeenAt(me, newestSocial);
    setBadge(unreadMessages);
  }
}

async function openItem(kind, ref, msgId) {
  if (kind === 'like' || kind === 'comment') {
    const { openPostLink } = await import('../feed/feed.js');
    await openPostLink(ref, kind === 'comment' ? msgId : null, { comments: kind === 'comment' });
    return;
  }
  const { navigateTo } = await import('../router.js');
  navigateTo('chats');
  if (kind === 'group') {
    const g = await import('../chat/groups.js');
    await g.openGroupThread(ref);
  } else {
    const c = await import('../chat/chat.js');
    await c.openChatThread(ref);
  }
  const q = CSS.escape(String(msgId));
  let n = 0;
  const tick = () => {
    const el = document.querySelector(`.chat-msg[data-msg-id="${q}"]`);
    if (el) { smoothScrollIntoView(el, { block: 'center' }); return; }
    if (n++ < 15) setTimeout(tick, 200);
  };
  setTimeout(tick, 250);
}

let _wired = false;
export function initNotifs() {
  if (_wired) return;
  _wired = true;
  document.getElementById('notifsList')?.addEventListener('click', e => {
    const row = e.target.closest('.nf-row');
    if (!row) return;
    openItem(row.dataset.kind, row.dataset.ref, row.dataset.mid);
  });
}
initNotifs();
