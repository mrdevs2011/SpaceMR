/**
 * Qidiruv sahifasi (diet F3.1: "Explore" → oddiy filtr).
 * Sidebar'dagi "Qidiruv" bosilganda (overlay .open) markaz ustunda ochiladi.
 * Tablar, trend/hashtag va media setkasi yo'q: bitta ro'yxat —
 *   Odamlar + Postlar. Maydon bo'sh bo'lsa hammasi, yozib Enter bosilsa
 *   (yoki typeahead'dan tanlansa — ui.js 'explore:commit') filtrlanadi.
 * Ma'lumot: state.allPosts (ochiq yoki o'zimniki) + profiles jadvali.
 */
import { sb, state, mapProfile } from './core/config.js';
import { $, esc, defAvi } from './core/utils.js';

const overlay = $('searchOverlay');
const input   = $('searchInput');
const body    = $('expBody');

let query = '';
let users = [];
let usersOk = false;
let remoteUsers = [];   // serverdan so'z bo'yicha topilgan odamlar (60 tadan ortig'i ham)
let remoteGroups = [];  // serverdan topilgan guruhlar (ochiq yoki a'zo bo'lingan)
let _rTimer = 0;
let _rSeq = 0;

/* ── Ma'lumot ────────────────────────────────────────────────────────── */
const ms = p => p?.createdAt || 0;

function visiblePosts() {
  const me = state.me?.uid;
  return (state.allPosts || [])
    .filter(p => p.userId === me || p.isPublic === true)
    .sort((a, b) => ms(b) - ms(a));
}

function otherUsers() {
  const me = state.me?.uid;
  const seen = new Set();
  return [...users, ...remoteUsers].filter(u => {
    if (!u || u.uid === me || seen.has(u.uid)) return false;
    seen.add(u.uid);
    return true;
  });
}

/* Guruhlar: o'zim a'zo bo'lganlar (lokal) + serverdan topilganlar */
let _localGroups = [];
async function loadLocalGroups() {
  try {
    const m = await import('./chat/groups.js');
    _localGroups = m.getGroupRows() || [];
  } catch (_) { _localGroups = []; }
}
function allGroups() {
  const map = new Map();
  [..._localGroups, ...remoteGroups].forEach(g => { if (g?.id) map.set(g.id, g); });
  return [...map.values()];
}

/* So'z bo'yicha serverdan qidirish: ism/username/guruh nomi — so'zning istalgan joyidan */
function remoteSearch(raw) {
  clearTimeout(_rTimer);
  const q = String(raw || '').trim().replace(/^@/, '');
  if (!q) { remoteUsers = []; remoteGroups = []; return; }
  _rTimer = setTimeout(async () => {
    const seq = ++_rSeq;
    const like = q.replace(/[,()"]/g, ' ').trim().replace(/[\\%_]/g, m => '\\' + m);
    if (!like) return;
    try {
      const { data } = await sb.from('profiles').select('*')
        .eq('approval', 'approved')
        .or(`username.ilike.%${like}%,full_name.ilike.%${like}%`)
        .limit(40);
      if (seq === _rSeq) remoteUsers = (data || []).map(mapProfile).filter(u => u && !u.blocked);
    } catch (_) {}
    try {
      const m = await import('./chat/groups.js');
      const g = await m.searchGroups(q);
      if (seq === _rSeq) remoteGroups = g || [];
    } catch (_) {}
    if (seq === _rSeq && query && overlay.classList.contains('open')) render();
  }, 220);
}

async function loadUsers() {
  if (usersOk) return;
  try {
    const { data, error } = await sb.from('profiles').select('*')
      .eq('approval', 'approved').order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    users = (data || []).map(mapProfile).filter(u => u && !u.blocked);
    usersOk = true;
    if (overlay.classList.contains('open')) render();
  } catch (e) {
    console.warn('[Explore]', e.message);
  }
}

/* ── Qatorlar ────────────────────────────────────────────────────────── */

function personRow(u) {
  const name = u.fullName || u.username || 'Foydalanuvchi';
  return `<button type="button" class="exp-item exp-person" data-uid="${esc(u.uid)}">
    <span class="exp-pav"><img src="${esc(u.avatar || defAvi(name))}" alt="" onerror="this.style.display='none'"></span>
    <span class="exp-item-main">
      <span class="exp-title exp-one">${esc(name)}</span>
      ${u.username ? `<span class="exp-sub">@${esc(u.username)}</span>` : ''}
    </span>
  </button>`;
}

function groupRow(g) {
  const name = g.name || g.username || 'Guruh';
  const n = (g.members || []).length;
  const sub = [g.username ? '@' + g.username : '', n ? n + " a'zo" : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="exp-item exp-person" data-gid="${esc(g.id)}">
    <span class="exp-pav"><img src="${esc(g.avatar || defAvi(name))}" alt="" onerror="this.style.display='none'"></span>
    <span class="exp-item-main">
      <span class="exp-title exp-one">${esc(name)}</span>
      ${sub ? `<span class="exp-sub">${esc(sub)}</span>` : ''}
    </span>
  </button>`;
}

const empty = t => `<div class="exp-empty">${esc(t)}</div>`;
const section = (title, inner, last) =>
  `<section class="exp-sec${last ? ' exp-last' : ''}"><h2 class="exp-h">${esc(title)}</h2>${inner}</section>`;

/* ── Ro'yxat (filtr) ─────────────────────────────────────────────────── */
function listHtml() {
  const q = query.toLowerCase().replace(/^@/, '');
  const posts = visiblePosts().filter(p => !q ||
    (p.text || '').toLowerCase().includes(q) || (p.userFullName || '').toLowerCase().includes(q));
  const pe = otherUsers().filter(u => !q ||
    (u.username || '').toLowerCase().includes(q) || (u.fullName || '').toLowerCase().includes(q));

  const groups = allGroups().filter(g => !q ||
    (g.name || '').toLowerCase().includes(q) || (g.username || '').toLowerCase().includes(q));

  let html = '';
  if (pe.length)    html += section('Odamlar', pe.slice(0, 40).map(personRow).join(''), !posts.length && !groups.length);
  else if (!q && !usersOk) html += section('Odamlar', empty('Yuklanmoqda…'));
  if (groups.length) html += section('Guruhlar', groups.slice(0, 30).map(groupRow).join(''), !posts.length);
  _postsToPaint = posts.slice(0, q ? 40 : 15);
  // X kabi: postlar to'liq post kartasi bo'lib chiqadi (lenta bilan bir xil)
  if (posts.length) html += section('Postlar', '<div class="exp-posts-feed"></div>', true);
  return html || empty(q ? `"${query}" bo'yicha natija topilmadi` : 'Hozircha ko\'rsatadigan narsa yo\'q');
}

let _postsToPaint = [];
let _paintSeq = 0;
async function render() {
  const seq = ++_paintSeq;
  body.innerHTML = listHtml();
  const box = body.querySelector('.exp-posts-feed');
  if (!box || !_postsToPaint.length) return;
  const list = _postsToPaint;
  const { renderFeedTo } = await import('./feed/feed.js');
  if (seq !== _paintSeq || !box.isConnected) return; // yangiroq render boshlandi
  await renderFeedTo(box, list);
}

/* ── Holat ───────────────────────────────────────────────────────────── */
function reset() {
  query = '';
  remoteUsers = []; remoteGroups = []; _rSeq++;
  if (input) input.value = '';
  $('searchSuggestions')?.classList.remove('show');
  overlay.scrollTop = 0;
  syncQuery();
}

/** URL (/explore?q=...) uchun joriy qidiruv so'zini holatga yozamiz */
function syncQuery() {
  if (state.exploreQuery === query) return;
  state.exploreQuery = query;
  window.dispatchEvent(new Event('spacemr:route'));
}

function commit(val) {
  const q = String(val || '').trim();
  if (!q) { reset(); render(); return; }
  query = q;
  if (input) input.value = q;
  $('searchSuggestions')?.classList.remove('show');
  overlay.scrollTop = 0;
  render();
  remoteSearch(q);
  syncQuery();
}

function closeOverlay() { $('searchOverlayClose')?.click(); }

/* ── Init ────────────────────────────────────────────────────────────── */
if (overlay && input && body) {
  let wasOpen = false;
  new MutationObserver(() => {
    const open = overlay.classList.contains('open');
    if (open && !wasOpen) { reset(); render(); loadUsers(); loadLocalGroups().then(() => { if (overlay.classList.contains('open')) render(); }); }
    wasOpen = open;
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });

  // Maydon bo'shatilsa — to'liq ro'yxat qaytadi
  input.addEventListener('input', () => {
    const v = input.value.trim();
    if (!v) { if (query) { reset(); render(); } return; }
    // Yozish bilan birga natijalar o'zi filtrlanadi (Enter shart emas)
    query = v;
    render();
    remoteSearch(v);
    syncQuery();
  });

  window.addEventListener('explore:commit', e => commit(e.detail));

  body.addEventListener('click', async e => {
    $('searchSuggestions')?.classList.remove('show');

    const post = e.target.closest('[data-post]');
    if (post) {
      const id = post.dataset.post;
      closeOverlay();
      const m = await import('./profile/profile.js');
      m.openDetail?.(id);
      return;
    }

    const gr = e.target.closest('[data-gid]');
    if (gr) {
      const gid = gr.dataset.gid;
      closeOverlay();
      const m = await import('./url-router.js');
      m.applyPath('/chats/g/' + encodeURIComponent(gid));
      return;
    }

    const u = e.target.closest('[data-uid]');
    if (u) {
      const uid = u.dataset.uid;
      closeOverlay();
      const m = await import('./profile/profile.js');
      m.openUserProfileModal?.(uid);
    }
  });
}
