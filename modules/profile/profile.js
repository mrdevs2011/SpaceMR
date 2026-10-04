import { sb, state, getMediaUrl, uploadViaController, mapProfile, mapPost } from '../core/config.js';
import { $, esc, fmt, fmtSz, defAvi,
         openZoom }                      from '../core/utils.js';
import { toast }                         from '../ui/toast.js';

/** profiles qatori (eski users/{uid} hujjatiga o'xshash) */
async function _loadProfile(uid) {
  const { data } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  return mapProfile(data) || {};
}
import { cacheProfile, getCachedProfile } from '../core/local-cache.js';

/** Foydalanuvchi postlari: state.allPosts (feed keshi, ba'zan faqat oxirgi 80 ta) ga tayanmasdan,
 *  bazadan to'g'ridan-to'g'ri olinadi. Xato bo'lsa — keshdagi ro'yxatga qaytadi. */
async function _fetchUserPosts(uid, onlyPublic) {
  const local = state.allPosts.filter(p => p.userId === uid && (!onlyPublic || p.isPublic === true));
  try {
    let q = sb.from('posts').select('*').eq('user_id', uid);
    if (onlyPublic) q = q.eq('is_public', true);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const rows = (data || []).map(r => { try { return mapPost(r); } catch { return null; } }).filter(Boolean);
    // Bazada hali ko'rinmagan (yangi yuklangan) lokal postlarni ham qo'shamiz
    const ids = new Set(rows.map(p => p.id));
    for (const p of local) if (!ids.has(p.id)) rows.push(p);
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return rows;
  } catch (e) {
    console.warn('[Profile] postlarni yuklashda xato:', e?.message || e);
    return local;
  }
}

/* ── My profile ──────────────────────────────────────────────────────── */

/* Profil postlari filter (Barchasi / Photos / Text / Music) */
let _pgAllPosts = [];
let _pgTab = 'all';
let _pgTabsBound = false;

function _postKind(p) {
  const mt = (p.mediaType || '').toLowerCase();
  if (mt.startsWith('image')) return 'photos';
  if (mt.startsWith('audio') || mt.includes('mpeg') || mt.includes('mp3') || mt.includes('wav') || mt.includes('ogg')) return 'music';
  // ba'zi audio fayllar media_type bo'sh, fileName dan
  const fn = (p.fileName || p.mediaPath || '').toLowerCase();
  if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/.test(fn)) return 'music';
  if (/\.(jpe?g|png|gif|webp|avif)(\?|$)/.test(fn)) return 'photos';
  if (p.mediaUrl && mt.startsWith('image')) return 'photos';
  if (!p.mediaUrl && !p.mediaPath) return 'text';
  // media bor lekin type noma'lum
  if (p.mediaUrl || p.mediaPath) return 'photos';
  return 'text';
}

function _filterPgPosts(posts, tab) {
  if (!tab || tab === 'all') return posts;
  return posts.filter(p => _postKind(p) === tab);
}

function _bindProfileTabs() {
  if (_pgTabsBound) return;
  const hdr = document.getElementById('profileGridTabs');
  if (!hdr) return;
  _pgTabsBound = true;
  hdr.addEventListener('click', e => {
    const btn = e.target.closest('[data-pg-tab]');
    if (!btn) return;
    const tab = btn.dataset.pgTab;
    if (!tab || tab === _pgTab) return;
    _pgTab = tab;
    hdr.querySelectorAll('[data-pg-tab]').forEach(b => {
      const on = b.dataset.pgTab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderProfileGrid(_pgAllPosts);
  });
}

export async function renderProfile() {
  if (!state.me) return;

  // Tarmoqni kutmasdan — keshdagi so'nggi profil ma'lumotini darhol chizamiz
  const cached = getCachedProfile(state.me.uid);
  if (cached) _paintProfile(cached);

  const ud = await _loadProfile(state.me.uid);
  cacheProfile(state.me.uid, ud);
  await _paintProfile(ud);
}

async function _paintProfile(ud) {
  const fn   = ud.fullName || state.me.displayName || 'Foydalanuvchi';
  const av   = ud.avatar   || defAvi(fn);

  $('profileAvi').innerHTML = `<img src="${esc(av)}" onerror="this.style.display='none'" style="cursor:pointer;" title="Rasmni kattalashtirish">`;

  $('profileName').textContent = fn;

  // Username
  const usernameEl = $('profileUsername');
  if (usernameEl) {
    usernameEl.textContent = ud.username ? '@' + ud.username : '';
    usernameEl.style.display = ud.username ? '' : 'none';
  }

  $('profileBio').textContent  = ud.bio || '';

  const myP = await _fetchUserPosts(state.me.uid, false);
  $('statPosts').textContent     = myP.length;
  $('statLikes').textContent     = myP.reduce((s,p) => s+(p.likes||0), 0);

  // Avatar click — zoom + quick edit shortcut
  $('profileAvi').onclick = () => {
    openZoom(av, 'avatar');
    const zm = document.getElementById('zoomModal');
    if (zm) {
      let editBtn = document.getElementById('aviEditBtn');
      if (!editBtn) {
        editBtn = document.createElement('button');
        editBtn.id = 'aviEditBtn';
        editBtn.className = 'avi-zoom-edit-btn';
        editBtn.innerHTML = `<img src="./svg/action/edit.svg" alt="" class="icon" width="14" height="14"> Rasmni tahrirlash`;
        zm.appendChild(editBtn);
      }
      editBtn.style.display = 'flex';
      editBtn.onclick = (e) => {
        e.stopPropagation();
        zm.classList.remove('show');
        $('editProfileBtn')?.click(); // open full edit sheet
      };
      const hideEditBtn = () => { if (editBtn) editBtn.style.display = 'none'; };
      zm.addEventListener('click', function onZmClick(e) {
        if (e.target === zm) { hideEditBtn(); zm.removeEventListener('click', onZmClick); }
      });
      document.getElementById('zoomClose')?.addEventListener('click', hideEditBtn, { once: true });
    }
  };

  await renderProfileGrid(myP);
}

export async function renderProfileGrid(posts) {
  _bindProfileTabs();
  if (Array.isArray(posts)) _pgAllPosts = posts;
  const list = _filterPgPosts(_pgAllPosts, _pgTab);

  // mosaic faqat Barchasi da; boshqa tablarda bir xil katak
  const grid = $('profileGrid');
  if (grid) grid.classList.toggle('profile-grid--uniform', _pgTab !== 'all');

  if (!list.length) {
    $('profileGrid').innerHTML = `<div class="up-grid-empty">
      <div class="up-grid-empty-title">Hozircha postlar yo'q</div>
      <div class="up-grid-empty-sub">Birinchi postingizni joylang — shu yerda ko'rinadi</div>
    </div>`;
    return;
  }

  // Multi-Supabase: mediaUrl yaratish (backward compatibility)
  await Promise.all(list.map(async p => {
    if (!p.mediaUrl && (p.mediaPath || p.storageIndex)) {
      p.mediaUrl = await getMediaUrl(p);
    }
  }));

  $('profileGrid').innerHTML = list.map(p => {
    const isImg = !!(p.mediaUrl && p.mediaType?.startsWith('image'));
    const isMedia = isImg;
    let c = '';
    if (isImg) c = `<img src="${esc(p.mediaUrl)}" loading="lazy" alt="">`;
    else c = `<div class="grid-cell-txt">${esc((p.text||p.fileName||'').substring(0,80))}</div>`;
    const kind = isMedia ? 'grid-cell--media' : 'grid-cell--text';
    return `<div class="grid-cell ${kind}" data-id="${p.id}">${c}
      <div class="grid-cell-overlay">
        <div class="grid-stat">
          <img src="./svg/extra/icon-6b67b8783b6a.svg" alt="" class="icon" width="13" height="13">
          ${p.likes||0}
        </div>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('.grid-cell').forEach(c => c.addEventListener('click', () => openDetail(c.dataset.id)));
}

/* ── Post detail modal ───────────────────────────────────────────────── */
export async function openDetail(id) {
  const p = state.allPosts.find(x => x.id === id); if (!p) return;

  // Multi-Supabase: mediaUrl yaratish (backward compatibility)
  if (!p.mediaUrl && (p.mediaPath || p.storageIndex)) {
    p.mediaUrl = await getMediaUrl(p);
  }

  $('detailContent').innerHTML = `
    <div class="dm-handle"></div>
    <div class="d-flex items-center gap-10px p-14px-16px-10px">
      <div class="w-38px h-38px brr-50pct bg-bg3 flex-shrink-0"></div>
      <div class="flex-1"><div class="h-12px w-120px bg-bg3 brr-4px mb-6px"></div><div class="h-10px w-80px bg-bg3 brr-4px"></div></div>
    </div>
    <div class="w-full aspect-1 bg-bg3"></div>
    <div class="h-60px"></div>`;
  $('detailModal').classList.add('show');

  const [lR, cR, uR] = await Promise.all([
    sb.from('post_likes').select('post_id', { count: 'exact', head: true }).eq('post_id', id).eq('user_id', state.me.uid),
    sb.from('comments').select('id', { count: 'exact', head: true }).eq('post_id', id),
    sb.from('profiles').select('*').eq('id', p.userId).maybeSingle(),
  ]);
  const isLiked  = (lR.count || 0) > 0;
  const cmtCount = cR.count || 0;
  const ud = mapProfile(uR.data) || {};
  const av = ud.avatar || defAvi(ud.fullName);
  const isOwn = p.userId === state.me?.uid;
  if (isLiked) state.myLikedPosts.add(id);

  let mediaHtml = '';
  if (p.mediaUrl && p.mediaType?.startsWith('image')) {
    mediaHtml = `<div class="dm-media"><img src="${esc(p.mediaUrl)}" loading="lazy"></div>`;
  }

  const likeColor = isLiked ? '#f91880' : 'currentColor';
  const likeFill  = isLiked ? '#f91880' : 'none';

  $('detailContent').innerHTML = `
    <div class="dm-handle"></div>
    <div class="dm-head">
      <div class="dm-avi${isOwn?'':' dm-avi-link'}" ${isOwn?'':('data-uid="'+p.userId+'"')}><img src="${esc(av)}" onerror="this.style.display='none'"></div>
      <div class="dm-meta">
        <div class="dm-name${isOwn?'':' dm-name-link'}" ${isOwn?'':('data-uid="'+p.userId+'"')}>${esc(ud.fullName||'Noma\'lum')}</div>
        <div class="dm-time">${fmt(p.createdAt)}</div>
      </div>
      <button class="dm-close" id="dmClose"><img src="./svg/action/close.svg" alt="" class="icon" width="14" height="14"></button>
    </div>
    ${mediaHtml}
    ${p.text ? `<div class="dm-caption">${esc(p.text)}</div>` : ''}
    <div class="dm-stats">
      <span class="dm-stat-item">${(likeFill && likeFill !== 'none')
          ? '<img src="./svg/social/heart-filled.svg" alt="" class="icon" width="13" height="13">'
          : '<img src="./svg/social/heart.svg" alt="" class="icon" width="13" height="13">'} <span id="dmLikeCount">${p.likes||0}</span></span>
      <span class="dm-stat-item"><img src="./svg/extra/icon-838eb192325a.svg" alt="" class="icon" width="13" height="13"> ${cmtCount}</span>
    </div>
    <div class="dm-actions">
      <button class="dm-act${isLiked?' liked':''}" id="dmLikeBtn">
        ${(likeFill && likeFill !== 'none')
          ? '<img src="./svg/social/heart-filled.svg" alt="" class="icon" width="20" height="20">'
          : '<img src="./svg/social/heart.svg" alt="" class="icon" width="20" height="20">'}
        <span class="dm-act-count" id="dmLikeCount2">${p.likes||0}</span>
      </button>
      <button class="dm-act" id="dmCmtBtn">
        <img src="./svg/extra/icon-838eb192325a.svg" alt="" class="icon" width="20" height="20">
        <span class="dm-act-count">${cmtCount}</span>
      </button>
      <button class="dm-act" id="dmShareBtn" title="Havolani nusxalash" aria-label="Havolani nusxalash">
        <img src="./svg/extra/icon-af51112fbda1.svg" alt="" class="icon" width="20" height="20">
      </button>
      ${isOwn ? `<button class="dm-act dm-del" id="dmDelBtn" title="O'chirish">
        <img src="./svg/extra/icon-fb3793816331.svg" alt="" class="icon" width="20" height="20">
      </button>` : ''}
    </div>`;

  const closeDetail = () => {
    $('detailModal').classList.remove('show');
  };

  $('dmClose').onclick = closeDetail;
  $('detailModal').onclick = e => { if (e.target === $('detailModal')) closeDetail(); };
  $('dmLikeBtn').onclick = async () => {
    await doLikeGen(id, $('dmLikeBtn'));
    const { data: _pr } = await sb.from('posts').select('likes_count').eq('id', id).maybeSingle();
    const n = _pr?.likes_count ?? 0;
    $('dmLikeCount').textContent  = n;
    $('dmLikeCount2').textContent = n;
  };
  $('dmCmtBtn').onclick = () => { closeDetail(); import('../feed/comments.js').then(({ openCmtModal }) => openCmtModal(id)); };
  $('dmShareBtn')?.addEventListener('click', () => {
    import('../feed/feed.js').then(m => m.copyPostLink(id));
  });
  $('dmDelBtn')?.addEventListener('click', async () => {
    const { doDelete } = await import('../feed/feed.js');
    await doDelete(id);
    closeDetail();
    // Profil grid ni yangilash
    try {
      const myP = (state.allPosts || []).filter(x => x.userId === state.me?.uid);
      await renderProfileGrid(myP);
    } catch (_) {}
  });
  $('detailContent').querySelectorAll('.dm-avi-link,.dm-name-link').forEach(el => {
    el.addEventListener('click', () => { closeDetail(); openUserProfileModal(el.dataset.uid); });
  });
}

export async function doLikeGen(id, btn) {
  if (!state.me) return;
  const wasLiked = state.myLikedPosts.has(id);
  const svg      = btn.querySelector('svg');
  if (wasLiked) {
    state.myLikedPosts.delete(id);
    const { error } = await sb.from('post_likes').delete().eq('post_id', id).eq('user_id', state.me.uid);
    if (error) { state.myLikedPosts.add(id); return; }
    btn.classList.remove('liked'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor');
  } else {
    state.myLikedPosts.add(id);
    const { error } = await sb.from('post_likes').insert({ post_id: id, user_id: state.me.uid });
    if (error && error.code !== '23505') { state.myLikedPosts.delete(id); return; }
    btn.classList.add('liked'); svg.setAttribute('fill','#f91880'); svg.setAttribute('stroke','#f91880');
  }
}

/* ── Other user's profile modal ──────────────────────────────────────── */

/* ── Boshqa foydalanuvchi profili: tablar (Barchasi / Photos / Text / Musics) ── */
const UP_TABS = [['all','Barchasi'],['photos','Rasmlar'],['text','Matnlar'],['music','Musiqa']];
let _upTab = 'all';

function _upGridHtml(posts, uid, tab) {
  const list = _filterPgPosts(posts, tab);
  if (!list.length) {
    return tab === 'all'
      ? '<div class="up-grid-empty"><div class="up-grid-empty-title">Ommaviy postlar yo\'q</div><div class="up-grid-empty-sub">Bu foydalanuvchi hali hech narsa joylamagan</div></div>'
      : '<div class="up-grid-empty"><div class="up-grid-empty-title">Bu turdagi postlar yo\'q</div></div>';
  }
  return list.map(p => {
    let c = '';
    if (p.mediaUrl && p.mediaType?.startsWith('image'))
      c = `<img class="w-full h-full object-cover" src="${esc(p.mediaUrl)}" loading="lazy" onerror="this.classList.add('d-none')">`;
    else
      c = `<div class="up-grid-cell-txt">${esc((p.text||p.fileName||'').substring(0,40))}</div>`;
    const _um = !!(p.mediaUrl && p.mediaType?.startsWith('image'));
    return `<div class="up-grid-cell ${_um ? 'up-grid-cell--media' : 'up-grid-cell--text'}" data-id="${p.id}" data-uid="${uid}">${c}
      <div class="up-grid-cell-overlay">
        <div class="grid-stat">
          <img src="./svg/extra/icon-6b67b8783b6a.svg" alt="" class="icon" width="13" height="13">
          ${p.likes||0}
        </div>
      </div>
    </div>`;
  }).join('');
}

function _paintUpGrid(uid) {
  const grid = document.getElementById('upGrid');
  if (!grid) return;
  grid.innerHTML = _upGridHtml(state.currentViewingUserPosts || [], uid, _upTab);
  grid.classList.toggle('up-grid--uniform', _upTab !== 'all');
  grid.querySelectorAll('.up-grid-cell[data-id]').forEach(cell => {
    cell.addEventListener('click', () => openDetail(cell.dataset.id));
  });
}

export async function openUserProfileModal(uid) {
  if (!uid || uid === state.me?.uid) return;
  state.currentViewingUserId = uid;
  _upTab = 'all';
  $('userProfileModal').classList.add('show');
  $('upBody').innerHTML = '<div class="spin-wrap pt-80px"><div class="spinner"></div></div>';
  await renderUserProfileModal(uid);
}

export async function renderUserProfileModal(uid) {
  const ud    = await _loadProfile(uid);
  let av      = ud.avatar;
  if (!av || av === '' || av === 'undefined') av = defAvi(ud.fullName || 'U');

  const userPublicPosts = await _fetchUserPosts(uid, true);
  state.currentViewingUserPosts = userPublicPosts;

  // Multi-Supabase: mediaUrl yaratish (backward compatibility)
  await Promise.all(userPublicPosts.map(async p => {
    if (!p.mediaUrl && (p.mediaPath || p.storageIndex)) {
      p.mediaUrl = await getMediaUrl(p);
    }
  }));

  const totalLikes     = userPublicPosts.reduce((s,p) => s + (p.likes||0), 0);

  const gridHTML = _upGridHtml(userPublicPosts, uid, _upTab);

  $('upBody').innerHTML = `
    <div class="up-hero">
      <div class="up-avi" id="upAviImg" title="Rasmni ko'rish"><img class="w-full h-full object-cover" src="${esc(av)}" alt="" onerror="this.src='${defAvi(ud.fullName || 'U')}'"></div>
      <button type="button" id="upChatBtn" class="up-chat-btn">
        <img src="./svg/extra/icon-ea9c18b62f47.svg" alt="" class="icon" width="18" height="18">
        Chat yozish
      </button>
    </div>
    <div class="up-info">
      <div class="up-name">${esc(ud.fullName||'Noma\'lum')}</div>
      ${ud.username ? `<div class="up-username">@${esc(ud.username)}</div>` : ''}
      ${ud.bio ? `<div class="up-bio">${esc(ud.bio)}</div>` : ''}
      <div class="up-stats">
        <div class="up-stat"><div class="up-stat-val">${userPublicPosts.length}</div><div class="up-stat-lbl">postlar</div></div>
        <div class="up-stat"><div class="up-stat-val">${totalLikes}</div><div class="up-stat-lbl">yoqtirishlar</div></div>
      </div>
      <div class="up-posts-tab" id="upGridTabs" role="tablist">
        ${UP_TABS.map(([k, l]) => `<button type="button" class="profile-grid-tab${k === _upTab ? ' active' : ''}" data-up-tab="${k}" role="tab" aria-selected="${k === _upTab}">${l}</button>`).join('')}
      </div>
      <div class="up-grid${_upTab !== 'all' ? ' up-grid--uniform' : ''}" id="upGrid">${gridHTML}</div>
    </div>`;

  const upChatBtn = document.getElementById('upChatBtn');
  if (upChatBtn) {
    upChatBtn.addEventListener('click', async () => {
      $('userProfileModal').classList.remove('show');
      const { switchView } = await import('../ui/ui.js');
      switchView('chats');
      const { openChatThread } = await import('../chat/chat.js');
      openChatThread(uid);
    });
  }

  // Avatar rasmini kattalashtirish (boshqa user profili)
  const upAviEl = document.getElementById('upAviImg');
  if (upAviEl) {
    upAviEl.onclick = () => openZoom(av, 'avatar');
  }

  document.querySelectorAll('.up-grid-cell[data-id]').forEach(cell => {
    cell.addEventListener('click', () => openDetail(cell.dataset.id));
  });

  document.getElementById('upGridTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-up-tab]');
    if (!btn || btn.dataset.upTab === _upTab) return;
    _upTab = btn.dataset.upTab;
    document.querySelectorAll('#upGridTabs [data-up-tab]').forEach(b => {
      const on = b.dataset.upTab === _upTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    _paintUpGrid(uid);
  });
}

$('upBack').onclick = () => {
  state.currentViewingUserId    = null;
  state.currentViewingUserPosts = [];
  $('userProfileModal').classList.remove('show');
};
$('userProfileModal').addEventListener('click', e => {
  if (e.target === $('userProfileModal')) {
    state.currentViewingUserId    = null;
    state.currentViewingUserPosts = [];
    $('userProfileModal').classList.remove('show');
  }
});