/**
 * Bildirishnomalar: o'qilmagan xabarlar ro'yxati.
 * Bosilsa chat ochiladi va o'sha xabarga scroll qilinadi (glow yo'q).
 */
import { sb, state, mapProfile } from '../core/config.js';
import { $, esc, defAvi } from '../core/utils.js';

function preview(m) {
  if (m.type === 'voice') return 'Ovozli xabar';
  if (m.type === 'file' || m.type === 'image') return m.text || 'Fayl';
  return (m.text || '').trim() || 'Xabar';
}
function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('uz', { day: 'numeric', month: 'short' });
}
function setBadge(n) {
  ['hdrNotifBadge', 'sbNotifBadge'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.classList.remove('d-none'); }
    else { el.textContent = ''; el.classList.add('d-none'); }
  });
}

async function names(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data } = await sb.from('profiles').select('id, full_name, username, avatar').in('id', uniq);
  return new Map((data || []).map(r => [r.id, mapProfile(r)]));
}

export async function loadNotifs() {
  const box = $('notifsList');
  const me = state.me?.uid;
  if (!box || !me) return;
  box.innerHTML = '<div class="spin-wrap pt-40px"><div class="spinner"></div></div>';
  const items = [];
  try {
    const { data: msgs } = await sb.from('messages')
      .select('id, chat_id, sender_id, text, type, created_at, status')
      .neq('sender_id', me)
      .order('created_at', { ascending: false })
      .limit(80);
    const unread = (msgs || []).filter(m => m.status !== 'read');
    const chatIds = [...new Set(unread.map(m => m.chat_id))];
    let members = [];
    if (chatIds.length) {
      const { data } = await sb.from('chat_members').select('chat_id, user_id').in('chat_id', chatIds);
      members = data || [];
    }
    const other = {};
    members.forEach(m => { if (m.user_id !== me) other[m.chat_id] = m.user_id; });
    unread.forEach(m => items.push({
      kind: 'dm', ref: other[m.chat_id] || m.sender_id, who: m.sender_id,
      msgId: m.id, text: preview(m), ts: m.created_at,
    }));
  } catch (e) { console.warn('[notifs] dm', e?.message || e); }

  try {
    const { data: mine } = await sb.from('group_members').select('group_id, unread_count').eq('user_id', me).gt('unread_count', 0);
    const gids = (mine || []).map(r => r.group_id);
    const cap = Object.fromEntries((mine || []).map(r => [r.group_id, r.unread_count || 0]));
    if (gids.length) {
      const { data: gm } = await sb.from('group_messages')
        .select('id, group_id, sender_id, text, type, created_at')
        .in('group_id', gids).neq('sender_id', me)
        .order('created_at', { ascending: false }).limit(80);
      const used = {};
      (gm || []).forEach(m => {
        used[m.group_id] = used[m.group_id] || 0;
        if (used[m.group_id] >= (cap[m.group_id] || 0)) return;
        used[m.group_id] += 1;
        items.push({ kind: 'group', ref: m.group_id, who: m.sender_id, msgId: m.id, text: preview(m), ts: m.created_at });
      });
    }
  } catch (e) { console.warn('[notifs] group', e?.message || e); }

  items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  setBadge(items.length);
  if (!items.length) {
    box.innerHTML = '<div class="empty pt-20vh tac"><div class="fs-15px c-text2">O\'qilmagan xabar yo\'q</div></div>';
    return;
  }
  const people = await names(items.map(i => i.who));
  let groups = new Map();
  const gids = items.filter(i => i.kind === 'group').map(i => i.ref);
  if (gids.length) {
    const { data } = await sb.from('groups').select('id, name').in('id', [...new Set(gids)]);
    groups = new Map((data || []).map(g => [g.id, g.name]));
  }
  box.innerHTML = items.map(i => {
    const p = people.get(i.who);
    const name = i.kind === 'group'
      ? (groups.get(i.ref) || 'Guruh')
      : (p?.fullName || (p?.username ? '@' + p.username : 'Foydalanuvchi'));
    const sub = i.kind === 'group' ? (p?.fullName || p?.username || '') : '';
    const avi = p?.avatar || defAvi(name);
    return `<button type="button" class="nf-row" data-kind="${i.kind}" data-ref="${esc(i.ref)}" data-mid="${esc(i.msgId)}">
      <img class="nf-avi" src="${esc(avi)}" alt="">
      <span class="nf-main">
        <span class="nf-name">${esc(name)}</span>
        <span class="nf-text">${sub ? esc(sub) + ': ' : ''}${esc(i.text)}</span>
      </span>
      <span class="nf-time">${esc(when(i.ts))}</span>
    </button>`;
  }).join('');
}

async function openItem(kind, ref, msgId) {
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
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (n++ < 15) setTimeout(tick, 200);
  };
  setTimeout(tick, 250);
}

let _wired = false;
export function initNotifs() {
  if (_wired) return;
  _wired = true;
  document.getElementById('notifsList')?.addEventListener('click', (e) => {
    const row = e.target.closest('.nf-row');
    if (!row) return;
    openItem(row.dataset.kind, row.dataset.ref, row.dataset.mid);
  });
  window.addEventListener('spacemr:route', () => {
    if (state.view === 'notifs') loadNotifs();
  });
}
initNotifs();
