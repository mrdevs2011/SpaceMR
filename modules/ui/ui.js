import { esc } from '../core/utils.js';
// test 3: diff uchun izoh
import { state, sb }                               from '../core/config.js';
import { $ }                                       from '../core/utils.js';

/* ══════════════════════════════════════════════════════════════════════
   SEARCH OVERLAY — unified mobile + desktop
   ══════════════════════════════════════════════════════════════════════ */
const appHdr         = $('appHdr');
const sbSearchToggle = $('sbSearchToggle');
const searchOverlay  = $('searchOverlay');
const searchInput    = $('searchInput');

function openSearchOverlay() {
  searchOverlay?.classList.add('open');
  setTimeout(() => searchInput?.focus(), 60);
  sbSearchToggle?.classList.add('search-active');
}

function closeSearchOverlay() {
  searchOverlay?.classList.remove('open');
  sbSearchToggle?.classList.remove('search-active');
  if (searchInput) { searchInput.value = ''; _doSearch(''); }
}

/* hdrSearchBtn onclick — router.js/_attachSearchHandler tomonidan boshqariladi.
   Har tab o'zgarganda handler qayta biriktiriladi. */

/* Yopish button inside overlay */
$('searchOverlayClose')?.addEventListener('click', e => {
  e.stopPropagation();
  closeSearchOverlay();
});

/* X (tozalash) — faqat inputni bo'shatadi, oynani yopmaydi */
$('searchClearBtn')?.addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  if (!searchInput) return;
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.focus();
});

/* Backdrop click → close */
searchOverlay?.addEventListener('click', e => {
  if (e.target === searchOverlay) closeSearchOverlay();
});

/* sbSearchToggle onclick — router.js/_attachSearchHandler tomonidan boshqariladi. */


/* ── View switching ──────────────────────────────────────────────────── */
export async function switchView(v) {
  state.view = v;
  document.querySelectorAll('.view').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.nav-btn[data-v]').forEach(x => x.classList.remove('on'));
  document.getElementById(`${v}View`)?.classList.add('on');
  document.querySelector(`.nav-btn[data-v="${v}"]`)?.classList.add('on');

  // Sync with navigation bar
  const { updateActiveNav } = await import('./bar.js');
  updateActiveNav(v);

  const upm = $('userProfileModal');
  if (upm?.classList.contains('show')) {
    state.currentViewingUserId    = null;
    state.currentViewingUserPosts = [];
    upm.classList.remove('show');
  }

  /* Qidiruv overlay yopilsin */
  if (searchOverlay?.classList.contains('open')) {
    closeSearchOverlay();
  }

  window.scrollTo({ top: 0 });

  if (v === 'home') {
    state.visibleN = 10;
    const { renderFeed } = await import('../feed/feed.js');
    renderFeed();
  }
  if (v === 'profile') {
    const { renderProfile } = await import('../profile/profile.js');
    renderProfile();
  }
}

/* ── Open media post in modal/zoom ───────────────────────────────────── */
export async function openMediaInModal(postId) {
  const post = state.allPosts.find(p => p.id === postId);
  if (!post) return;
  const { openZoom } = await import('../core/utils.js');
  openZoom(post.mediaUrl, 'image');
}

/* ── Logo click → home ───────────────────────────────────────────────── */
const hdrLogoBtn = document.getElementById('hdrLogoBtn');
if (hdrLogoBtn) {
  hdrLogoBtn.addEventListener('click', async () => {
    const { navigateTo } = await import('../router.js');
    navigateTo('home');
  });
}

/* ── Nav buttons handled by router.js — do NOT add duplicate listeners here ── */

/* ── Header / sidebar tabs removed ───────────────────────────────────── */
// Barchasi/My filter tabs no longer used

/* ── Qidiruv ──────────────────────────────────────────────────────────── */
async function _doSearch(val) {
  state.search = val;
  clearTimeout(window._sT);
  window._sT = setTimeout(async () => {
    state.visibleN = 10;
    const { renderFeed } = await import('../feed/feed.js');
    if (state.view === 'home') renderFeed();
    if (state.view !== 'home' && val) {
      switchView('home');
    }
  }, 300);
}


const suggestionsEl = $('searchSuggestions');
let suggestionIndex = -1;
let currentSuggestions = [];

function showSuggestions(list) {
  if (!suggestionsEl) return;
  if (!list || list.length === 0) {
    suggestionsEl.classList.remove('show');
    suggestionsEl.innerHTML = '';
    return;
  }
  currentSuggestions = list;
  suggestionIndex = -1;
  suggestionsEl.innerHTML = list.map((item, i) => {
    const avatarHtml = (item.type === 'user' || item.type === 'group')
      ? `<img src="${esc(item.avatar || '')}" class="search-suggestion-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0">
         <span class="search-suggestion-avatar-fallback" style="display:none;width:28px;height:28px;border-radius:50%;background:var(--accent,#ffffff);color:#fff;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">${escapeHtml(((item.type === 'user' ? item.label[1] : item.label[0]) || '?').toUpperCase())}</span>`
      : `<img src="./svg/${item.type === 'hashtag' ? 'ui/hashtag' : 'action/search'}.svg" alt="" class="icon search-suggestion-icon" width="20" height="20">`;
    return `<div class="search-suggestion-item" data-index="${i}" data-type="${item.type}">
      ${avatarHtml}
      <span class="search-suggestion-text">${escapeHtml(item.label)}</span>
    </div>`;
  }).join('');
  suggestionsEl.classList.add('show');

  suggestionsEl.querySelectorAll('.search-suggestion-item').forEach(el => {
    el.addEventListener('click', async () => {
      const idx = parseInt(el.dataset.index);
      const chosen = currentSuggestions[idx];
      if (suggestionsEl) suggestionsEl.classList.remove('show');
      if (chosen.type === 'group' && chosen.gid) {
        closeSearchOverlay();
        const { applyPath } = await import('../url-router.js');
        applyPath('/chats/g/' + encodeURIComponent(chosen.gid));
      } else if (chosen.type === 'user' && chosen.uid) {
        closeSearchOverlay();
        const { openUserProfileModal } = await import('../profile/profile.js');
        openUserProfileModal(chosen.uid);
      } else {
        window.dispatchEvent(new CustomEvent('explore:commit', { detail: chosen.value }));
      }
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function visiblePostsForSearch() {
  return (state.allPosts || []).filter(p => p.userId === state.me?.uid || p.isPublic === true);
}

async function fetchSuggestions(rawQuery) {
  if (!rawQuery || rawQuery.trim().length < 2) return [];

  const results = [];
  const q = rawQuery.toLowerCase().replace(/^@/, '');

  // 1. profiles: username YOKI ism bo'yicha, so'zning istalgan joyidan ("ro" -> "Aro", "pro_x")
  const likeQ = q.replace(/[,()"]/g, ' ').trim().replace(/[\\%_]/g, m => '\\' + m);
  try {
    const { data, error } = await sb.from('profiles')
      .select('id,username,full_name,avatar')
      .or(`username.ilike.%${likeQ}%,full_name.ilike.%${likeQ}%`)
      .order('username')
      .limit(5);
    if (error) throw error;
    (data || []).forEach(u => {
      if (u.username && u.id !== state.me?.uid) {
        results.push({ type: 'user', label: '@' + u.username, value: u.username, uid: u.id, avatar: u.avatar || null });
      }
    });
  } catch (e) {
    // So'rov xato bersa, local allUsers dan izlaymiz
    state.allUsers?.forEach(user => {
      if (user.username?.toLowerCase().includes(q) || (user.fullName || '').toLowerCase().includes(q)) {
        results.push({ type: 'user', label: '@' + user.username, value: user.username, uid: user.uid, avatar: user.photoURL || null });
      }
    });
  }

  // 1b. Guruhlar: nomi YOKI username bo'yicha (masalan "ters" -> "testers", "groups_gro")
  try {
    const { data, error } = await sb.from('groups')
      .select('id,name,username,avatar')
      .or(`name.ilike.%${likeQ}%,username.ilike.%${likeQ}%`)
      .limit(4);
    if (!error) (data || []).forEach(g => {
      results.push({ type: 'group', label: g.name + (g.username ? ' · @' + g.username : ''), value: g.name, gid: g.id, avatar: g.avatar || null });
    });
  } catch (_) { /* guruh qidiruvi xato bersa — qolganlari ishlayveradi */ }

  // 2. Hashtag qidirish (postlardan)
  const hashtags = new Set();
  visiblePostsForSearch().forEach(post => {
    const matches = post.text?.match(/#[a-zA-Z0-9_]+/g);
    matches?.forEach(tag => {
      if (tag.toLowerCase().includes(q)) hashtags.add(tag);
    });
  });
  hashtags.forEach(tag => results.push({ type: 'hashtag', label: tag, value: tag }));

  // 3. Post caption qidirish
  visiblePostsForSearch().forEach(post => {
    if (post.text && post.text.toLowerCase().includes(q)) {
      const snippet = post.text.substring(0, 40) + (post.text.length > 40 ? '...' : '');
      results.push({ type: 'post', label: snippet, value: post.text.substring(0, 40).trim() });
    }
  });

  return results.slice(0, 10);
}

// Debounced suggestion fetch
let suggestionTimeout;
function handleSearchInput(val) {
  clearTimeout(suggestionTimeout);
  suggestionTimeout = setTimeout(async () => {
    const suggestions = await fetchSuggestions(val);
    showSuggestions(suggestions);
  }, 200);
}

if (searchInput) {
  searchInput.oninput = e => handleSearchInput(e.target.value);

  searchInput.addEventListener('keydown', async e => {
    const items = suggestionsEl?.querySelectorAll('.search-suggestion-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionIndex = Math.min(suggestionIndex + 1, currentSuggestions.length - 1);
      if (items) updateSuggestionHighlight([...items]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionIndex = Math.max(suggestionIndex - 1, -1);
      if (items) updateSuggestionHighlight([...items]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestionIndex >= 0 && currentSuggestions[suggestionIndex]) {
        const chosen = currentSuggestions[suggestionIndex];
        suggestionsEl?.classList.remove('show');
        if (chosen.type === 'group' && chosen.gid) {
          closeSearchOverlay();
          const { applyPath } = await import('../url-router.js');
          applyPath('/chats/g/' + encodeURIComponent(chosen.gid));
        } else if (chosen.type === 'user' && chosen.uid) {
          closeSearchOverlay();
          const { openUserProfileModal } = await import('../profile/profile.js');
          openUserProfileModal(chosen.uid);
        } else {
          window.dispatchEvent(new CustomEvent('explore:commit', { detail: chosen.value }));
        }
      } else {
        // Enter: taklif tanlanmagan — Explore natijalar sahifasi (X kabi)
        suggestionsEl?.classList.remove('show');
        window.dispatchEvent(new CustomEvent('explore:commit', { detail: searchInput.value }));
      }
    } else if (e.key === 'Escape') {
      closeSearchOverlay();
      e.stopPropagation(); // umumiy Esc (shortcuts.js) ham ishlab, ostidagi chat/oynani yopib yubormasin
    }
  });
}

function updateSuggestionHighlight(items) {
  items.forEach((item, i) => {
    item.classList.toggle('active', i === suggestionIndex);
  });
}

// Yopish suggestions on outside click
document.addEventListener('click', e => {
  if (suggestionsEl && !e.target.closest('.search-overlay-inner')) {
    showSuggestions([]);
  }
});

/* ── Desktop search input ────────────────────────────────────────────── */
const sbSearchInput = $('sbSearchInput');
if (sbSearchInput) sbSearchInput.oninput = e => handleSearchInput(e.target.value);

