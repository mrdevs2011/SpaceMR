import { sendChatMessage, sendVoiceMessage, sendChatFile, handleSendAction } from './chat-actions.js';
export { sendChatMessage, handleSendAction };
import { chatState, chatUI } from './chat-state.js';
/* ── Onlayn holat (presence) uchun CSS ────────────────────────────────── */
function _injectPresenceCSS() { /* CSS: mono-x.css .presence-dot */ }

/* ── Search, Pins & Context Menu for Chats ──────────────────────────── */
/* ── Timing konstantalari ───────────────────────────────────────────────── */
const DEBOUNCE_MS        = 450;  // input debounce (qidiruv, yozmoqda)
const TYPING_HIDE_MS     = 2500; // yozishni to'xtatgandan keyin "yozyapti" belgisi yo'qolish vaqti
const PEER_TYPING_MAX_MS = 5000; // peer typing timeout
const READ_FLUSH_MS      = 180;  // o'qilganlarni DB ga yozish debounce
const PEER_STATUS_MS     = 20_000; // peer online statusini qayta chizish intervali
const SCROLL_SETTLE_MS   = 60;   // xabar yuborilgandan keyin scroll pastga
const KB_ADAPT_1_MS      = 120;  // klaviatura chiqishi: 1-adapt tick
const KB_ADAPT_2_MS      = 280;  // klaviatura chiqishi: 2-adapt tick (keyboard to'liq ochilgach)
const KB_SCROLL_MS       = 300;  // klaviatura ochilgandan keyin scroll pastga
const KB_BLUR_MS         = 100;  // klaviatura yopilgandan keyin layout tiklash
const LONGPRESS_GUARD_MS = 300;  // long-press tugagandan keyin touchend guard vaqti



/* ── Pins / recent / deleted — modules/chat-storage.js ────────────────── */
// _getPins, _isPinned, _togglePin, _getRecents, ... import orqali (pastga qarang)

function _deleteChatForMe(uid) {
  if (!state.me?.uid || !uid) return;
  markChatDeletedLocal(uid);
  delete chatState._latestChatMap[uid];
  const pins = _getPins();
  if (pins.dms.includes(uid)) _togglePin('dm', uid);
  sb.from('contacts').delete().eq('owner_id', state.me.uid).eq('contact_id', uid).then(() => {}, () => {});
}

function _isChatDeleted(uid) {
  const t = getChatDeletedAt(uid);
  if (!t) return false;
  const c = chatState._latestChatMap[uid];
  if (c?.lastMessageAt && c.lastMessageAt > t) {
    clearChatDeletedLocal(uid);
    return false;
  }
  return true;
}

function _shouldShowInChatsList(u, chatMap) {
  if (!u || !u.uid) return false;
  if (_isChatDeleted(u.uid)) return false;
  if (_isPinned('dm', u.uid)) return true;
  if (u.username === 'admin') return true;
  const c = chatMap[u.uid];
  if (c && (c.lastMessage || c.lastMessageAt || c.lastMessageId)) return true;
  return false;
}

function _injectSearchCSS() { /* CSS: mono-x.css .ulist-search-* / .chat-ctx-* */ }

function _renderRecentSearches() {
  const existing = document.getElementById('chatRecentSearchesWrap');
  if (existing) existing.remove();

  const recents = _getRecents();
  if (!recents.length) return;

  const wrap = document.createElement('div');
  wrap.id = 'chatRecentSearchesWrap';
  wrap.className = 'chat-recents-wrap';
  wrap.innerHTML = `
    <div class="chat-recents-hdr">
      <span>So'nggi qidiruvlar</span>
      <button type="button" class="chat-recents-clear-all" id="chatRecentsClearAll">Barchasini tozalash</button>
    </div>
    <div class="chat-recents-list">
      ${recents.map(item => {
        const av = item.avatar || defAvi(item.name || 'U');
        const sub = item.type === 'group' ? 'Guruh' : (item.username ? '@' + item.username : '');
        return `
          <div class="chat-recent-item" data-id="${esc(item.id)}" data-type="${esc(item.type)}">
            <div class="chat-recent-avi"><img src="${esc(av)}" onerror="this.style.display='none'"></div>
            <div class="chat-recent-info">
              <div class="chat-recent-name">${esc(item.name || 'Foydalanuvchi')}</div>
              ${sub ? `<div class="chat-recent-sub">${esc(sub)}</div>` : ''}
            </div>
            <button type="button" class="chat-recent-del" title="O'chirish" data-del="${esc(item.id)}">
              <img src="./svg/action/close.svg" alt="" class="icon" width="14" height="14">
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const box = document.getElementById('chatSearchBoxWrap');
  if (box) {
    // Wrap ichiga qo'shamiz — position:absolute to'g'ri ishlashi uchun
    box.appendChild(wrap);
  }

  wrap.querySelector('#chatRecentsClearAll')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _clearAllRecents();
    wrap.remove();
  });

  wrap.querySelectorAll('.chat-recent-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      _removeRecent(id);
      const row = btn.closest('.chat-recent-item');
      row?.remove();
      if (!wrap.querySelector('.chat-recent-item')) {
        wrap.remove();
      }
    });
  });

  wrap.querySelectorAll('.chat-recent-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const type = item.dataset.type;
      wrap.remove();
      if (type === 'group') {
        openGroupThread(id);
      } else {
        openChatThread(id);
      }
    });
  });
}

function _renderSearchBox(container) {
  _injectSearchCSS();
  const existingBox = document.getElementById('chatSearchBoxWrap');
  if (existingBox) return; // already injected
  const wrap = document.createElement('div');
  wrap.id = 'chatSearchBoxWrap';
  wrap.innerHTML = `
    <div class="ulist-search-wrap">
      <div class="ulist-search-icon" id="chatSearchBtn" title="Qidirish">
        <img src="./svg/extra/icon-34d2886eafb1.svg" alt="" class="icon" width="16" height="16">
      </div>
      <input class="ulist-search-input" id="chatSearchInput" placeholder="Qidirish (ism yoki username)..." autocomplete="off" spellcheck="false">
      <button type="button" class="ulist-search-clear d-none" id="chatSearchClear" aria-label="Tozalash">
        <img src="./svg/action/close.svg" alt="" class="icon" width="15" height="15">
      </button>
    </div>

    <div class="ulist-search-result d-none" id="chatSearchResult"></div>
  `;
  container.insertBefore(wrap, container.firstChild);

  const inp = document.getElementById('chatSearchInput');
  const btn = document.getElementById('chatSearchBtn');
  const clearBtn = document.getElementById('chatSearchClear');
  const res = document.getElementById('chatSearchResult');

  function updateClearBtn() {
    if (clearBtn) {
      clearBtn.classList.toggle('d-none', !inp.value);
    }
  }

  async function doSearch() {
    const raw = inp.value.trim();
    updateClearBtn();
    document.getElementById('chatRecentSearchesWrap')?.remove();
    if (!raw) {
      chatState._searchQuery = '';
      if (res) res.classList.add('d-none');
      paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
      return;
    }
    chatState._searchQuery = raw;

    if (!chatState._usersCache) {
      try { chatState._usersCache = await _fetchChatUsers(); } catch (_) {}
    }

    const term = (raw.startsWith('@') ? raw.slice(1) : raw).toLowerCase();
    const matchedUsers = (chatState._usersCache || []).filter(u =>
      (u.username || '').toLowerCase().includes(term) ||
      (u.fullName || '').toLowerCase().includes(term)
    );
    let matchedGroups = getGroupRows().filter(g =>
      (g.name || '').toLowerCase().includes(term) ||
      (g.username || '').toLowerCase().includes(term)
    );
    if (term) {
      try {
        const extra = await searchGroups(term);
        if (extra && extra.length) {
          const map = new Map(matchedGroups.map(g => [g.id, g]));
          extra.forEach(g => map.set(g.id, g));
          matchedGroups = Array.from(map.values());
        }
      } catch (_) {}
    }
    const totalMatches = matchedUsers.length + matchedGroups.length;

    if (res) {
      if (totalMatches > 0) {
        res.textContent = `${totalMatches} ta natija topildi`;
        res.className = 'ulist-search-result';
        res.classList.remove('d-none');
      } else {
        res.textContent = `"${raw}" — topilmadi`;
        res.className = 'ulist-search-result not-found';
        res.classList.remove('d-none');
      }
    }
    paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
  }

  let debounceTimer = null;
  inp.addEventListener('input', () => {
    updateClearBtn();
    document.getElementById('chatRecentSearchesWrap')?.remove();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      doSearch();
    }, 120);
  });

  inp.addEventListener('focus', () => {
    if (!inp.value.trim()) {
      _renderRecentSearches();
    }
  });

  inp.addEventListener('click', () => {
    if (!inp.value.trim()) {
      _renderRecentSearches();
    }
  });

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      doSearch();
    }
  });

  btn.addEventListener('click', () => {
    clearTimeout(debounceTimer);
    doSearch();
  });

  clearBtn?.addEventListener('click', () => {
    inp.value = '';
    clearTimeout(debounceTimer);
    doSearch();
    inp.focus();
    _renderRecentSearches();
  });

  document.addEventListener('click', (e) => {
    const recWrap = document.getElementById('chatRecentSearchesWrap');
    if (recWrap && !recWrap.contains(e.target) && e.target !== inp) {
      recWrap.remove();
    }
  });
}

/* ── Context Menu (Long press / right-click on chat row) ─────────────── */
function _attachChatRowContextMenu(row) {
  let timer = null;
  let started = false;
  let startX = 0, startY = 0;

  const trigger = (e) => {
    timer = null;
    started = true;
    _openChatContextMenu(row);
  };

  row.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) return;
    started = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    timer = setTimeout(() => trigger(e), DEBOUNCE_MS);
  }, { passive: true });

  row.addEventListener('touchmove', (e) => {
    if (!timer) return;
    const dx = Math.abs(e.touches[0].clientX - startX);
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dx > 8 || dy > 8) {
      clearTimeout(timer);
      timer = null;
    }
  }, { passive: true });

  row.addEventListener('touchend', (e) => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (started) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => { started = false; }, LONGPRESS_GUARD_MS);
    }
  });

  row.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    started = false;
    timer = setTimeout(() => trigger(e), DEBOUNCE_MS);
  });

  row.addEventListener('mouseup', () => {
    if (timer) { clearTimeout(timer); timer = null; }
  });

  row.addEventListener('mouseleave', () => {
    if (timer) { clearTimeout(timer); timer = null; }
  });

  row.addEventListener('click', (e) => {
    if (started) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      started = false;
    }
  }, true);

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    trigger(e);
  });
}

function _openChatContextMenu(row) {
  document.getElementById('chatCtxOverlay')?.remove();

  const isGroup = !!row.dataset.gid;
  const id = isGroup ? row.dataset.gid : row.dataset.uid;
  const isPinned = _isPinned(isGroup ? 'group' : 'dm', id);

  let title = 'Suhbat';
  if (isGroup) {
    const g = getGroupRows().find(x => x.id === id);
    title = g?.name || 'Guruh';
  } else {
    const u = (chatState._usersCache || []).find(x => x.uid === id);
    title = u?.fullName || (u?.username ? '@' + u.username : 'Foydalanuvchi');
  }

  const overlay = document.createElement('div');
  overlay.id = 'chatCtxOverlay';
  overlay.className = 'chat-ctx-overlay';
  overlay.innerHTML = `
    <div class="chat-ctx-menu">
      <button type="button" class="chat-ctx-item" id="chatCtxPin">
        ${isPinned
          ? '<img src="./svg/action/pin-filled.svg" alt="" class="icon" width="16" height="16">'
          : '<img src="./svg/action/pin.svg" alt="" class="icon" width="16" height="16">'}
        <span>${isPinned ? "Qadashni bekor qilish" : (isGroup ? "Guruhni qadash" : "Suhbatni qadash")}</span>
      </button>
      ${isGroup ? `
        <button type="button" class="chat-ctx-item danger" id="chatCtxLeave">
          <img src="./svg/action/logout.svg" alt="" class="icon" width="16" height="16">
          <span>Guruhdan chiqish</span>
        </button>
      ` : `
        <button type="button" class="chat-ctx-item danger" id="chatCtxDelete">
          <img src="./svg/extra/icon-938ddddb771c.svg" alt="" class="icon" width="16" height="16">
          <span>Suhbatni o'chirish</span>
        </button>
      `}
    </div>
  `;

  document.body.appendChild(overlay);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  const close = () => {
    window.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector('#chatCtxPin')?.addEventListener('click', () => {
    close();
    const nowPinned = _togglePin(isGroup ? 'group' : 'dm', id);
    toast(nowPinned ? "Qadandi" : "Qadash bekor qilindi", "success");
    paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
  });

  overlay.querySelector('#chatCtxDelete')?.addEventListener('click', () => {
    close();
    if (!confirm("Ushbu suhbatni o'chirmoqchimisiz?")) return;
    _deleteChatForMe(id);
    toast("Suhbat o'chirildi", "info");
    paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
  });

  overlay.querySelector('#chatCtxLeave')?.addEventListener('click', async () => {
    close();
    if (!confirm("Guruhdan chiqmoqchimisiz?")) return;
    try {
      await leaveGroup(id);
      toast("Guruhdan chiqdingiz", "info");
      paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
    } catch { toast("Xatolik yuz berdi", "error"); }
  });
}

/* ── Header 3-dots Dropdown Menu (DM & Group) ────────────────────────── */
export function initChatHeaderMenu() {
  const btn = $('chatHeaderMenuBtn');
  if (!btn || btn._wired) return;
  btn._wired = true;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.getElementById('chatHeaderDropdown');
    if (existing) { existing.remove(); return; }

    const isGroup = state.currentChatKind === 'group' || !!getCurrentGroupId() || !!document.getElementById('chatThreadModal')?.dataset?.gid;
    const drop = document.createElement('div');
    drop.id = 'chatHeaderDropdown';
    drop.className = 'chat-header-dropdown';

    if (isGroup) {
      drop.innerHTML = `
        <button type="button" class="chat-header-dropdown-item danger" id="chmLeaveGroup">
          <img src="./svg/action/logout.svg" alt="" class="icon" width="16" height="16">
          <span>Guruhdan chiqish</span>
        </button>
      `;
    } else {
      drop.innerHTML = `
        <button type="button" class="chat-header-dropdown-item danger" id="chmDeleteChat">
          <img src="./svg/extra/icon-938ddddb771c.svg" alt="" class="icon" width="16" height="16">
          <span>Suhbatdan chiqish</span>
        </button>
      `;
    }

    const hdr = document.querySelector('.chat-thread-hdr');
    if (hdr) hdr.appendChild(drop);

    drop.querySelector('#chmLeaveGroup')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      drop.remove();
      const gid = getCurrentGroupId() || document.getElementById('chatThreadModal')?.dataset?.gid;
      if (!gid) return;
      if (!confirm("Guruhdan chiqmoqchimisiz?")) return;
      try {
        await leaveGroup(gid);
        $('chatThreadModal')?.classList.remove('show');
        closeGroupThread();
        toast("Guruhdan chiqdingiz", "info");
        if (state.view === 'chats') renderChatsList();
      } catch { toast("Xatolik yuz berdi", "error"); }
    });

    drop.querySelector('#chmDeleteChat')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      drop.remove();
      const uid = state.currentChatUid;
      if (!uid) return;
      if (!confirm("Suhbatdan chiqmoqchimisiz?")) return;
      _deleteChatForMe(uid);
      closeChatThread();
      toast("Suhbatdan chiqildi", "info");
      if (state.view === 'chats') renderChatsList();
    });
  });

  document.addEventListener('click', (e) => {
    const drop = document.getElementById('chatHeaderDropdown');
    if (drop && !drop.contains(e.target) && e.target !== btn) {
      drop.remove();
    }
  });
}
window._initChatHeaderMenu = initChatHeaderMenu;

/* ── Spinner (qidiruv yuklanishi) ─────────────────────────────────────── */
function _paintSearchSpinner() {
  const root = $('chatsListWrap');
  if (!root) return;
  let rowsWrap = document.getElementById('chatRowsWrap');
  if (!rowsWrap) {
    rowsWrap = document.createElement('div');
    rowsWrap.id = 'chatRowsWrap';
    root.appendChild(rowsWrap);
  }
  rowsWrap.innerHTML = '<div class="spin-wrap"><div class="spinner"></div></div>';
}

/* ── Paint only user rows (for search results / contacts) ────────────── */
function _paintUserRows(users, animate = false) {
  const root = $('chatsListWrap');
  if (!root) return;

  // Spinner yoki bo'sh placeholder ni o'chiramiz
  root.querySelectorAll('.spin-wrap, .empty').forEach(el => el.remove());

  let rowsWrap = document.getElementById('chatRowsWrap');
  if (!rowsWrap) {
    rowsWrap = document.createElement('div');
    rowsWrap.id = 'chatRowsWrap';
    root.appendChild(rowsWrap);
  }
  const chatMap = chatState._latestChatMap;
  if (!users.length) {
    if (!chatState._searchQuery.trim() && !getGroupRows().length) {
      rowsWrap.innerHTML = '<div class="empty tac" style="padding: 40px 16px;"><div class="fs-13px c-text2">Yangi suhbat boshlash uchun yuqoridagi qidiruvdan foydalaning</div></div>';
    } else {
      rowsWrap.innerHTML = '';
    }
    return;
  }
  const rows = users.map(u => ({ u, c: chatMap[u.uid] || null, pinned: _isPinned('dm', u.uid) }));
  rows.sort((a, b) => {
    // 1. Pinned users first
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    // 2. Latest message first
    const ta = a.c?.lastMessageAt || 0;
    const tb = b.c?.lastMessageAt || 0;
    if (ta !== tb) return tb - ta;
    // 3. Alphabetical
    return (a.u.fullName || '').localeCompare(b.u.fullName || '');
  });
  const html = rows.map(({ u, c, pinned }, idx) => {
    const av = u.avatar || defAvi(u.fullName || 'U');
    const isContact = chatState._myContacts.has(u.uid);
    const online = isUidOnline(u.uid, isOnline(u.lastSeenAt));
    const isAdminUser = u.username === 'admin';
    const rawPreview = c?.lastMessage || '';
    const formattedLastMsg = formatLastMessageText(rawPreview, c?.lastSenderId === state.me?.uid);
    const preview = (c && rawPreview)
      ? `${c.lastSenderId === state.me.uid ? 'You: ' : ''}${esc(formattedLastMsg.slice(0, 46))}`
      : isAdminUser ? "Admin bilan bog'lanish" : isContact ? 'Kontakt' : 'Yangi suhbat boshlash';
    const time   = (c?.lastMessageAt && rawPreview) ? fmt(c.lastMessageAt) : '';
    const unread = c?.unreadCount?.[state.me.uid] || 0;
    const badgeTxt = unread > 99 ? '+99' : '+' + unread;
    const pinHtml = pinned ? `<span class="chat-row-pin-ico" title="Qadalgan"><img src="./svg/extra/icon-dc035561d9ad.svg" alt="" class="icon" width="12" height="12"></span>` : '';
    const animStyle = '';
    return `<div class="chat-row${unread ? ' unread' : ''}${animate ? ' chat-row-anim' : ''}" data-uid="${u.uid}" ${animStyle}>
      <div class="chat-avi">
        <img src="${esc(av)}" onerror="this.style.display='none'">
        ${online ? '<span class="presence-dot" title="onlayn"></span>' : ''}
      </div>
      <div class="chat-row-body">
        <div class="chat-row-name">${esc(u.fullName || (u.username ? '@' + u.username : 'Foydalanuvchi'))}${u.username && u.fullName ? ` <span style="font-size:12px;font-weight:400;color:var(--text3)">@${esc(u.username)}</span>` : ''}</div>
        <div class="chat-row-preview${c ? '' : ' chat-row-empty'}">${preview}</div>
      </div>
      <div class="chat-row-right">
        ${pinHtml}
        ${time ? `<div class="chat-row-time">${time}</div>` : ''}
        ${unread ? `<div class="chat-row-badge">${badgeTxt}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  rowsWrap.innerHTML = html;
  _injectPresenceCSS();
  rowsWrap.querySelectorAll('.chat-row').forEach(row => {
    _attachChatRowContextMenu(row);
    row.addEventListener('click', () => {
      const uid = row.dataset.uid;
      const u = users.find(x => x.uid === uid);
      if (u) {
        _saveRecent({ type: 'user', id: u.uid, name: u.fullName || u.username, username: u.username, avatar: u.avatar });
      }
      openChatThread(uid);
    });
  });
}

/**
 * MRdatabase — Suhbatlar (1-on-1 DM)
 * Suhbatlar ro'yxati: barcha ro'yxatdan o'tgan userlar
 * Chat thread: real vaqtli xabarlashish (Firestore onSnapshot)
 *
 * Firestore schema:
 *   chats/{chatId} {
 *     participants:[uidA,uidB], lastMessage, lastSenderId, lastMessageAt,
 *     unreadCount: { [uid]: number }   // har bir ishtirokchi uchun alohida hisob
 *   }
 *   chats/{chatId}/messages/{msgId} {
 *     senderId, text, createdAt,
 *     status: 'sent' | 'read',         // 1 ptichka / 2 ptichka uchun
 *     readAt                           // o'qilgan vaqt (status='read' bo'lganda)
 *   }
 *   chatId = [uidA, uidB] tartiblanib '_' bilan birlashtiriladi (har doim bitta xat ID)
 *
 * NOT: agar real qurilmada ptichkalar 1dan 2ga o'tmasa — Firestore Security
 * Rules'ni tekshiring. messages/{msgId} hujjatini OLDIN faqat senderId yozgan,
 * endi esa qabul qiluvchi (boshqa ishtirokchi) ham shu hujjatni "status: read"
 * qilib yangilashi kerak — demak update qoidasi faqat
 * `senderId == request.auth.uid` bilan emas, balki ikkala ishtirokchiga ham
 * ruxsat berishi kerak (masalan: request.auth.uid in get(parent chat).data.participants).
 */
import {
  sb, state, uploadViaController, isAdmin, fetchAllRows, mapProfile, mapChat, mapMessage,
  mediaPublicUrl, ts, SUPABASE_URL, SUPABASE_ANON_KEY, MEDIA_BUCKET, MAX_FILE
} from '../core/config.js';
import { $, esc, renderMarkdown, defAvi, fmt, fmtTime, fmtSz, isOnline, formatLastSeen, isActiveUser } from '../core/utils.js';
import { toast }            from '../ui/toast.js';
import { initMsgMenu, msgMenuAfterPaint, msgMenuReset, isEditing, commitEdit } from './msg-menu.js';
import { dissolveMarks, markDissolve, playDeleteDissolve, dissolveGroupInfo } from '../ui/dissolve.js';
import { rateOk }           from '../core/rate-limit.js';
import { initEmojiPicker } from '../ui/emoji-picker.js';
import { emojiOnlyClass, wrapEmojiNoSelect, playRemoteEmoji } from '../ui/emoji-only.js';
import { openRt } from './rt-chat.js';
import { generateVoiceBubble, generateFileBubble, generateTextBubble, generateCallBubble, rememberImgRatio, wrapChatBubble, assembleMessageHtml, generateOptimisticVoiceHtml } from './components/message-bubble.js';
import { busOn, inboxSend, inboxWarm, isUidOnline } from '../core/rt-bus.js';
import {
  startGroupsWatcher, stopGroupsWatcher, bindGroupsRealtime,
  openGroupThread, closeGroupThread,
  sendGroupMessage, sendGroupFile, sendGroupVoice, groupTypingInput, reloadGroupThread,
  injectGroupsDOM, openCreateChoice, getGroupRows,
  getCurrentGroupId, joinGroup, leaveGroup, searchGroups
} from './groups.js';
import {
  cacheChatsList, getCachedChatsList, getCachedChatsListAgeMs,
  cacheThreadMessages, getCachedThreadMessages, invalidateChatsListCache
} from '../core/local-cache.js';
import {
  getPins as _getPins,
  isPinned as _isPinned,
  togglePin as _togglePin,
  getRecents as _getRecents,
  saveRecent as _saveRecent,
  removeRecent as _removeRecent,
  clearAllRecents as _clearAllRecents,
  markChatDeletedLocal,
  clearChatDeletedLocal,
  getChatDeletedAt,
} from './chat-storage.js';
import { initChatVoiceRecording, forceStopVoiceRecording, canRecordMedia } from './chat-voice-record.js';
import { fileMsgPreview } from './components/video-note.js';
import { initAttachMenu } from './attach-menu.js';
import {
  initVoicePlayer,
  fmtVoiceDur,
  renderVoiceWave,
  waveReadyClass,
  voiceBarCount as _voiceBarCount,
  hydrateVoiceWaveforms as _hydrateVoiceWaveforms,
  reattachActiveVoiceUI as _reattachActiveVoiceUI,
  registerLocalVoiceUrl,
  getLocalVoiceUrl,
  primeWaveform,
  _syncMiniPlayer,
} from './chat-voice-player.js';
import {
  _toDateSafe,
  _isSameDay,
  _dateSepLabel,
  parsePostShare,
  parseCallLog,
  formatLastMessageText,
  _showPendingBubble,
  _updatePendingProgress,
  _removePendingBubble,
  uploadViaControllerProgress,
  _uuid, getChatFileIcon, ensureChatsView } from './chat-shared.js';
import { isAllowedChatFile as isAllowedUpload, UPLOAD_DENIED_MSG } from '../core/upload-policy.js';
// Re-export shared helpers so existing importers of chat.js keep working
export {
  _toDateSafe,
  _isSameDay,
  _dateSepLabel,
  parsePostShare,
  formatLastMessageText,
  _showPendingBubble,
  _updatePendingProgress,
  _removePendingBubble,
  uploadViaControllerProgress,
  _uuid,
} from './chat-shared.js';

const MSG_LIMIT = 60; // Bir thread'da max xabar soni (RAM tejash)

/* ── Helpers ──────────────────────────────────────────────────────────── */
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function _fetchChatUsers() {
  const rows = await fetchAllRows('profiles', '*', 'created_at');
  return rows.map(mapProfile).filter(u => u.uid !== state.me.uid && isActiveUser(u));
}

/** chatState._usersCache 5 daqiqagacha keshlanadi — shu vaqt ichida `lastSeenAt` eskirib,
 * "onlayn" nuqta noto'g'ri o'chib/yonib qoladi. Faqat `last_seen` ni yengil
 * so'rov bilan yangilaymiz. O'zgarish bo'lsa true qaytaradi. */
async function _refreshUsersPresence() {
  if (!chatState._usersCache || !chatState._usersCache.length || !state.me) return false;
  if (document.visibilityState !== 'visible') return false;
  try {
    const rows = await fetchAllRows('profiles', 'id,last_seen', 'created_at');
    const seen = new Map((rows || []).map(r => [r.id, ts(r.last_seen)]));
    let changed = false;
    for (const u of chatState._usersCache) {
      if (!seen.has(u.uid)) continue;
      const t = seen.get(u.uid);
      if (t !== u.lastSeenAt) { u.lastSeenAt = t; changed = true; }
    }
    return changed;
  } catch (_) { return false; }
}




/* ── Tezkor yo'l (rt-chat.js): WebRTC DataChannel / broadcast ─────────────
 * chatState._rtLocal — hali DB'dan tasdiqlanmagan (optimistik yoki p2p kelgan) xabarlar.
 * chatState._rtRead  — p2p orqali "o'qildi" deb tasdiqlangan ID'lar (DB yangilanguncha). */






function _rtMerge(msgs) {
  if (chatState._rtLocal.size) {
    const have = new Set(msgs.map(m => m.id));
    for (const [id, m] of chatState._rtLocal) {
      if (have.has(id) || Date.now() - m._at > 20000) chatState._rtLocal.delete(id);
      else msgs.push(m);
    }
  }
  if (chatState._rtRead.size) for (const m of msgs) if (chatState._rtRead.has(m.id)) m.status = 'read';
  return msgs;
}

function _rtIncoming(m) {
  if (!m?.id || state.currentChatId !== chatState._rtChatId) return;
  if (chatState._rtLocal.has(m.id) || chatState._curMsgs.some(x => x.id === m.id)) return;
  const now = Date.now();
  const type = m.type || 'text';
  const mediaPath = m.mediaPath || null;
  const msg = {
    id: m.id, chatId: chatState._rtChatId, senderId: state.currentChatUid, type,
    text: m.text || null,
    mediaPath,
    mediaUrl: mediaPath ? (mediaPublicUrl(mediaPath) || '') : '',
    mediaType: m.mediaType || null,
    fileName: m.fileName || null,
    fileSize: m.fileSize ?? null,
    duration: m.duration ?? null,
    waveform: Array.isArray(m.waveform) ? m.waveform : null,
    status: 'sent', readAt: null, editedAt: null, createdAt: now, _at: now,
  };
  chatState._rtLocal.set(m.id, msg);
  paintMessages([...chatState._curMsgs, msg]);
  // Read: faqat xabar ekranda ko'rinsa (IntersectionObserver)
}

function _rtReadAck(ids) {
  const me = state.me?.uid;
  let changed = false;
  const next = chatState._curMsgs.map(x => {
    if (x.senderId === me && ids.includes(x.id) && x.status !== 'read') { changed = true; return { ...x, status: 'read' }; }
    return x;
  });
  ids.forEach(id => { if (chatState._curMsgs.some(x => x.id === id && x.senderId === me)) chatState._rtRead.add(id); });
  if (changed) paintMessages(next);
}

function _rtRetract(id) {
  if (!chatState._rtLocal.has(id)) return; // DB'da tasdiqlangan bo'lsa tegmaymiz
  chatState._rtLocal.delete(id);
  markDissolve([id]);
  paintMessages(chatState._curMsgs.filter(x => x.id !== id));
}
   // msg-menu.js uchun: paintMessages() ning oxirgi xabarlar ro'yxati


/* ── Global chats watcher (badge + chats list, real-time) ─────────────
   Bitta onSnapshot orqali HAR DOIM (foydalanuvchi qaysi view'da turishidan
   qat'i nazar) ishlaydi — login bo'lgan zahoti boshlanadi (auth.js orqali).
   Shu bitta listener ikki narsani ta'minlaydi:
     1) Sidebar/bottom-nav dagi "Suhbatlar" tugmasi ustidagi kichik qizil
        badge — barcha chatlardagi umumiy o'qilmagan xabarlar soni.
     2) Suhbatlar ro'yxati (har bir foydalanuvchi qatoridagi kattaroq badge) —
        agar foydalanuvchi hozir aynan shu view'da bo'lsa, real vaqtda
        qayta chiziladi.
   ──────────────────────────────────────────────────────────────────── */




   // adminNotice real-time listener
   // 'chats-watcher' kanali admin_notice o'zgarganda shuni chaqiradi
 // onlayn nuqtalarni vaqt bo'yicha yangilab turadi
   // { text, target, createdAt } | null
   // contacts real-time listener
 // current user's contact UIDs
 // groupsUpdated leak oldini olish

function updateChatBadge(count) {
  const n = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  const badge = $('chatBadge');
  if (badge) {
    if (count > 0) {
      badge.textContent = `+${count > 99 ? 99 : count}`;
      badge.classList.remove('d-none');
    } else {
      badge.textContent = '';
      badge.classList.add('d-none');
    }
  }
  // Mobile header bell
  const hb = $('hdrNotifBadge');
  if (hb) {
    if (count > 0) {
      hb.textContent = n;
      hb.classList.remove('d-none', 'dot');
    } else {
      hb.textContent = '';
      hb.classList.add('d-none');
    }
  }
}

/** Admin userni o'chirgan/bloklaganda chaqiriladi — hotira ichidagi va
 * localStorage'dagi kontaktlar (suhbat boshlash) keshini bekor qilib,
 * ro'yxatni Firestore'dan qayta yuklaydi (5 daqiqa kutilmaydi). */
export async function invalidateChatsUsersCache() {
  if (state.me?.uid) invalidateChatsListCache(state.me.uid);
  chatState._usersCache = null;
  if (!state.me) return;
  try {
    chatState._usersCache = await _fetchChatUsers();
    cacheChatsList(state.me.uid, chatState._usersCache, chatState._latestChatMap);
  } catch (err) {
    console.warn('[Chat] invalidateChatsUsersCache fetch failed:', err.message);
  }
  if (state.view === 'chats') paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
}

/** Boshqa foydalanuvchi ismi/username/avatarini o'zgartirsa — realtime yangilash
 * (suhbatlar ro'yxati, ochiq thread sarlavhasi, onlayn rail, localStorage keshi). */
let _profLiveTimer = null;
function _onProfileLive(row) {
  const u = mapProfile(row);
  if (!u || !u.uid) return;
  const diff = (o) => !!o && (o.fullName !== u.fullName || o.username !== u.username || (o.avatar || '') !== (u.avatar || ''));
  const cu = (chatState._usersCache || []).find(x => x.uid === u.uid);
  const gc = state._userCache?.[u.uid];
  if (!diff(cu) && !diff(gc)) return;   // last_seen heartbeat va h.k. — e'tiborsiz
  for (const o of [cu, gc]) {
    if (!o) continue;
    o.fullName = u.fullName; o.username = u.username; o.avatar = u.avatar;
  }
  clearTimeout(_profLiveTimer);
  _profLiveTimer = setTimeout(() => {
    try { if (state.me?.uid && chatState._usersCache) cacheChatsList(state.me.uid, chatState._usersCache, chatState._latestChatMap); } catch (_) {}
    if (state.view === 'chats') paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
    // Ochiq DM thread shu odamniki bo'lsa — sarlavha
    if (chatState._otherUserUid === u.uid) {
      const nm = $('chatThreadName'); if (nm) nm.textContent = u.fullName || 'Foydalanuvchi';
      const av = u.avatar || defAvi(u.fullName || 'U');
      chatState._otherUserAvi = av;
      const ae = $('chatThreadAvi'); if (ae) ae.innerHTML = `<img src="${esc(av)}" onerror="this.style.display='none'">`;
    }
    document.dispatchEvent(new CustomEvent('profileChanged', { detail: { uid: u.uid } }));
  }, 150);
}

export function startChatsWatcher() {
  // Boshqalarning profil o'zgarishlari (ism/avatar) — BIR MARTA ulanamiz
  if (!chatState._profileLiveCh) {
    chatState._profileLiveCh = sb.channel('profiles-live-names')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, p => _onProfileLive(p.new))
      .subscribe();
  }
  // Also start groups watcher
  startGroupsWatcher();
  // Listen for group updates to repaint list — faqat BIR MARTA qo'shamiz
  if (!chatState._groupsListenerAttached) {
    chatState._groupsListenerAttached = true;
    document.addEventListener('groupsUpdated', () => {
      if (state.view === 'chats') paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
    });
  }

  if (chatState._chatsUnsub) return Promise.resolve();
  if (chatState._watcherPromise) return chatState._watcherPromise;

  chatState._watcherPromise = (async () => {
    if (!state.me) return;

    // Agar kesh 5 daqiqadan yangi bo'lsa — butun "users" kolleksiyasini
    // qayta tarmoqdan yuklamaymiz (bu og'ir so'rov, foydalanuvchilar
    // ko'payib borgan sari sekinlashadi). Kesh eskirgan/yo'q bo'lsagina
    // yangilaymiz.
    const cacheAgeMs = getCachedChatsListAgeMs(state.me.uid);
    const cacheIsFresh = cacheAgeMs !== null && cacheAgeMs < 5 * 60 * 1000;

    if (cacheIsFresh) {
      // chatState._usersCache hali o'rnatilmagan bo'lishi mumkin (masalan foydalanuvchi
      // "Suhbatlar" bo'limini hali ochmagan bo'lsa) — shu holatda ham
      // to'g'ridan-to'g'ri localStorage'dagi keshdan o'qib olamiz.
      if (!chatState._usersCache || !chatState._usersCache.length) {
        const cached = getCachedChatsList(state.me.uid);
        chatState._usersCache = cached?.users || [];
      }
    }
    // Agar kesh bo'sh bo'lsa (yangi hisob ochilganda) — baribir serverdan yuklaymiz
    if (!chatState._usersCache || !chatState._usersCache.length) {
      try {
        chatState._usersCache = await _fetchChatUsers();
        cacheChatsList(state.me.uid, chatState._usersCache, chatState._latestChatMap);
      } catch (err) {
        console.warn('[Chat] users fetch failed:', err.message);
        chatState._usersCache = chatState._usersCache || [];
      }
    }

    // Kontaktlar listener — oddiy user uchun contacts subcollection.
    // MUHIM: bu yerda ENDI hech narsani kutmaymiz (avval "birinchi snapshot
    // kelguncha yoki 5 soniya" deb sun'iy kutish bor edi — aynan shu
    // "10 soniya+" sekinlikning asosiy sababi edi). Listener fonda ishga
    // tushadi, ma'lumot kelganda ekran o'zi jimgina yangilanadi.
    if (!isAdmin() && !chatState._contactsUnsub) {
      let _cDead = false;
      chatState._contactsUnsub = () => { _cDead = true; };
      sb.from('contacts').select('contact_id').eq('owner_id', state.me.uid).then(({ data, error }) => {
        if (_cDead) return;
        if (error) { console.warn('[Chat] contacts load error:', error.message); return; }
        chatState._myContacts = new Set((data || []).map(r => r.contact_id));
        if (state.view === 'chats') paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
      });
    }

    if (!state.me) return; // logout race davomida

    // adminNotice real-time listener
    if (!chatState._noticeUnsub) {
      let _nDead = false;
      const loadNotice = async () => {
        const { data } = await sb.from('admin_notice').select('*').eq('id', 'global').maybeSingle();
        if (_nDead) return;
        chatState._latestNotice = data ? { text: data.text, target: data.target, createdAt: ts(data.created_at) } : null;
        if (state.view === 'chats') _repaintNoticeBanner();
      };
      // admin_notice o'zgarishini 'chats-watcher' kanali tinglaydi (5.3: alohida kanal yo'q)
      chatState._noticeUnsub = () => { _nDead = true; };
      chatState._loadNoticeFn = loadNotice;
      loadNotice();
    }

    let _chDead = false, _chTimer = null;
    const loadChats = async () => {
      const me = state.me?.uid;
      if (!me) return;
      const { data, error } = await sb.from('chats')
        .select('*, chat_members(user_id, unread_count)')
        .or(`user_a.eq.${me},user_b.eq.${me}`);
      if (_chDead || !state.me) return;
      if (error) { console.warn('[Chat] chats watcher error:', error.message); return; }
      const chatMap = {};
      let total = 0;
      (data || []).forEach(r => {
        const c = mapChat(r);
        const otherUid = c.participants.find(p => p !== me);
        if (otherUid) chatMap[otherUid] = c;
        total += c.unreadCount[me] || 0;
      });
      chatState._latestChatMap = chatMap;
      updateChatBadge(total);
      if (chatState._usersCache) cacheChatsList(state.me.uid, chatState._usersCache, chatMap);
      if (state.view === 'chats') paintChatsList(chatState._usersCache || [], chatMap);
    };
    // Realtime hodisa kelishi bilan DARHOL yuklaymiz (debounce yo'q); yuklanish paytida kelganlari birlashtiriladi
    let _chBusy = false, _chAgain = false;
    const schedChats = async () => {
      if (_chBusy) { _chAgain = true; return; }
      _chBusy = true;
      try { do { _chAgain = false; await loadChats(); } while (_chAgain && !_chDead); }
      finally { _chBusy = false; }
    };
    const chBase = sb.channel('chats-watcher')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_notice' }, () => { chatState._loadNoticeFn?.(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, schedChats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members', filter: `user_id=eq.${state.me.uid}` }, p => {
        // faqat typing/last_seen o'zgargan bo'lsa ro'yxatni qayta yuklamaymiz
        if (p.eventType === 'UPDATE' && p.old && p.new.unread_count === p.old.unread_count) return;
        schedChats();
      });
    // guruh o'zgarishlari ham shu kanalda (5.3: 'groups-watcher' kanali yo'q)
    let _chSubbed = false;
    const chCh = bindGroupsRealtime(chBase).subscribe(st => {
      if (st !== 'SUBSCRIBED') return;
      if (_chSubbed) schedChats();     // uzilib qayta ulandi — o'tkazib yuborilganlarni to'ldiramiz
      _chSubbed = true;
    });
    // Uyg'onish / internet qaytishi: suhbatlar ro'yxati va ochiq thread qayta yuklanadi
    const _onResync = () => { schedChats(); try { if (chatState._threadUnsub) chatState._reloadThread?.(); } catch (_) {} };
    window.addEventListener('spacemr:resync', _onResync);
    chatState._chatsUnsub = () => { _chDead = true; clearTimeout(_chTimer); window.removeEventListener('spacemr:resync', _onResync); sb.removeChannel(chCh); };
    loadChats();

    // Onlayn nuqtalar vaqt o'tishi bilan (masalan user oflayn bo'lib qolganda)
    // o'zi so'nishi uchun — yangi ma'lumot kelmasa ham ro'yxatni davriy
    // qayta chizamiz (isOnline() joriy vaqtga qarab hisoblanadi).
    if (!chatState._presenceRepaintTick) {
      chatState._presenceRepaintTick = setInterval(async () => {
        if (state.view !== 'chats') return;
        await _refreshUsersPresence();
        if (state.view === 'chats') paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
      }, 30000);
    }
  })();

  return chatState._watcherPromise;
}

export function stopChatsWatcher() {
  stopGroupsWatcher();
  if (chatState._chatsUnsub) { chatState._chatsUnsub(); chatState._chatsUnsub = null; }
  if (chatState._noticeUnsub) { chatState._noticeUnsub(); chatState._noticeUnsub = null; }
  chatState._loadNoticeFn = null;
  if (chatState._contactsUnsub) { chatState._contactsUnsub(); chatState._contactsUnsub = null; }
  if (chatState._presenceRepaintTick) { clearInterval(chatState._presenceRepaintTick); chatState._presenceRepaintTick = null; }
  chatState._usersCache    = null;
  chatState._latestChatMap = {};
  chatState._latestNotice  = null;
  chatState._myContacts    = new Set();
  chatState._watcherPromise = null;
  chatState._groupsListenerAttached = false;
  updateChatBadge(0);
}

/* ── Render chats list (all registered users) ───────────────────────── */
export async function renderChatsList() {
  const root = $('chatsListWrap');
  if (!root || !state.me) return;

  if (!chatState._usersCache) {
    // Tarmoqni kutmasdan — keshdagi so'nggi ma'lumotni darhol ko'rsatamiz
    const cached = getCachedChatsList(state.me.uid);
    if (cached && cached.users && cached.users.length) {
      chatState._usersCache    = cached.users;
      chatState._latestChatMap = cached.chatMap || {};
      paintChatsList(chatState._usersCache, chatState._latestChatMap);
    } else {
      root.innerHTML = `<div class="spin-wrap pt-60px"><div class="spinner"></div></div>`;
    }
  }

  try {
    await startChatsWatcher();

    const hasUsers = !!(chatState._usersCache && chatState._usersCache.length);
    const hasGroups = !!(getGroupRows() && getGroupRows().length);

    if (!hasUsers && !hasGroups) {
      root.innerHTML = `<div class="empty pt-30vh tac">
        <div class="fs-14px fw-600 c-text mb-6px">Hozircha boshqa foydalanuvchilar yo'q</div>
        <div class="fs-13px c-text2">Odamlar SpaceMR ga qo'shilgach, shu yerda ko'rinadi</div>
      </div>`;
      return;
    }

    paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
    // Ro'yxat ochilganda darhol yangi last_seen — nuqtalar kesh bilan eskirmasin
    _refreshUsersPresence().then(changed => {
      if (changed && state.view === 'chats') paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
    });
  } catch (err) {
    console.error('renderChatsList failed:', err.message);
    root.innerHTML = `<div class="empty pt-30vh tac">
      <div class="fs-14px fw-600 c-text mb-6px">Suhbatlar yuklanmadi</div>
      <div class="fs-13px c-text2">${esc(err.message)}</div>
    </div>`;
  }
}

/* ── Admin notice banner (chats tepasida) ────────────────────────────── */
function _injectNoticeCSS() { /* CSS: mono-x.css .admin-notice-banner */ }

function _repaintNoticeBanner() {
  const wrap = $('chatsListWrap');
  if (!wrap) return;
  const existing = document.getElementById('adminNoticeBanner');
  if (existing) existing.remove();
  if (!chatState._latestNotice || !chatState._latestNotice.text) return;
  const t = chatState._latestNotice.target || 'all';
  if (t === 'pending') return; // kutayotganlar uchun — chatda ko'rinmaydi
  _injectNoticeCSS();
  const html = `<div class="admin-notice-banner" id="adminNoticeBanner">
    <div class="admin-notice-icon">
      <img src="./svg/extra/icon-6c25873293c0.svg" alt="" class="icon" width="16" height="16">
    </div>
    <div class="admin-notice-text">${esc(chatState._latestNotice.text)}</div>
  </div>`;
  wrap.insertAdjacentHTML('afterbegin', html);
}

export function repaintNoticeBanner() { _repaintNoticeBanner(); }

/* ── Append group/channel rows to chats list ─────────────────────────── */
async function _appendGroupRows(root, term = '') {
  // Remove old group section if any
  root.querySelector('.grp-rows-section')?.remove();

  let groups = getGroupRows();
  if (term) {
    const local = groups.filter(g =>
      (g.name || '').toLowerCase().includes(term) ||
      (g.username || '').toLowerCase().includes(term)
    );
    try {
      const remote = await searchGroups(term);
      const map = new Map(local.map(g => [g.id, g]));
      (remote || []).forEach(g => map.set(g.id, g));
      groups = Array.from(map.values());
    } catch (_) {
      groups = local;
    }
  }
  if (!groups.length) return;

  const rows = groups.map(g => ({ g, pinned: _isPinned('group', g.id) }));
  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = a.g.lastMessageAt || 0;
    const tb = b.g.lastMessageAt || 0;
    if (ta !== tb) return tb - ta;
    return (a.g.name || '').localeCompare(b.g.name || '');
  });

  const section = document.createElement('div');
  section.className = 'grp-rows-section';

  section.innerHTML = `<div class="chats-section-label">Guruhlar</div>` +
    rows.map(({ g, pinned }) => {
      const av      = g.avatar || defAvi(g.name || 'G');
      const unread  = g.unreadCount?.[state.me?.uid] || 0;
      const badgeTxt = unread > 99 ? '+99' : `+${unread}`;
      const rawPreview = g.lastMessage || '';
      const formattedLastMsg = formatLastMessageText(rawPreview);
      const preview  = rawPreview ? esc(formattedLastMsg.slice(0, 46)) : 'Guruh';
      const time     = (g.lastMessageAt && rawPreview) ? fmt(g.lastMessageAt) : '';
      const typeIcon = `<img src="./svg/extra/icon-a4ea72a360cc.svg" alt="" class="icon" width="9" height="9">`;
      const badgeClass = 'chat-row-grp-badge--group';
      const pinHtml = pinned ? `<span class="chat-row-pin-ico" title="Qadalgan"><img src="./svg/extra/icon-dc035561d9ad.svg" alt="" class="icon" width="12" height="12"></span>` : '';
      const unameHtml = g.username ? `<span style="font-size:11.5px;color:var(--blue,#1d9bf0);font-weight:500;margin-left:6px;">@${esc(g.username)}</span>` : '';

      return `<div class="chat-row${unread ? ' unread' : ''}" data-gid="${g.id}">
        <div class="chat-avi">
          <img src="${esc(av)}" onerror="this.style.display='none'">
          <div class="chat-row-grp-badge ${badgeClass}">${typeIcon}</div>
        </div>
        <div class="chat-row-body">
          <div class="chat-row-name">${esc(g.name || 'Guruh')}${unameHtml}</div>
          <div class="chat-row-preview">${preview}</div>
        </div>
        <div class="chat-row-right">
          ${pinHtml}
          ${time ? `<div class="chat-row-time">${time}</div>` : ''}
          ${unread ? `<div class="chat-row-badge">${badgeTxt}</div>` : ''}
        </div>
      </div>`;
    }).join('');

  root.appendChild(section);

  section.querySelectorAll('.chat-row[data-gid]').forEach(row => {
    _attachChatRowContextMenu(row);
    row.addEventListener('click', () => {
      const gid = row.dataset.gid;
      const g = groups.find(x => x.id === gid);
      if (g) {
        _saveRecent({ type: 'group', id: g.id, name: g.name, avatar: g.avatar });
      }
      openGroupThread(gid);
    });
  });
}

function paintChatsList(users, chatMap) {
  const root = $('chatsListWrap');
  if (!root) return;

  // Search box hamma uchun ko'rsatiladi
  _renderSearchBox(root);

  // Recent searches panel faqat input focus bo'lganda ko'rinsin, aks holda olib tashla
  const searchInput = document.getElementById('chatSearchInput');
  if (document.activeElement !== searchInput) {
    document.getElementById('chatRecentSearchesWrap')?.remove();
  }

  const rawQ = (chatState._searchQuery || '').trim();
  const term = (rawQ.startsWith('@') ? rawQ.slice(1) : rawQ).toLowerCase();

  let filtered = users;
  if (term) {
    filtered = users.filter(u =>
      (u.username || '').toLowerCase().includes(term) ||
      (u.fullName || '').toLowerCase().includes(term)
    );
  } else {
    filtered = users.filter(u => _shouldShowInChatsList(u, chatMap));
  }
  _paintUserRows(filtered, !!term);
  _repaintNoticeBanner();
  _appendGroupRows(root, term);
}

/* ── Other user avatar cache for DM messages ─────────────────────────── */



/* ── Peer onlayn holati (chat thread sarlavhasi uchun) ────────────────── */








      // joriy DM uchun BITTA doimiy broadcast kanal (yuborish + qabul)


function _paintPeerStatus(lastSeenAt) {
  chatState._peerLastSeenAt = lastSeenAt;
  const el = $('chatTypingStatus');
  if (!el) return;
  if (chatState._peerTyping) {
    el.textContent = 'yozmoqda...';
    el.classList.add('online');
    return;
  }
  const online = isUidOnline(state.currentChatUid, isOnline(lastSeenAt));
  el.textContent = online ? 'onlayn' : formatLastSeen(lastSeenAt);
  el.classList.toggle('online', online);
}

/* ── "Yozmoqda..." — realtime broadcast (bazaga yozilmaydi) ──────────────
 * Chat ochilganda BITTA kanal (`typing-bc-<chatId>`) ochiladi (openChatThread),
 * ikki tomon ham shunga obuna; yuboruvchi shu kanaldan `send` qiladi.
 * Kanal chat yopilganda olib tashlanadi. Faqat DM.
 ─────────────────────────────────────────────────────────────────────── */
export function _setTyping(isTyping) {
  if (!state.currentChatId || !state.me) return;
  if (chatState._iAmTyping === isTyping) return; // ortiqcha yuborishlarni oldini olish
  if (!(chatState._rt?.isP2P()) && (!chatState._typingCh || !chatState._typingChReady)) return; // kanal hali ulanmagan
  chatState._iAmTyping = isTyping;
  try {
    if (chatState._rt?.isP2P()) { chatState._rt.sendTyping(isTyping); return; }
    chatState._typingCh.send({ type: 'broadcast', event: 'typing', payload: { uid: state.me.uid, typing: isTyping } });
  } catch (_) {}
}

function _onChatInputTyping() {
  // Faqat 1v1 (DM) chatda ishlaydi — guruh/kanalda alohida mantiq kerak
  if (state.currentChatKind && state.currentChatKind !== 'dm') { groupTypingInput(); return; }
  _setTyping(true);
  clearTimeout(chatState._typingTimeout);
  chatState._typingTimeout = setTimeout(() => _setTyping(false), TYPING_HIDE_MS);
}

/* ── Tezkor kirish qutisi: boshqa tomondan kelgan xabar ro'yxatni shu zahoti yangilaydi ── */
busOn('inbox', (o) => {
  const me = state.me?.uid;
  if (!me || !o || !o.from || o.from === me || typeof o.chatId !== 'string') return;
  if (state.currentChatId === o.chatId && $('chatThreadModal')?.classList.contains('show')) return; // ochiq thread p2p/DB orqali
  const prev = chatState._latestChatMap[o.from];
  if (prev && prev.lastMessageId === o.id) return;
  const unread = { ...(prev?.unreadCount || {}) };
  unread[me] = (unread[me] || 0) + 1;
  chatState._latestChatMap = {
    ...chatState._latestChatMap,
    [o.from]: {
      ...(prev || { id: o.chatId, participants: [me, o.from], createdAt: o.ts }),
      lastMessage: String(o.text || '').slice(0, 120), lastMessageId: o.id,
      lastSenderId: o.from, lastMessageAt: o.ts || Date.now(), unreadCount: unread,
    },
  };
  updateChatBadge(Object.values(chatState._latestChatMap).reduce((n, c) => n + (c.unreadCount?.[me] || 0), 0));
  if (state.view === 'chats') paintChatsList(chatState._usersCache || [], chatState._latestChatMap);
});
document.addEventListener('presenceChanged', () => {
  if (state.view === 'chats' && chatState._usersCache) paintChatsList(chatState._usersCache, chatState._latestChatMap);
  if (state.currentChatUid && $('chatTypingStatus')) _paintPeerStatus(chatState._peerLastSeenAt);
});

/* ── Open chat thread ─────────────────────────────────────────────────── */





const MSG_ANIM_MS = 250;

export async function openChatThread(uid) {
  if (!uid || !state.me || uid === state.me.uid) return;
  await ensureChatsView();
  msgMenuReset();

  state.currentChatKind = 'dm';
  document.getElementById('groupJoinBar')?.remove();
  document.getElementById('chatHeaderDropdown')?.remove();
  const inputRow = document.querySelector('.chat-thread-input-row');
  if (inputRow) inputRow.style.display = '';
  initChatHeaderMenu();

  _injectPresenceCSS();
  $('chatThreadModal').classList.add('show');
  $('chatThreadName').textContent   = '...';
  $('chatThreadAvi').innerHTML      = '';

  const draft = localStorage.getItem('draft_' + uid) || '';
  $('chatThreadInput').value = draft;
  setTimeout(updateVoiceSendBtn, 50);

  autoGrowChatInput();
  updatePostAttachBar();

  state.currentChatUid = uid;
  let chatId = chatState._latestChatMap[uid]?.id;
  if (!chatId || !_UUID_RE.test(chatId)) {
    const { data, error } = await sb.rpc('get_or_create_chat', { p_other: uid });
    if (error || !data) {
      console.warn('[Chat] get_or_create_chat:', error?.message);
      toast('Suhbat ochilmadi', 'error');
      closeChatThread();
      return;
    }
    if (state.currentChatUid !== uid) return; // shu orada boshqa chatga o'tilgan
    chatId = data;
  }
  state.currentChatId = chatId;
  // Boshqa chatga o'tilganda ID-kuzatuvchini tozalaymiz — aks holda Set
  // cheksiz o'sib ketishi mumkin va yangi chatning birinchi ochilishida
  // xabarlar tabiiy tarzda "pop-in" bo'lishi kerak.
  if (chatState._seenMsgIdsChatId !== chatId) {
    chatState._seenMsgIds = new Set();
    chatState._seenMsgIdsChatId = chatId;
    chatState._seenBaselineDone = false;
    chatState._msgAnimStart.clear();
    chatState._dissolving.clear(); dissolveMarks.clear();
  }
  // Agar hozir ijro etilayotgan ovozli xabar aynan shu chatga tegishli
  // bo'lsa — mini-pleer bar endi kerak emas (xabar o'zi thread ichida
  // ko'rinadi), aks holda bar davom etib turadi.
  try { _syncMiniPlayer(); } catch (_) {}

  // Tarmoqni kutmasdan — keshdagi so'nggi xabarlarni darhol ko'rsatamiz
  const _cachedMsgs = getCachedThreadMessages(chatId);
  if (_cachedMsgs && _cachedMsgs.length) {
    paintMessages(_cachedMsgs);
  } else {
    $('chatThreadMessages').innerHTML = `<div class="spin-wrap pt-60px"><div class="spinner"></div></div>`;
  }
  // Reset voice/file state (functions defined below, safe after page load)
  try { forceStopVoiceRecording(); } catch(_) {}
  $('chatVoiceBtn')?.classList.remove('active');
  chatState._chatSelFile = null;
  $('chatFilePreview')?.classList.remove('active');
  $('chatFileInput') && ($('chatFileInput').value = '');
  try { updateVoiceSendBtn(); } catch(_) {}

  const videoBtn = $('chatVideoCallBtn');
  if (videoBtn) videoBtn.style.display = '';
  const voiceCallBtn = $('chatVoiceCallBtn');
  if (voiceCallBtn) voiceCallBtn.style.display = '';
  try {
    const { data: prow } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    const ud = mapProfile(prow) || {};
    const av = ud.avatar || defAvi(ud.fullName || 'U');
    $('chatThreadName').textContent = ud.fullName || 'Foydalanuvchi';
    $('chatThreadAvi').innerHTML = `<img src="${esc(av)}" onerror="this.style.display='none'">`;
    _paintPeerStatus(ud.lastSeenAt);
    // Cache for message avatars
    chatState._otherUserAvi = av;
    chatState._otherUserUid = uid;
  } catch (err) {
    console.warn('[Chat] Failed to load user info:', err.message);
    chatState._otherUserAvi = defAvi('U');
    chatState._otherUserUid = uid;
  }

  // Onlayn holatni real vaqtda kuzatib turish — peer user hujjatidagi
  // `lastSeenAt` heartbeat orqali yangilanganda darhol sarlavhada ko'rinsin.
  if (chatState._peerUserUnsub) { chatState._peerUserUnsub(); chatState._peerUserUnsub = null; }
  {
    const pch = sb.channel('peer-' + uid)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
          p => _paintPeerStatus(ts(p.new?.last_seen)))
      .subscribe();
    chatState._peerUserUnsub = () => sb.removeChannel(pch);
  }
  // "Onlayn"dan "N daqiqa oldin"ga o'tishini ko'rsatish uchun har 20s da
  // matnni qayta hisoblaymiz (server yozuvi o'zgarmasa ham vaqt o'tadi).
  if (chatState._peerStatusTick) clearInterval(chatState._peerStatusTick);
  chatState._peerStatusTick = setInterval(() => _paintPeerStatus(chatState._peerLastSeenAt), PEER_STATUS_MS);

  // "Yozmoqda..." — realtime broadcast (typing_until ustuni yo'q)
  chatState._peerTyping = false;
  chatState._iAmTyping = false;
  if (chatState._chatDocUnsub) { chatState._chatDocUnsub(); chatState._chatDocUnsub = null; }
  {
    let tTimer = null;
    chatState._onPeerTyping = (v) => {
      clearTimeout(tTimer);
      chatState._peerTyping = !!v;
      if (chatState._peerTyping) tTimer = setTimeout(() => { chatState._peerTyping = false; _paintPeerStatus(chatState._peerLastSeenAt); }, PEER_TYPING_MAX_MS);
      _paintPeerStatus(chatState._peerLastSeenAt);
    };
    const tch = sb.channel('typing-bc-' + chatId)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.uid !== uid) return;
        chatState._onPeerTyping(payload.typing);
      })
      .subscribe(st => { if (tch === chatState._typingCh) chatState._typingChReady = (st === 'SUBSCRIBED'); });
    chatState._typingCh = tch;
    chatState._typingChReady = false;
    chatState._chatDocUnsub = () => {
      clearTimeout(tTimer);
      if (chatState._typingCh === tch) { chatState._typingCh = null; chatState._typingChReady = false; }
      sb.removeChannel(tch);
    };
  }

  // Tezkor yo'l: WebRTC DataChannel (zaxira: broadcast). Baza baribir asosiy.
  if (chatState._rt) { chatState._rt.close(); chatState._rt = null; }
  chatState._rtLocal.clear(); chatState._rtRead.clear();
  chatState._rtChatId = chatId;
  chatState._rt = openRt(chatId, uid, { onMsg: _rtIncoming, onRead: _rtReadAck, onRetract: _rtRetract, onTyping: (v) => chatState._onPeerTyping(v), onEmo: (id, k) => playRemoteEmoji(id, k) });
  inboxWarm(uid);

  // unread_count endi faqat ekranda ko'rilgan xabarlar bo'yicha kamayadi (IntersectionObserver)

  // Kontaktlarni saqlash — xato bo'lsa chat ochilishga ta'sir qilmaydi.
  try {
    const od = (chatState._usersCache || []).find(u => u.uid === uid) || {};
    const { error: cErr } = await sb.from('contacts').upsert(
      { owner_id: state.me.uid, contact_id: uid, full_name: od.fullName || '', avatar: od.avatar || '' },
      { onConflict: 'owner_id,contact_id' }
    );
    if (cErr) throw cErr;
    chatState._myContacts.add(uid);
  } catch (err) {
    console.warn('[Chat] Failed to save contacts:', err.message);
  }

  if (chatState._threadUnsub) { chatState._threadUnsub(); chatState._threadUnsub = null; }

  let _tDead = false, _tTimer = null, _tLoaded = false;
  const loadThread = async () => {
    const { data, error } = await sb.from('messages').select('*')
      .eq('chat_id', chatId).order('created_at', { ascending: false }).limit(MSG_LIMIT);
    if (_tDead) return;
    if (error) {
      console.warn('[Chat] Thread load error:', error.message);
      if (!(_cachedMsgs && _cachedMsgs.length)) {
        $('chatThreadMessages').innerHTML = `<div class="empty pt-30vh tac">
          <div class="fs-13px c-text2">Xabarlar yuklanmadi</div>
        </div>`;
      }
      return;
    }
    const msgs = (data || []).map(mapMessage).reverse();
    paintMessages(_rtMerge(msgs.slice()));
    _tLoaded = true;
    cacheThreadMessages(chatId, msgs);
    // Read: faqat ekranda ko'rinadigan xabarlar (paintMessages -> _observeMessagesForRead)
  };
  const schedThread = () => { clearTimeout(_tTimer); _tTimer = setTimeout(loadThread, 0); };
  // Realtime payload'ni qayta yuklamasdan shu zahoti qo'llaymiz (INSERT/UPDATE/DELETE)
  const applyThreadPayload = (p) => {
    if (_tDead || state.currentChatId !== chatId) return;
    if (!_tLoaded) { schedThread(); return; }
    const ev = p.eventType;
    if (ev === 'DELETE') {
      const delId = p.old?.id;
      if (!delId) { schedThread(); return; }
      chatState._rtLocal.delete(delId);
      markDissolve([delId]);
      paintMessages(chatState._curMsgs.filter(x => x.id !== delId));
      return;
    }
    const m = mapMessage(p.new);
    if (!m || !m.id) { schedThread(); return; }
    chatState._rtLocal.delete(m.id);
    if (chatState._rtRead.has(m.id)) m.status = 'read';
    const list = chatState._curMsgs.slice();
    const i = list.findIndex(x => x.id === m.id);
    if (i >= 0) list[i] = m;
    else if (ev === 'INSERT') list.push(m);
    else { schedThread(); return; }
    paintMessages(list);
    // Read: observer yangi xabarni ekranda ko'ringanda belgilaydi
  };
  const mch = sb.channel('thread-' + chatId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, applyThreadPayload)
    .subscribe(st => { if (st === 'SUBSCRIBED') schedThread(); });
  chatState._threadUnsub = () => { _tDead = true; clearTimeout(_tTimer); sb.removeChannel(mch); };
  chatState._reloadThread = loadThread;
  loadThread();
}

/* ── Read receipts: faqat ekranda KO'RINGAN xabarlar o'qilgan deb belgilanadi ── */



 // shu sessiya ichida o'qilgan (qayta yubormaslik)

function _teardownReadObserver() {
  if (chatState._readObs) { try { chatState._readObs.disconnect(); } catch (_) {} chatState._readObs = null; }
  chatState._pendingReadIds.clear();
  clearTimeout(chatState._readFlushTimer);
  chatState._readFlushTimer = null;
}

async function markThreadRead(chatId, otherUid, msgs) {
  if (!state.me || !chatId || !otherUid) return;
  const unread = (msgs || []).filter(m =>
    m && m.senderId === otherUid && m.status !== 'read' && !chatState._locallyReadIds.has(m.id)
  );
  if (!unread.length) return;
  const ids = unread.map(m => m.id);
  ids.forEach(id => chatState._locallyReadIds.add(id));

  try {
    const { error } = await sb.from('messages')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .in('id', ids);
    if (error) throw error;

    chatState._curMsgs = chatState._curMsgs.map(m => ids.includes(m.id) ? { ...m, status: 'read' } : m);

    const remaining = chatState._curMsgs.filter(m =>
      m.senderId === otherUid && m.status !== 'read' && !chatState._locallyReadIds.has(m.id)
    ).length;
    await sb.from('chat_members').update({ unread_count: remaining })
      .eq('chat_id', chatId).eq('user_id', state.me.uid);

    try { chatState._rt?.sendRead(ids); } catch (_) {}
  } catch (err) {
    ids.forEach(id => chatState._locallyReadIds.delete(id));
    console.error('markThreadRead failed:', err.message);
  }
}

function _flushVisibleReads() {
  chatState._readFlushTimer = null;
  const chatId = state.currentChatId;
  const otherUid = state.currentChatUid;
  if (!chatId || !otherUid || !state.me) { chatState._pendingReadIds.clear(); return; }
  if (document.visibilityState !== 'visible') return;
  if (!$('chatThreadModal')?.classList.contains('show')) return;

  const ids = [...chatState._pendingReadIds];
  chatState._pendingReadIds.clear();
  if (!ids.length) return;
  const msgs = chatState._curMsgs.filter(m => ids.includes(m.id));
  markThreadRead(chatId, otherUid, msgs);
}

function _observeMessagesForRead() {
  const box = $('chatThreadMessages');
  if (!box) return;

  if (!chatState._readObs) {
    chatState._readObs = new IntersectionObserver((entries) => {
      if (document.visibilityState !== 'visible') return;
      if (!$('chatThreadModal')?.classList.contains('show')) return;
      const peer = state.currentChatUid;
      if (!peer) return;
      let any = false;
      for (const e of entries) {
        if (!e.isIntersecting || e.intersectionRatio < 0.4) continue;
        const id = e.target?.dataset?.msgId;
        if (!id) continue;
        if (chatState._locallyReadIds.has(id) || chatState._pendingReadIds.has(id)) continue;
        const m = chatState._curMsgs.find(x => x.id === id);
        if (!m || m.senderId !== peer || m.status === 'read') continue;
        chatState._pendingReadIds.add(id);
        any = true;
      }
      if (any) {
        clearTimeout(chatState._readFlushTimer);
        chatState._readFlushTimer = setTimeout(_flushVisibleReads, READ_FLUSH_MS);
      }
    }, {
      root: box,
      rootMargin: '0px',
      threshold: [0.4, 0.6, 0.85],
    });
  } else {
    try { chatState._readObs.disconnect(); } catch (_) {}
  }

  const peer = state.currentChatUid;
  if (!peer) return;
  box.querySelectorAll('.chat-msg[data-msg-id]').forEach(el => {
    const id = el.dataset.msgId;
    if (!id || chatState._locallyReadIds.has(id)) return;
    const m = chatState._curMsgs.find(x => x.id === id);
    if (m && m.senderId === peer && m.status !== 'read') {
      chatState._readObs.observe(el);
    }
  });
}

function renderTicks(status) {
  // 'sending' = soat (faqat status==='sending' — DB/insert tasdiqlanmaguncha),
  // 'read' = 2 ko'k chek, boshqa (sent/null) = 1 chek. Fake timeout yo'q.
  if (status === 'sending') {
    return `<img src="./svg/ui/ticks-b1f42f.svg" alt="" class="icon msg-ticks sending" width="14" height="14" aria-label="Yuborilmoqda">`;
  }
  if (status === 'read') {
    return `<img src="./svg/ui/ticks-98b8af.svg" alt="" class="icon msg-ticks read" width="18" height="11" aria-label="O'qildi">`;
  }
  // sent (yoki null/undefined — bazadan kelgan)
  return `<img src="./svg/ui/ticks-c46cc2.svg" alt="" class="icon msg-ticks" width="12" height="10" aria-label="Yuborildi">`;
}

/** Faqat status/tick yangilash — to'liq paintMessages YO'Q (tezlik). */
export function updateMsgTicks(id, status) {
  if (!id) return;
  const box = $('chatThreadMessages');
  if (!box) return;
  const el = box.querySelector(`.chat-msg[data-msg-id="${CSS.escape(String(id))}"]`);
  if (!el) return;
  const meta = el.querySelector('.chat-msg-meta');
  if (!meta) return;
  let tick = meta.querySelector('.msg-ticks');
  const html = renderTicks(status);
  if (tick) {
    const tmp = document.createElement('template');
    tmp.innerHTML = html.trim();
    const neu = tmp.content.firstChild;
    if (neu) tick.replaceWith(neu);
  } else {
    meta.insertAdjacentHTML('beforeend', html);
  }
  // local state sync
  const conf = chatState._rtLocal.get(id);
  if (conf) { conf.status = status; conf._at = Date.now(); }
  chatState._curMsgs = chatState._curMsgs.map(m => m.id === id ? { ...m, status } : m);
}


function _dissolvePrepare(box, newIds, canStart) {
  const started = [];
  if (!canStart || !dissolveMarks.size) return started;
  box.querySelectorAll('.chat-msg[data-msg-id]').forEach(el => {
    const id = el.dataset.msgId;
    if (!id || !dissolveMarks.has(id) || newIds.has(id) || chatState._dissolving.has(id)) return;
    let nx = el.nextElementSibling;
    while (nx && !(nx.classList.contains('chat-msg') && newIds.has(nx.dataset.msgId))) nx = nx.nextElementSibling;
    // Animatsiyani to'xtatib o'lchamni saqlaymiz (sakrash/kichrayish bo'lmasin)
    el.style.animation = 'none';
    el.style.transform = 'none';
    el.classList.remove('anim-in');
    el.style.animationDelay = '';
    const r = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * 100) / 100);
    const h = Math.max(1, Math.round(r.height * 100) / 100);
    el.style.boxSizing = 'border-box';
    el.style.width = w + 'px';
    el.style.minWidth = w + 'px';
    el.style.maxWidth = w + 'px';
    el.style.height = h + 'px';
    el.style.minHeight = h + 'px';
    el.style.maxHeight = h + 'px';
    el.style.overflow = 'hidden';
    el.style.flexShrink = '0';
    const bub = el.querySelector('.chat-bubble');
    if (bub) {
      const br = bub.getBoundingClientRect();
      const bw = Math.max(1, Math.round(br.width * 100) / 100);
      const bh = Math.max(1, Math.round(br.height * 100) / 100);
      bub.style.boxSizing = 'border-box';
      bub.style.width = bw + 'px';
      bub.style.minWidth = bw + 'px';
      bub.style.maxWidth = bw + 'px';
      bub.style.height = bh + 'px';
      bub.style.minHeight = bh + 'px';
      bub.style.flexShrink = '0';
    }
    el.classList.add('msg-dissolving');
    const rec = { id, el, nextId: nx ? nx.dataset.msgId : null };
    chatState._dissolving.set(id, rec);
    started.push(rec);
    dissolveMarks.delete(id);
  });
  return started;
}
function _dissolveRestore(box, started) {
  if (!chatState._dissolving.size) return;
  for (const rec of chatState._dissolving.values()) {
    if (rec.el.parentNode === box) continue;
    let ref = null;
    if (rec.nextId) {
      const q = (window.CSS && CSS.escape) ? CSS.escape(rec.nextId) : rec.nextId;
      ref = box.querySelector(`.chat-msg[data-msg-id="${q}"]`);
      if (ref && ref.previousElementSibling?.classList.contains('chat-date-sep')) ref = ref.previousElementSibling;
    }
    box.insertBefore(rec.el, ref);
  }
  if (!started.length) return;
  const group = dissolveGroupInfo(started.map(r => r.el));
  started.forEach(rec => {
    playDeleteDissolve(rec.el, undefined, undefined, group)
      .catch(() => {})
      .finally(() => {
        chatState._dissolving.delete(rec.id);
        try { rec.el.remove(); } catch (_) {}
        if (!chatState._dissolving.size && !chatState._curMsgs.length) paintMessages([]);
      });
  });
}
function _isFreshMsg(m) {
  const d = _toDateSafe(m.createdAt);
  return !d || (Date.now() - d.getTime()) < 30000;   // eski (keshdan/oflayndan kelgan) xabar animatsiya qilinmaydi
}

/* Sana yordamchilari: chat-shared.js */

/** Foydalanuvchi chat pastida "yopishib" turganini kuzatadi (rasm kech yuklansa ham pastda qolsin) */
function _bindPinTracking(box) {
  if (box._pinBound) return;
  box._pinBound = true;
  box.addEventListener('scroll', () => {
    chatState._pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  }, { passive: true });
}
window._chatImgLoaded = function (img) {
  try { rememberImgRatio(img); } catch (_) {}
  const box = document.getElementById('chatThreadMessages');
  if (!box || !chatState._pinned || !box.contains(img)) return;
  // faqat haqiqatan pastda bo'lsak — aks holda o'qiyotganda sakramasin
  const gap = box.scrollHeight - box.scrollTop - box.clientHeight;
  if (gap < 160) box.scrollTop = box.scrollHeight;
};

/** Xabarlar DOM'ini kalit (xabar id) bo'yicha yamaydi: bir xil HTML — o'sha element qoladi */
function _patchMessages(box, parts, keys) {
  const prev = box._parts instanceof Map ? box._parts : new Map();
  const next = new Map();
  const finalNodes = [];
  const tpl = document.createElement('template');
  parts.forEach((html, i) => {
    let key = keys[i] || ('i' + i);
    if (next.has(key)) key += '#' + i;
    const old = prev.get(key);
    // animatsiya klassi/kechikishi o'zgarishi elementni qayta yaratishga sabab bo'lmasin
    const cmp = html.replace(' anim-in', '').replace(/ style="animation-delay:-?\d+ms"/, '');
    let nodes;
    if (old && old.html === cmp && old.nodes.every(n => n.parentNode === box)) {
      nodes = old.nodes;
    } else {
      tpl.innerHTML = html;
      nodes = Array.from(tpl.content.children);
    }
    next.set(key, { html: cmp, nodes });
    for (const n of nodes) finalNodes.push(n);
  });
  const keep = new Set(finalNodes);
  Array.from(box.childNodes).forEach(n => { if (!keep.has(n)) box.removeChild(n); });
  let cur = box.firstChild;
  for (const n of finalNodes) {
    if (n === cur) cur = cur.nextSibling;
    else box.insertBefore(n, cur);
  }
  box._parts = next;
}

/** Ko'rinadigan birinchi xabarni (id + viewport tepasidan masofa) eslab qoladi */
function _captureMsgAnchor(box) {
  const top = box.getBoundingClientRect().top;
  for (const el of box.querySelectorAll('.chat-msg[data-msg-id]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > top + 1) return { id: el.dataset.msgId, off: r.top - top };
  }
  return null;
}
function _restoreMsgAnchor(box, a) {
  if (!a || !a.id) return;
  const el = box.querySelector(`.chat-msg[data-msg-id="${CSS.escape(a.id)}"]`);
  if (!el) return;
  const off = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
  const d = off - a.off;
  if (Math.abs(d) > 0.5) box.scrollTop += d;
}

/* ── Chat ochilganda oxirgi media ni oldindan yuklash ───────────────────
 * Eng yangi 5 ta ovoz + 5 ta rasm (yoki undan kam bo'lsa boricha).
 * Brauzer HTTP keshiga tushadi — keyin bosilganda darhol ochiladi.
 */
const _preloadedMediaUrls = new Set();
const PRELOAD_VOICE_N = 5;
const PRELOAD_IMAGE_N = 5;

function _isChatImageMsg(m) {
  if (!m || m.type !== 'file') return false;
  const mime = (m.mediaType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const ext = (m.fileName || '').toLowerCase().split('.').pop() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'heic', 'heif'].includes(ext);
}

function preloadRecentChatMedia(msgs) {
  if (!Array.isArray(msgs) || !msgs.length) return;
  const voices = [];
  const images = [];
  // msgs odatda eski → yangi; oxiridan boshlab eng yangilarini olamiz
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const url = (m.mediaUrl || '').trim();
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) continue;
    if (m.type === 'voice' && voices.length < PRELOAD_VOICE_N) {
      if (!voices.includes(url)) voices.push(url);
    } else if (_isChatImageMsg(m) && images.length < PRELOAD_IMAGE_N) {
      if (!images.includes(url)) images.push(url);
    }
    if (voices.length >= PRELOAD_VOICE_N && images.length >= PRELOAD_IMAGE_N) break;
  }
  // Kesh o'sib ketmasin
  if (_preloadedMediaUrls.size > 80) _preloadedMediaUrls.clear();

  for (const url of voices) {
    if (_preloadedMediaUrls.has(url)) continue;
    _preloadedMediaUrls.add(url);
    // fetch → HTTP cache (Audio ham shu keshdan oladi)
    fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' }).catch(() => {
      // CORS yoki tarmoq xatosi — jim o'tkazamiz
      fetch(url, { mode: 'no-cors', cache: 'force-cache' }).catch(() => {});
    });
  }
  for (const url of images) {
    if (_preloadedMediaUrls.has(url)) continue;
    _preloadedMediaUrls.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = url;
  }
}


/** Telegram-style reply quote inside bubble */
function _replyQuoteHtml(m, msgs, grp) {
  const rid = m.replyTo || m.reply_to;
  if (!rid) return '';
  // Prefer stored preview (optimistic), else look up in current list
  let name = m.replyPreview?.name;
  let preview = m.replyPreview?.text;
  let rtype = m.replyPreview?.type;
  if (!name || !preview) {
    const orig = (msgs || []).find(x => x.id === rid);
    if (orig) {
      name = name || (orig.senderId === state.me?.uid ? 'Siz' : (grp?.names?.[orig.senderId]?.fullName || $('chatThreadName')?.textContent || 'Foydalanuvchi'));
      if (orig.type === 'voice') preview = preview || 'Ovozli xabar';
      else if (orig.type === 'file') preview = preview || (orig.fileName || 'Fayl');
      else preview = preview || (orig.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      rtype = rtype || orig.type;
    } else {
      name = name || 'Xabar';
      preview = preview || 'O‘chirilgan xabar';
    }
  }
  if (!preview) preview = 'Xabar';
  return `<div class="msg-reply-quote" data-reply-to="${esc(rid)}">
    <div class="mrq-bar"></div>
    <div class="mrq-body">
      <div class="mrq-name">${esc(name)}</div>
      <div class="mrq-text">${esc(preview)}</div>
    </div>
  </div>`;
}
export function paintMessages(msgs, grp = null) {
  const box = $('chatThreadMessages');
  if (!box) return;
  chatState._curMsgs = msgs;

  if (!msgs.length) {
    const _dsE = _dissolvePrepare(box, new Set(), chatState._seenBaselineDone);
    chatState._seenBaselineDone = true;
    box._parts = null;
    box.innerHTML = chatState._dissolving.size ? '' : `<div class="empty pt-30vh tac">
      <div class="fs-14px fw-600 c-text mb-6px">Hozircha xabarlar yo'q</div>
      <div class="fs-13px c-text2">Salom bering</div>
    </div>`;
    _dissolveRestore(box, _dsE);
    msgMenuAfterPaint();
    _observeMessagesForRead();
    return;
  }

  const prevCount = box.querySelectorAll('.chat-msg').length;
  // Foydalanuvchi pastda (eng oxirgi xabarlarda) turganini tekshiramiz
  // threshold: pastdan 120px uzoqda bo'lsa "pastda" hisoblanadi
  const isAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const isInitialLoad = prevCount === 0;
  _bindPinTracking(box);
  const _baseline = !chatState._seenBaselineDone;   // shu chatning birinchi chizilishi — animatsiyasiz
  chatState._seenBaselineDone = true;

  const _dsStarted = _dissolvePrepare(box, new Set(msgs.map(m => String(m.id))), !_baseline);
  // Yuqorida turgan bo'lsak: ko'rinib turgan birinchi xabarni "langar" qilib eslab qolamiz,
  // qayta chizilgach shu xabarni oldingi joyiga qaytaramiz (sakrash bo'lmasin)
  const _anchor = (!isAtBottom && !isInitialLoad) ? _captureMsgAnchor(box) : null;
  let _myNewMsg = false;   // shu chizishda MENING yangi (ilgari chizilmagan) xabarim paydo bo'ldimi
  const _parts = msgs.map((m, idx) => {
    const mine = m.senderId === state.me?.uid;
    const time = fmtTime(m.createdAt);
    let bubbleContent = '';
    let emoCls = '';
    let bubbleClassExtra = '';
    let metaOutside = true;

    if (m.type === 'voice') {
      /* ── Voice message ── */
      const voiceMedia = { url: getLocalVoiceUrl(m.id) || m.mediaUrl || '', duration: m.duration || 0 };
      const dur = voiceMedia.duration ? fmtVoiceDur(voiceMedia.duration) : '0:00';
      const barCount = _voiceBarCount(voiceMedia.duration);
      const safeUrl = (voiceMedia.url || '').replace(/"/g, '&quot;');
      // Serverdagi to'lqin bor bo'lsa — decode/fetch kerak emas (barlar darhol to'g'ri chiziladi)
      if (Array.isArray(m.waveform) && m.waveform.length) primeWaveform(voiceMedia.url, barCount, m.waveform);
      const _mpName = (mine ? 'Siz' : (grp ? (grp.names?.[m.senderId]?.fullName || 'Ovozli xabar') : ($('chatThreadName')?.textContent || 'Ovozli xabar'))).replace(/"/g, '&quot;');
      bubbleContent = generateVoiceBubble({ voiceMedia, dur, barCount, safeUrl, _mpName, renderVoiceWave, waveReadyClass, idx, state });
    } else if (m.type === 'file') {
      /* ── File message ── */
      const fname = esc(m.fileName || 'file');
      const fsz = m.fileSize ? fmtSz(m.fileSize) : '';
      const safeUrl = (m.mediaUrl || '').replace(/"/g, '&quot;');
      const _ext = (m.fileName || '').toLowerCase().split('.').pop() || '';
      const _mime = (m.mediaType || '').toLowerCase();
      const _isImage = _mime.startsWith('image') || ['jpg','jpeg','png','gif','webp','svg','avif'].includes(_ext);
      const hasCaption = !!(m.text && m.text.trim());
      const captionHtml = hasCaption ? `<div class="chat-bubble-text cfm-caption">${renderMarkdown(m.text)}</div>` : '';
      
      const bData = generateFileBubble({ m, fname, fsz, safeUrl, _isImage, hasCaption, captionHtml, time, mine, renderTicks, when: `${_dateSepLabel(m.createdAt)}, ${time}`, dm: !grp });
      bubbleClassExtra = bData.bubbleClassExtra;
      metaOutside = bData.metaOutside;
      bubbleContent = bData.bubbleContent;
    } else {
      /* ── Text message ── */
      const callLog = grp ? null : parseCallLog(m.text);
      if (callLog) {
        /* ── Qo'ng'iroq yozuvi ── */
        const cData = generateCallBubble({ cl: callLog, mine, time });
        bubbleClassExtra = cData.bubbleClassExtra;
        bubbleContent = cData.bubbleContent;
        metaOutside = false;
      } else {
        const postShare = parsePostShare(m.text);
        const bData = generateTextBubble({ m, postShare, renderChatPostCard, wrapEmojiNoSelect, renderMarkdown, emojiOnlyClass });
        bubbleClassExtra = bData.bubbleClassExtra;
        bubbleContent = bData.bubbleContent;
        emoCls = bData.emoCls;
      }
    }

    // ID asosida "yangi"lik: shu xabar ID'si ilgari chizilmagan bo'lsagina
    // bounce animatsiyasi beriladi (status/audioUrl kabi maydon
    // yangilanishlari eski xabarlarni qayta "bounce" qilib yubormaydi).
    let isNew = false, animStyle = '';
    if (m.id) {
      const _nowT = Date.now();
      if (!chatState._seenMsgIds.has(m.id)) {
        chatState._seenMsgIds.add(m.id);
        // yangi xabar (kelgan ham, o'zimniki ham; id bir xil bo'lgani uchun optimistik->server almashinuvda qayta o'ynamaydi)
        if (!_baseline && _isFreshMsg(m)) { chatState._msgAnimStart.set(m.id, _nowT); isNew = true; if (mine) _myNewMsg = true; }
      } else {
        // animatsiya payti repaint bo'lsa (status/tick) — to'xtab qolmasin, qolgan joyidan davom etsin
        const _t0 = chatState._msgAnimStart.get(m.id);
        if (_t0 && _nowT - _t0 < MSG_ANIM_MS) { isNew = true; animStyle = ` style="animation-delay:-${_nowT - _t0}ms"`; }
      }
    }

    // Guruh: faqat boshqa foydalanuvchi xabarlarida yuboruvchi ismi
    let gHead = '';
    if (grp && !mine) {
      const sn = grp.names?.[m.senderId]?.fullName || 'Foydalanuvchi';
      const _role = grp.names?.[m.senderId]?.role;
      gHead = `<div class="grp-sender-name" data-uid="${esc(m.senderId)}"><span class="grp-sn-text">${esc(sn)}</span>${_role ? `<span class="grp-role">${_role === 'owner' ? 'owner' : 'admin'}</span>` : ''}</div>`;
    }

    // Kun almashgan bo'lsa — Telegram uslubidagi "Bugun"/"Kecha"/sana pill'i
    let dateSep = '';
    const prevMsg = msgs[idx - 1];
    const curDate  = _toDateSafe(m.createdAt);
    const prevDate = prevMsg ? _toDateSafe(prevMsg.createdAt) : null;
    if (curDate && (!prevDate || !_isSameDay(curDate, prevDate))) {
      dateSep = `<div class="chat-date-sep"><span>${_dateSepLabel(m.createdAt)}</span></div>`;
    }

    // Guruh: yuboruvchi avatari — shu odamning ketma-ket xabarlari seriyasining BIRINCHI xabarida (qolganlarida bo'sh joy)
    let gAvi = '';
    if (grp && !mine) {
      if (!prevMsg || prevMsg.senderId !== m.senderId || dateSep) {
        const _pr = grp.names?.[m.senderId] || {};
        const _nm = _pr.fullName || 'Foydalanuvchi';
        gAvi = `<button type="button" class="msg-avi-btn grp-avi" data-uid="${esc(m.senderId)}" title="${esc(_nm)}" aria-label="${esc(_nm)}"><img src="${esc(_pr.avatar || defAvi(_nm))}" data-n="${esc(_nm)}" alt="" loading="lazy" draggable="false"></button>`;
      } else {
        gAvi = '<span class="grp-avi-gap" aria-hidden="true"></span>';
      }
    }

    const outerMeta = metaOutside ? `<span class="chat-msg-meta">
      ${m.editedAt ? '<span class="chat-msg-edited">tahrirlangan</span>' : ''}<span class="chat-msg-time">${time}</span>
      ${mine ? renderTicks(m.status) : ''}
    </span>` : '';

    const replyHtml = _replyQuoteHtml(m, msgs, grp);
    const bubbleHtml = wrapChatBubble({ bubbleContent, bubbleClassExtra, outerMeta, gHead, replyHtml });
    return assembleMessageHtml({
      dateSep, mine, isNew, emoCls, msgId: m.id || '', animStyle, bubbleHtml, gAvi,
    });
  });
  // Butun DOM'ni qayta yozmaymiz: o'zgarmagan xabarlar o'sha elementlarida qoladi
  // (rasm/avatar qayta yuklanmaydi, miltillash va sakrash yo'q). Faqat o'zgarganlari almashadi.
  _patchMessages(box, _parts, msgs.map(m => String(m.id || '')));

  _dissolveRestore(box, _dsStarted);
  _restoreMsgAnchor(box, _anchor);

  // Faqat pastda turgan bo'lsak yoki chat yangi ochilgan bo'lsa scroll qilamiz
  // Faqat haqiqatan yangi yuborilgan xabarimda (status/tick/reaksiya repaint'ida emas) — tepada o'qib turganda pastga otib yubormasin
  const hasMyNew = _myNewMsg;
  if (isAtBottom || isInitialLoad || hasMyNew) {
    chatState._pinned = true;
    box.scrollTop = box.scrollHeight;
    // Bitta rAF — layout keyin; ikkinchi setTimeout sakrash berardi
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }

  // "theirs" xabarlaridagi avatar bosilganda profil ochamiz
  box.querySelectorAll('.grp-sender-name[data-uid]').forEach(el => {
    if (el._bound) return; el._bound = true;
    el.style.cursor = 'pointer';
    el.addEventListener('click', async () => {
      const { openUserProfileModal } = await import('../profile/profile.js');
      openUserProfileModal(el.dataset.uid);
    });
  });
  // Guruh avatari yuklanmasa — bosh harfli standart avatar
  box.querySelectorAll('.grp-avi img').forEach(im => {
    if (im._eb) return; im._eb = true;
    im.addEventListener('error', () => { im.onerror = null; im.src = defAvi(im.dataset.n || '?'); }, { once: true });
  });
  box.querySelectorAll('.msg-avi-btn').forEach(btn => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      if (!uid) return;
      const { openUserProfileModal } = await import('../profile/profile.js');
      openUserProfileModal(uid);
    });
  });

  // Voice xabarlar uchun — haqiqiy waveform balandliklarini fonda yuklaymiz
  _hydrateVoiceWaveforms(box);

  // BUG FIX: paintMessages() har qanday Firestore yozuvida (masalan
  // _attachSecondaryVoice orqali fon rejimida ikkinchi jins ovozi
  // qo'shilganda) butun DOM'ni qayta chizadi. Agar shu paytda audio
  // fonda ijro etilayotgan bo'lsa (_activeAudio), eski <button> DOM
  // elementi yo'q qilinadi va _activeBtn "orfan" obyektga aylanadi —
  // natijada yangi tugma har doim "Play" holatida chiqadi, garchi
  // audio haqiqatan hali ham ijro etilayotgan bo'lsa ham. Shu yerda
  // faol ijro holatini yangi chizilgan DOM ichidan data-url bo'yicha
  // qidirib topilgan tugma/waveform'ga qayta bog'laymiz.
  _reattachActiveVoiceUI(box);
  msgMenuAfterPaint();
  // Faqat viewportdagi (ko'rinadigan) xabarlar o'qilgan bo'ladi
  _observeMessagesForRead();
  checkSharedPostExistence(msgs);
  // Oxirgi 5 ovoz + 5 rasmni fonda yuklab qo'yamiz (boricha)
  preloadRecentChatMedia(msgs);
}

/** Guruh thread'i shu yagona painter bilan chiziladi (DM bilan bir xil UI/mantiq) */
export function paintGroupThread(msgs, names) { paintMessages(msgs, { names: names || {} }); }
/** Guruh almashganda "yangi xabar" animatsiyasi hisobini boshidan boshlash */
export function resetSeenMsgs(key) {
  if (chatState._seenMsgIdsChatId !== key) { chatState._seenMsgIds = new Set(); chatState._seenMsgIdsChatId = key; chatState._seenBaselineDone = false; chatState._msgAnimStart.clear(); chatState._dissolving.clear(); dissolveMarks.clear(); }
}

/**
 * Agar hozir biror ovozli xabar ijro etilayotgan/pauza holatida bo'lsa
 * (_activeAudio hali mavjud), paintMessages() repaint qilganidan keyin
 * uning UI holatini (tugma ikonkasi, waveform progress, davomiylik) yangi
 * DOM elementlariga qayta bog'laydi. _activeBtn eski (endi DOM'dan
 * o'chirilgan) tugmaga ishora qilib qolmasligi uchun uni ham yangilaymiz.
 */
/* ── Yopish chat thread ───────────────────────────────────────────────── */
export function closeChatThread() {
  try { forceStopVoiceRecording(); } catch (err) {}
  _teardownReadObserver();
  chatState._locallyReadIds.clear();
  document.getElementById('chatHeaderDropdown')?.remove();
  document.getElementById('groupJoinBar')?.remove();
  document.dispatchEvent(new Event('chatmedia:close'));
  if (chatState._rt) { chatState._rt.close(); chatState._rt = null; }
  chatState._rtLocal.clear(); chatState._rtRead.clear(); chatState._rtChatId = null;
  msgMenuReset();
  if (chatState._threadUnsub) { chatState._threadUnsub(); chatState._threadUnsub = null; }
  if (chatState._peerUserUnsub) { chatState._peerUserUnsub(); chatState._peerUserUnsub = null; }
  if (chatState._peerStatusTick) { clearInterval(chatState._peerStatusTick); chatState._peerStatusTick = null; }
  clearTimeout(chatState._typingTimeout);
  _setTyping(false);
  if (chatState._chatDocUnsub) { chatState._chatDocUnsub(); chatState._chatDocUnsub = null; }
  chatState._iAmTyping = false;
  chatState._peerTyping = false;
  // If in group/channel mode, cleanup group state too
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    closeGroupThread();
  }
  state.currentChatUid = null;
  state.currentChatId  = null;
  const modal = $('chatThreadModal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.bottom = '0px';
  }
  // Chat ro'yxatini yangilash — oxirgi xabar/preview yangi bo'lishi uchun
  if (state.view === 'chats') renderChatsList();
  // Ovoz hali ijro etilayotgan bo'lsa — endi bu chat yopilgani uchun
  // mini-pleer bar ko'rinishi kerak (ovozning o'zi to'xtamaydi).
  try { _syncMiniPlayer(); } catch (_) {}
}

/* ── Send message ────────────────────────────────────────────────────── */


/* ── Helpers for new features ───────────────────────────────────────── */



/* ── Chat file attach ──────────────────────────────────────────────────── */
function setChatFile(file) {
  if (!isAllowedUpload(file)) {
    import('../ui/toast.js').then(m => m.toast(UPLOAD_DENIED_MSG, 'error'));
    $('chatFileInput') && ($('chatFileInput').value = '');
    return;
  }
  if (file.size > MAX_FILE) {
    import('../ui/toast.js').then(m => m.toast('Fayl hajmi 50 MB dan oshmasligi kerak', 'error'));
    return;
  }
  chatState._chatSelFile = file;
  $('cfpIcon').innerHTML = getChatFileIcon(file.name, file.type);
  $('cfpName').textContent = file.name.length > 36 ? file.name.slice(0, 34) + '…' : file.name;
  $('cfpSize').textContent = fmtSz(file.size);
  $('chatFilePreview').classList.add('active');
  updateVoiceSendBtn();
}

export function clearChatFile() {
  chatState._chatSelFile = null;
  $('chatFilePreview').classList.remove('active');
  $('chatFileInput').value = '';
  updateVoiceSendBtn();
}

/* ── Chat post attach (postni chatga ulashish) ────────────────────────── */

export function setPendingPostShare(payload) {
  chatState._pendingPostShare = payload;
  updatePostAttachBar();
}
export function getPendingPostShare() {
  return chatState._pendingPostShare;
}
export function clearPendingPostShare() {
  chatState._pendingPostShare = null;
  updatePostAttachBar();
}
export function updatePostAttachBar() {
  const bar = $('chatPostAttachBar');
  if (!bar) return;
  if (chatState._pendingPostShare) {
    bar.style.display = 'flex';
    bar.classList.add('active');
    const authorEl = $('cpabAuthor');
    if (authorEl) {
      authorEl.textContent = chatState._pendingPostShare.authorName + (chatState._pendingPostShare.authorUsername ? (' @' + chatState._pendingPostShare.authorUsername) : '');
    }
    const textEl = $('cpabText');
    if (textEl) {
      textEl.textContent = chatState._pendingPostShare.text || (chatState._pendingPostShare.mediaUrl ? 'Rasm' : 'Post');
    }
    const thumbEl = $('cpabThumb');
    if (thumbEl) {
      if (chatState._pendingPostShare.mediaUrl) {
        thumbEl.style.display = 'block';
        thumbEl.innerHTML = `<img src="${esc(chatState._pendingPostShare.mediaUrl)}" alt="thumb">`;
      } else {
        thumbEl.style.display = 'none';
        thumbEl.innerHTML = '';
      }
    }
  } else {
    bar.style.display = 'none';
    bar.classList.remove('active');
  }
  updateVoiceSendBtn();
}

/* parsePostShare / formatLastMessageText: chat-shared.js */

 // postId -> boolean (true: mavjud, false: o'chirilgan)
 // userId -> boolean (true: mavjud, false: o'chirilgan)

export function checkSharedPostExistence(msgs) {
  if (!msgs || !msgs.length || typeof sb === 'undefined') return;
  const pids = [];
  const uids = [];
  for (const m of msgs) {
    const ps = parsePostShare(m.text);
    if (ps?.post) {
      if (ps.post.id && !chatState._postExistenceMap.has(ps.post.id)) pids.push(ps.post.id);
      if (ps.post.userId && !chatState._userExistenceMap.has(ps.post.userId)) uids.push(ps.post.userId);
    }
  }
  if (!pids.length && !uids.length) return;

  const queries = [];
  if (pids.length) {
    queries.push(sb.from('posts').select('id').in('id', pids).then(({ data, error }) => {
      if (!error && data) {
        const found = new Set(data.map(x => x.id));
        pids.forEach(id => chatState._postExistenceMap.set(id, found.has(id)));
      }
    }).catch(() => {}));
  }
  if (uids.length) {
    queries.push(sb.from('profiles').select('id').in('id', uids).then(({ data, error }) => {
      if (!error && data) {
        const found = new Set(data.map(x => x.id));
        uids.forEach(id => chatState._userExistenceMap.set(id, found.has(id)));
      }
    }).catch(() => {}));
  }

  Promise.all(queries).then(() => {
    _updatePostCardsInDOM();
  });
}

function _updatePostCardsInDOM() {
  const _box = document.getElementById('chatThreadMessages');
  const _wasBottom = _box && (_box.scrollHeight - _box.scrollTop - _box.clientHeight < 120);
  const _anch = (_box && !_wasBottom) ? _captureMsgAnchor(_box) : null;
  const cards = document.querySelectorAll('.chat-post-card[data-post-id]');
  cards.forEach(card => {
    const pid = card.dataset.postId;
    const uid = card.dataset.userId;
    const isPostDeleted = chatState._postExistenceMap.get(pid) === false;
    const isUserDeleted = chatState._userExistenceMap.get(uid) === false;

    if (isPostDeleted) {
      card.classList.add('post-deleted');
      const badge = card.querySelector('.cpc-badge');
      if (badge) {
        badge.classList.add('is-deleted');
        const span = badge.querySelector('span');
        if (span) span.textContent = "O'chirilgan post";
      }
      const caption = card.querySelector('.cpc-caption');
      if (caption) {
        caption.innerHTML = `<span class="cpc-deleted-text">Bu post o'chirilgan</span>`;
      }
      const media = card.querySelector('.cpc-media');
      if (media) { media.classList.add('is-deleted'); const _im = media.querySelector('img'); if (_im) _im.style.visibility = 'hidden'; }

      const btn = card.querySelector('.cpc-open-btn');
      if (btn) {
        btn.classList.add('is-deleted');
        btn.innerHTML = `<span>Post o'chirilgan</span>`;
        btn.onclick = (e) => {
          e.stopPropagation();
          toast("Bu post o'chirilgan", 'error');
        };
      }
      const content = card.querySelector('.cpc-content');
      if (content) {
        content.classList.add('is-deleted');
        content.onclick = (e) => {
          e.stopPropagation();
          toast("Bu post o'chirilgan", 'error');
        };
      }
    }

    if (isUserDeleted) {
      card.classList.add('user-deleted');
      const avi = card.querySelector('.cpc-avi');
      if (avi) avi.classList.add('is-deleted');
      const authorName = card.querySelector('.cpc-author-name');
      if (authorName && !authorName.querySelector('.cpc-del-tag')) {
        authorName.classList.add('is-deleted');
        authorName.innerHTML += ` <span class="cpc-del-tag">(O'chirilgan hisob)</span>`;
      }
      const authorHandle = card.querySelector('.cpc-author-handle');
      if (authorHandle) authorHandle.classList.add('is-deleted');
    }
  });
  if (_wasBottom && _box) _box.scrollTop = _box.scrollHeight;
  else if (_anch && _box) _restoreMsgAnchor(_box, _anch);
}

export function renderChatPostCard(ps) {
  const p = ps.post || {};
  const comment = (ps.comment || '').trim();
  const authorName = esc(p.authorName || 'Foydalanuvchi');
  const authorUser = p.authorUsername ? `@${esc(p.authorUsername)}` : '';
  const authorAvi = p.authorAvatar ? esc(p.authorAvatar) : '';
  const postText = (p.text || '').trim();
  const mediaUrl = p.mediaUrl ? esc(p.mediaUrl) : '';
  // ID'lar inline onclick JS satriga tushadi — faqat UUID/raqam belgilariga ruxsat (esc bu kontekstda yetarli emas)
  const postId = String(p.id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const userId = String(p.userId || '').replace(/[^A-Za-z0-9_-]/g, '');

  const isPostDeleted = chatState._postExistenceMap.get(p.id) === false;
  const isUserDeleted = chatState._userExistenceMap.get(p.userId) === false;

  let mediaHtml = '';
  if (mediaUrl && !isPostDeleted) {
    mediaHtml = `
      <div class="cpc-media">
        <img src="${esc(mediaUrl)}" alt="Post media" loading="lazy">
      </div>`;
  }

  const commentHtml = comment ? `
    <div class="cpc-comment">
      <div class="chat-bubble-text">${renderMarkdown(comment)}</div>
    </div>` : '';

  const captionHtml = isPostDeleted
    ? `<div class="cpc-caption"><span class="cpc-deleted-text">Bu post o'chirilgan</span></div>`
    : (postText ? `<div class="cpc-caption">${renderMarkdown(postText)}</div>` : '');

  const btnHtml = isPostDeleted
    ? `<button type="button" class="cpc-open-btn is-deleted" onclick="event.stopPropagation(); toast('Bu post o\\'chirilgan', 'error');">
         <span>Post o'chirilgan</span>
       </button>`
    : `<button type="button" class="cpc-open-btn" onclick="event.stopPropagation(); window._openPostFromChat && window._openPostFromChat('${postId}')">
         <span>Postni ko'rish</span>
         <img src="./svg/extra/icon-938c12a9f405.svg" alt="" class="icon" width="13" height="13">
       </button>`;

  const badgeTitle = isPostDeleted ? "O'chirilgan post" : "Ulashilgan post";

  const cardClasses = [
    'chat-post-card',
    isPostDeleted ? 'post-deleted' : '',
    isUserDeleted ? 'user-deleted' : ''
  ].filter(Boolean).join(' ');

  const contentOnClick = isPostDeleted
    ? `toast('Bu post o\\'chirilgan', 'error')`
    : `window._openPostFromChat && window._openPostFromChat('${postId}')`;

  return `
    <div class="${cardClasses}" data-post-id="${postId}" data-user-id="${userId}">
      <div class="cpc-header">
        <div class="cpc-badge${isPostDeleted ? ' is-deleted' : ''}">
          <img src="./svg/action/send.svg" alt="" class="icon" width="12" height="12">
          <span>${badgeTitle}</span>
        </div>
      </div>
      <div class="cpc-content${isPostDeleted ? ' is-deleted' : ''}" onclick="${contentOnClick}">
        <div class="cpc-author-row">
          <div class="cpc-avi${isUserDeleted ? ' is-deleted' : ''}">
            ${authorAvi ? `<img src="${esc(authorAvi)}" alt="${authorName}" onerror="this.style.display='none'">` : `<div class="cpc-avi-placeholder">${authorName.charAt(0)}</div>`}
          </div>
          <div class="cpc-author-meta">
            <span class="cpc-author-name${isUserDeleted ? ' is-deleted' : ''}">${authorName}${isUserDeleted ? ' <span class="cpc-del-tag">(O\'chirilgan hisob)</span>' : ''}</span>
            ${authorUser ? `<span class="cpc-author-handle${isUserDeleted ? ' is-deleted' : ''}">${authorUser}</span>` : ''}
          </div>
        </div>
        ${captionHtml}
        ${mediaHtml}
        <div class="cpc-open-row">
          ${btnHtml}
        </div>
      </div>
      ${commentHtml}
    </div>
  `;
}

window._openPostFromChat = async function(postId) {
  if (!postId) return;
  if (chatState._postExistenceMap.get(postId) === false) {
    toast("Bu post o'chirilgan", "error");
    return;
  }
  // Post mavjudligini bazadan tezkor tekshiramiz
  try {
    const { data } = await sb.from('posts').select('id').eq('id', postId).maybeSingle();
    if (!data) {
      chatState._postExistenceMap.set(postId, false);
      _updatePostCardsInDOM();
      toast("Bu post o'chirilgan", "error");
      return;
    }
    chatState._postExistenceMap.set(postId, true);
  } catch (_) {}

  try {
    closeChatThread();
  } catch (_) {}
  // Post linkini ochish bilan bir xil mantiq (feed.js: openPostLink) — boshqa hech narsa emas
  const { openPostLink } = await import('../feed/feed.js');
  openPostLink(postId);
};

/** Xabar maydoni qatorlar soniga qarab balandlashadi (max ~7 qator, undan keyin ichida skroll). */
const _INPUT_MAX_H = 144;
export function autoGrowChatInput() {
  const el = $('chatThreadInput');
  if (!el) return;
  el.style.height = 'auto';
  const h = el.scrollHeight;
  if (!h) { el.style.height = ''; return; }   // modal yopiq (display:none) — o'lchab bo'lmaydi
  const _msgBox = $('chatThreadMessages');
  const _stick = !!(_msgBox && chatState._pinned);
  el.style.height = Math.min(h, _INPUT_MAX_H) + 'px';
  el.style.overflowY = h > _INPUT_MAX_H ? 'auto' : 'hidden';
  // Yozish maydoni balandligi o'zgarsa xabarlar oynasi ham o'zgaradi — pastda turgan bo'lsak pastda qolamiz
  if (_stick) _msgBox.scrollTop = _msgBox.scrollHeight;
}
window.addEventListener('resize', autoGrowChatInput);

export function updateVoiceSendBtn() {
  autoGrowChatInput();
  const inp  = $('chatThreadInput');
  const hasText = inp?.value?.trim().length > 0;
  const hasFile = !!chatState._chatSelFile;
  const hasPost = !!chatState._pendingPostShare;
  const showSend = hasText || hasFile || hasPost || !canRecordMedia();   // mic ham, kamera ham yo'q → doim yuborish tugmasi
  const mic  = $('chatVoiceBtn').querySelector('.icon-mic');
  const send = $('chatVoiceBtn').querySelector('.icon-send');
  if (mic)  mic.style.display  = showSend ? 'none'  : '';
  if (send) send.style.display = showSend ? ''      : 'none';
  $('chatVoiceBtn').classList.toggle('is-send', showSend);   // yuborish holati: doirasiz, ko'k samolyot
}




/* ── Optimistic voice bubble (0ms local blob → keyin Supabase) ───────── */
export function _showOptimisticVoiceBubble(id, localUrl, duration) {
  const box = $('chatThreadMessages');
  if (!box) return;
  const dur = duration ? fmtVoiceDur(duration) : '0:00';
  const barCount = _voiceBarCount(duration);
  const safeUrl = String(localUrl || '').replace(/"/g, '"');
  const time = fmtTime(Date.now());
  const el = document.createElement('div');
  el.className = 'chat-msg mine anim-in';
  el.id = id;
  el.dataset.optimistic = '1';
  el.innerHTML = generateOptimisticVoiceHtml({
    safeUrl,
    duration,
    barCount,
    dur,
    time,
    chatId: state.currentChatId || '',
    chatUid: state.currentChatUid || '',
    renderVoiceWave,
    renderTicks,
  });
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  // Waveformni darhol local blob dan hydrate qilish
  _hydrateVoiceWaveforms(box);
}

/* Pending bubble + uploadViaControllerProgress: chat-shared.js */

/* ── Wire static DOM (modal already exists in index.html on page load) ── */
$('chatThreadBack').onclick = closeChatThread;

// Xabar kontekst menyusi (o'ng tugma / mobilda bosib turish) — modules/msg-menu.js
initMsgMenu({
  box: $('chatThreadMessages'),
  getMsgs: () => chatState._curMsgs,
  // Moderator: sayt admini yoki shu guruhning owner/admini — boshqalarning xabarini ham o'chira oladi
  canModerate: () => isAdmin() || (state.currentChatKind === 'group' && !!chatUI.isGroupModerator?.()),
  reload: () => { if (state.currentChatKind && state.currentChatKind !== 'dm') reloadGroupThread(); else if (chatState._reloadThread) chatState._reloadThread(); },
  markSent: (id) => {
    const conf = chatState._rtLocal.get(id);
    if (conf) { conf.status = 'sent'; conf._at = Date.now(); chatState._rtLocal.set(id, conf); }
    paintMessages(chatState._curMsgs.map(m => m.id === id ? { ...m, status: 'sent' } : m));
  },
  // Optimistic delete: UI dan darhol olib tashlash (dissolve ishlashi uchun markDissolve oldindan chaqirilgan)
  applyLocalDelete: (ids) => {
    const set = new Set((ids || []).map(String));
    if (!set.size) return;
    ids.forEach(id => { try { chatState._rtLocal.delete(id); } catch (_) {} });
    const next = chatState._curMsgs.filter(x => !set.has(String(x.id)));
    // Guruhda ism/avatar sarlavhalari yo'qolib ketmasligi uchun guruh painter'i bilan chizamiz
    if (state.currentChatKind === 'group') chatUI.dropGroupMsgs?.(ids);
    else {
      // DM: chatlar ro'yxatidagi oxirgi xabar prevyusi ham o'chirilgan xabarda qolmasin
      const cm = chatState._latestChatMap?.[state.currentChatUid], last = next[next.length - 1];
      if (cm) {
        cm.lastMessage = last ? (last.type === 'voice' ? 'Ovozli xabar' : last.type === 'file' ? fileMsgPreview({ caption: last.text, fileName: last.fileName, icons: false }) : (last.text || '')).slice(0, 120) : '';
        cm.lastSenderId = last ? last.senderId : null;
      }
    }
    if (state.currentChatKind === 'group' && chatUI.groupNames) paintGroupThread(next, chatUI.groupNames());
    else paintMessages(next);
  },
  syncInput: updateVoiceSendBtn,
  getUsers: async () => (chatState._usersCache && chatState._usersCache.length) ? chatState._usersCache : await _fetchChatUsers(),
  chatIdFor: async uid => {
    const cached = chatState._latestChatMap[uid]?.id;
    if (cached && _UUID_RE.test(cached)) return cached;
    const { data, error } = await sb.rpc('get_or_create_chat', { p_other: uid });
    return error ? null : data;
  },
});
$('chatThreadModal').addEventListener('click', e => {
  if (e.target === $('chatThreadModal')) closeChatThread();
});
// Katta emoji bosildi / BOOM — DM da suhbatdoshga ham uzatamiz (guruhda groups.js)
document.addEventListener('emo-tap', e => {
  if (state.currentChatKind && state.currentChatKind !== 'dm') return;
  try { chatState._rt?.sendEmo(e.detail.id, e.detail.k); } catch (_) {}
});

// Groups DOM injection + "+" button
injectGroupsDOM();
state.currentChatKind = state.currentChatKind || 'dm';

const _chatsAddBtn = $('chatsAddBtn');
if (_chatsAddBtn) _chatsAddBtn.addEventListener('click', openCreateChoice);

// Input text changes — toggle mic/send icon + "yozmoqda..." holatini yuborish
$('chatThreadInput').addEventListener('input', updateVoiceSendBtn);
$('chatThreadInput').addEventListener('input', _onChatInputTyping);
$('chatThreadInput').addEventListener('keydown', e => {
  // Desktop: Enter = yuborish, Shift+Enter = yangi qator. Telefon (sensorli): Enter = yangi qator, yuborish tugma bilan.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); handleSendAction(); }
});

/* ── Composer emoji tugmasi — matn maydoni ichida chapda (Telegram
 * uslubi). Kompakt quick-picker: keng tarqalgan emojilardan iborat
 * ro'yxat, bosilganda kursor turgan joyga qo'shiladi. ── */
initEmojiPicker({ btn: $('chatEmojiBtn'), pop: $('chatEmojiQuickpick'), input: $('chatThreadInput') });

// Mikrofon / Yuborish tugmasi — Telegram uslubidagi "Bosib turib gapirish" (Push-to-Talk)

/* Voice hold-to-talk — modules/chat-voice-record.js */
initChatVoiceRecording({
  onRecorded: (blob, duration) => sendVoiceMessage(blob, duration),
  onVideoRecorded: (file) => { sendChatFile(file, ''); },
  onDevicesChange: () => { try { updateVoiceSendBtn(); } catch (_) {} },
  isComposerBusy: () => {
    const hasText = !!$('chatThreadInput')?.value?.trim();
    return hasText || !!chatState._chatSelFile || !!chatState._pendingPostShare;
  },
  onSendAction: () => { handleSendAction(); },
});
initVoicePlayer({
  openChat: (uid) => { openChatThread(uid); },
});


/* ── Mobil klaviatura moslashuvi (keyboard inputni yopib qo'ymasligi uchun) ── */
function initKeyboardAdaptation() {
  const modal = $('chatThreadModal');
  const inp   = $('chatThreadInput');
  const msgs  = $('chatThreadMessages');
  if (!modal) return;

  const adapt = () => {
    if (!modal.classList.contains('show')) return;
    if (window.visualViewport) {
      const vv = window.visualViewport;
      // Klaviatura ochilgandagi balandlik farqi
      const offset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      if (offset > 20) {
        modal.style.bottom = `${offset}px`;
        if (msgs && chatState._pinned) msgs.scrollTop = msgs.scrollHeight;
      } else {
        modal.style.bottom = '0px';
      }
    }
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', adapt);
    window.visualViewport.addEventListener('scroll', adapt);
  }

  if (inp) {
    inp.addEventListener('focus', () => {
      setTimeout(adapt, KB_ADAPT_1_MS);
      setTimeout(adapt, KB_ADAPT_2_MS);
      setTimeout(() => { if (msgs) msgs.scrollTop = msgs.scrollHeight; }, KB_SCROLL_MS);
    });
    inp.addEventListener('blur', () => {
      setTimeout(() => {
        if (modal) modal.style.bottom = '0px';
      }, KB_BLUR_MS);
    });
  }
}
initKeyboardAdaptation();


// File attach
/* Skrepka: menyu (Kamera / Fayl / Media) — modules/chat/attach-menu.js; DM va guruh uchun bitta */
initAttachMenu({
  btn: $('chatAttachBtn'),
  fileInput: $('chatFileInput'),
  isBusy: () => !!($('chatVoiceBtn')?.classList.contains('recording') || $('chatThreadInputRow')?.classList.contains('recording')),
  onPick: f => { setChatFile(f); $('chatThreadInput')?.focus({ preventScroll: true }); },
});
$('chatFileInput')?.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (f) setChatFile(f);
});
$('cfpRemove')?.addEventListener('click', clearChatFile);
$('chatPostAttachClose')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  clearPendingPostShare();
});
// Ctrl+V / drag-drop (upload.js) — fayl suhbatga biriktiriladi (xuddi "skrepka" bilan tanlangandek), Enter/yuborish bilan ketadi
document.addEventListener('chat:attach-file', e => {
  const f = e.detail?.file;
  if (!f || !$('chatFilePreview')) return;
  setChatFile(f);
  $('chatThreadInput')?.focus({ preventScroll: true });
});



/* ── destroyChatsView: chat viewdan chiqqanda cleanup ─────────────────── */
export function destroyChatsView() {
  // Thread listener'ni to'xtatish
  if (chatState._threadUnsub) { chatState._threadUnsub(); chatState._threadUnsub = null; }
  // Thread modal'ni yopish
  try { closeChatThread(); } catch (_) {}
  chatState._searchQuery = '';
  const inp = document.getElementById('chatSearchInput');
  if (inp) inp.value = '';
  const clearBtn = document.getElementById('chatSearchClear');
  if (clearBtn) clearBtn.classList.add('d-none');
  const res = document.getElementById('chatSearchResult');
  if (res) res.classList.add('d-none');
  // chatsWatcher'ni to'xtatmaymiz — u background notification uchun kerak
  // (auth.js stopChatsWatcher logout paytida chaqiradi)
}

/* ── Chat thread header: avi/nom bosilganda profil ochish ────────────── */
// DM uchun: shu suhbatdagi media/musiqa/fayllar paneli (haqiqiy profil emas)
// Guruh/Kanal uchun: guruh info overlay
(function() {
  const aviEl  = document.getElementById('chatThreadAvi');
  const nameEl = document.getElementById('chatThreadName');

  async function openCurrentProfile() {
    const kind = state.currentChatKind || 'dm';
    if (kind === 'dm') {
      const uid = state.currentChatUid;
      if (!uid) return;
      const { openChatMedia } = await import('./chat-media.js');
      openChatMedia({ chatId: state.currentChatId, name: nameEl?.textContent, avatar: aviEl?.querySelector('img')?.src });
    } else {
      // guruh yoki kanal — group info overlay
      const { openGroupInfo } = await import('./groups.js');
      if (state.currentChatId || window._currentGroupId) {
        // currentGroupId groups.js ichida — openGroupThread da o'rnatiladi
        const gid = document.getElementById('chatThreadModal')?.dataset?.gid
          || window._currentGroupId;
        if (gid) openGroupInfo(gid);
      }
    }
  }

  if (aviEl)  aviEl.style.cursor  = 'pointer';
  if (nameEl) nameEl.style.cursor = 'pointer';
  if (aviEl)  aviEl.addEventListener('click',  openCurrentProfile);
  if (nameEl) nameEl.addEventListener('click', openCurrentProfile);
})();

Object.assign(chatUI, { paintMessages, updateMsgTicks, updateVoiceSendBtn, clearPendingPostShare, setPendingPostShare, clearChatFile, _showOptimisticVoiceBubble, _setTyping, paintGroupThread, resetSeenMsgs, initChatHeaderMenu, getPendingPostShare, updatePostAttachBar });
