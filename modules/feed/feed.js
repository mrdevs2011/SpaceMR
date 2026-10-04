import { busEmit } from '../core/rt-bus.js';
import { sb, state, CAP_LIMIT, getMediaUrl, isAdmin, mapProfile, MEDIA_BUCKET } from '../core/config.js';
import { $, esc, renderMarkdown, fmt, fmtSz, defAvi,
         showConfirm,
         dlFile, openZoom, showHeartBurst, fmtCount } from '../core/utils.js';
import { toast }                            from '../ui/toast.js';
import { schedulePaint }                   from '../core/perf.js';
import { getFileIcon } from '../core/file-icons.js';

/* ── Helpers ─────────────────────────────────────────────────────────── */

/* File type → SVG icon (mirrors upload.js getFileTypeInfo) */


export function filtered() {
  let p = [...state.allPosts];
  // Firestore postlar: isPublic === true bo'lsa hammaga, aks holda faqat egasiga
  p = p.filter(x => {
    if (x.userId === state.me?.uid) return true; // o'z postlari har doim ko'rinadi
    return x.isPublic === true;
  });
  if (state.search) {
    const q = state.search.toLowerCase();
    p = p.filter(x =>
      (x.text||'').toLowerCase().includes(q) ||
      (x.userFullName||'').toLowerCase().includes(q)
    );
  }
  return p;
}


export function buildCaption(text, postId) {
  if (!text) return '';
  const escaped = renderMarkdown(text);
  if (text.length <= CAP_LIMIT) return `<div class="post-caption">${escaped}</div>`;
  const short = renderMarkdown(text.substring(0, CAP_LIMIT));
  return `<div class="post-caption cap-collapsed" data-postid="${postId}">
    <span class="cap-short">${short}<span class="cap-more">...ko'proq</span></span>
    <span class="cap-full">${escaped}<span class="cap-more c-blue-theme">kamroq</span></span>
  </div>`;
}

export function buildMedia(p) {
  if (!p.mediaUrl) return '';
  // Post matni doim darrov ko'rinadi (buildCaption alohida chiziladi).
  // Media esa "pm-loading" holatida boshlanadi: agar postda mediaWidth/
  // mediaHeight saqlangan bo'lsa (yuklash paytida o'lchangan), post-card
  // ALDINDAN xuddi shu nisbatda joy ochib turadi — shu bois rasm
  // hali yuklanmasdan turib ham layout "sakramaydi", faqat blur bilan
  // ko'rinadi. To'liq yuklangach (onload) "pm-loading"
  // klassi olib tashlanadi va blur asta yo'qoladi.
  const ratio = (p.mediaWidth && p.mediaHeight)
    ? ` style="aspect-ratio:${p.mediaWidth}/${p.mediaHeight}"`
    : '';
  if (p.mediaType?.startsWith('image'))
    return `<div class="post-media pm-loading" data-id="${p.id}" data-type="image" data-url="${esc(p.mediaUrl)}"${ratio}><img src="${esc(p.mediaUrl)}" loading="lazy" decoding="async" onload="this.closest('.post-media')?.classList.remove('pm-loading')" onerror="this.closest('.post-media')?.classList.remove('pm-loading')"></div>`;
  return `<div class="file-card" data-url="${esc(p.mediaUrl)}" data-name="${esc(p.fileName||'file')}">
    <div class="file-card-icon">${getFileIcon(p.fileName||'', p.mediaType||'')}</div>
    <div class="file-info"><div class="file-name">${esc(p.fileName||'File')}</div><div class="file-size">${p.fileSize ? fmtSz(p.fileSize) : ''}</div></div>
    <button class="file-dl" data-url="${esc(p.mediaUrl)}" data-name="${esc(p.fileName||'file')}">Yuklab olish</button>
  </div>`;
}

/* ── Feed rendering ──────────────────────────────────────────────────── */
/** Scroll paytida faqat yangi postlarni qo'shadi (butun feed qayta yozilmaydi) */
async function appendPostsToFeed(feedEl, newPosts) {
  if (!newPosts.length) return;

  // Media URL larni olish
  await Promise.all(newPosts.map(async p => {
    if (!p.mediaUrl && (p.mediaPath || p.storageIndex)) {
      p.mediaUrl = await getMediaUrl(p);
    }
  }));

  // Vaqtinchalik konteyner orqali HTML yaratamiz
  const tempEl = document.createElement('div');
  tempEl.style.display = 'none';
  document.body.appendChild(tempEl);
  await renderFeedTo(tempEl, newPosts);
  document.body.removeChild(tempEl);

  // Yangi postlarni asosiy feed'ga ko'chiramiz
  const posts = tempEl.querySelectorAll('.post');
  posts.forEach(p => feedEl.appendChild(p));

  bindFeedEvents(feedEl);
}

export async function renderFeedTo(feedEl, posts) {
  if (!state.me || !feedEl) return;
  if (!posts.length) {
    if (state.search) {
      feedEl.innerHTML = `<div class="empty-search">
        <div class="empty-search-icon">
          <img src="./svg/action/search-overlay.svg" alt="" class="icon" width="20" height="20">
        </div>
        <div>Natija topilmadi: "<strong>${esc(state.search)}</strong>"</div>
        <div class="empty-search-hint">Boshqa so'z bilan qidirib ko'ring yoki imloni tekshiring</div>
      </div>`;
    } else {
      const createBtn = state.view === 'home'
        ? `<button class="empty-cta" onclick="document.querySelector('.nav-center-btn')?.click() || document.getElementById('createBtn')?.click()">Birinchi postingizni joylang</button>`
        : '';
      feedEl.innerHTML = `<div class="empty empty--home">
        <div class="empty-glow" aria-hidden="true"></div>
        <div class="empty-icon">
          <img src="./svg/extra/icon-44d5da9e7c91.svg" alt="" class="icon" width="36" height="36">
        </div>
        <div class="empty-title">Lenta hali bo'sh</div>
        <div class="empty-sub">Rasm yoki fikr bo'lishing — do'stlaringiz ko'radi.</div>
        ${createBtn}
      </div>`;
    }
    return;
  }

  // User cache dan foydalanish - Firestore reads kamaytirish
  const uids = [...new Set(posts.map(p => p.userId))];
  const uMap = {};
  const uidsToFetch = uids.filter(uid => !state._userCache[uid]);

  // Cache dan borlarni olish
  uids.forEach(uid => {
    if (state._userCache[uid]) {
      uMap[uid] = {
        fullName: state._userCache[uid].fullName,
        avatar: state._userCache[uid].avatar || defAvi(state._userCache[uid].fullName)
      };
    }
  });

  // Faqat cache da yo'qlarni yuklash
  if (uidsToFetch.length) {
    const { data: _uRows } = await sb.from('profiles')
      .select('id,full_name,avatar,username').in('id', uidsToFetch);
    const _uById = new Map((_uRows || []).map(r => [r.id, mapProfile(r)]));
    uidsToFetch.forEach(u => {
      const d = _uById.get(u) || {};
      state._userCache[u] = {
        uid: u,
        fullName: d.fullName,
        avatar: d.avatar,
        username: d.username
      };
      uMap[u] = { fullName: d.fullName, avatar: d.avatar || defAvi(d.fullName) };
    });
  } else {
  }

  // Like status cache dan foydalanish (local va Firestore postlar alohida collection)
  const unknownPosts = posts.filter(p => !state.myLikedPosts.has(p.id) && !state._knownUnliked.has(p.id));
  if (unknownPosts.length) {
    let likedRows = null;
    try {
      const { data, error } = await sb.from('post_likes').select('post_id')
        .eq('user_id', state.me.uid).in('post_id', unknownPosts.map(p => p.id));
      if (!error) likedRows = new Set((data || []).map(r => r.post_id));
    } catch (e) { console.warn('[feed]', e?.message || e); }
    if (likedRows) {
      unknownPosts.forEach(p => {
        if (likedRows.has(p.id)) state.myLikedPosts.add(p.id);
        else state._knownUnliked.add(p.id);
      });
    }
  }
  const likedSet = new Set(posts.filter(p => state.myLikedPosts.has(p.id)).map(p => p.id));

  // Multi-Supabase: Har bir post uchun mediaUrl yaratish (backward compatibility)
  await Promise.all(posts.map(async p => {
    if (!p.mediaUrl && (p.mediaPath || p.storageIndex)) {
      p.mediaUrl = await getMediaUrl(p);
    }
  }));

  // commentCount ni post documentidan olish
  const cMap = {};
  // Post objectidagi ma'lumotni ishlatamiz (har render'da Firestore o'qish o'rniga — RAM dan)
  posts.forEach(p => { cMap[p.id] = p.commentCount ?? 0; });

  await ensureSavedLoaded();

  let html = '';
  for (const p of posts) {
    const u        = uMap[p.userId] || {};
    const liked    = likedSet.has(p.id);
    const canDel   = state.me.uid === p.userId || isAdmin();
    const isMine   = state.me.uid === p.userId;
    const saved    = state.mySavedPosts.has(p.id);

    html += `<div class="post" data-id="${p.id}">
      <div class="post-head">
        <div class="avi user-avi-btn" data-uid="${p.userId}"><img src="${esc(u.avatar)}" onerror="this.style.display='none'"></div>
        <div class="post-meta user-avi-btn" data-uid="${p.userId}">
          <span class="post-name">${esc(u.fullName||'Noma\'lum')}</span>
          ${u.username ? `<span class="post-user">@${esc(u.username)}</span>` : ''}
          <span class="post-dot">·</span>
          <span class="post-time">${fmt(p.createdAt)}</span>
        </div>
        ${canDel ? `<button class="del-btn post-del-btn" data-id="${p.id}" title="O'chirish" aria-label="O'chirish">
          <img src="./svg/extra/icon-fb3793816331.svg" alt="" class="icon" width="15" height="15"></button>` : ''}
      </div>
      <div class="post-main">
        ${buildCaption(p.text, p.id)}
        ${buildMedia(p)}
        <div class="post-actions">
          <div class="post-actions-left">
            <button class="act-btn like-btn left-one${liked?' liked':''}" data-id="${p.id}" aria-label="Yoqtirish">
              ${liked
                ? '<img src="./svg/social/heart-filled.svg" alt="" class="icon" width="18" height="18">'
                : '<img src="./svg/social/heart.svg" alt="" class="icon" width="18" height="18">'}
              <span id="lc-${p.id}">${fmtCount(p.likes || 0)}</span>
            </button>
            <button class="act-btn cmt-open-btn left-two" data-id="${p.id}" aria-label="Izohlar">
              <img src="./svg/extra/icon-c10e4d45ebfa.svg" alt="" class="icon" width="18" height="18">
              <span id="cc-${p.id}">${fmtCount(cMap[p.id] || 0)}</span>
            </button>
            <button class="act-btn share-btn left-three"
              data-id="${p.id}"
              title="Chatga ulashish"
              aria-label="Chatga ulashish">
              <img src="./svg/extra/icon-22a55ac71fee.svg" alt="" class="icon" width="18" height="18">
            </button>
          </div>
          <div class="post-actions-right">
            <button class="act-btn link-btn right-one"
              data-id="${p.id}"
              title="Havolani nusxalash"
              aria-label="Havolani nusxalash">
              <img src="./svg/extra/icon-af51112fbda1.svg" alt="" class="icon" width="18" height="18">
            </button>
            <button class="act-btn save-btn right-two${saved?' saved':''}" data-id="${p.id}" title="${saved?'Saqlanganlardan olib tashlash':'Saqlash'}" aria-label="Saqlash" aria-pressed="${saved?'true':'false'}">
              ${saved
                  ? '<img src="./svg/social/bookmark-filled.svg" alt="" class="icon" width="18" height="18">'
                  : '<img src="./svg/social/bookmark-outline.svg" alt="" class="icon" width="18" height="18">'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }

  feedEl.innerHTML = html;
  bindFeedEvents(feedEl);
}

/* ── Init: URL'dan kelgan post id ni saqlab qo'yamiz (login qilmagan bo'lsa ham yo'qolmasligi uchun) ── */
try {
  const hash = window.location.hash || '';
  let initPostId = null;
  if (hash.startsWith('#post-')) initPostId = hash.slice(6);
  if (!initPostId) {
    const p = new URLSearchParams(window.location.search).get('post');
    if (p) initPostId = p;
  }
  if (initPostId) {
    sessionStorage.setItem('target_post_id', initPostId);
  }
} catch (_) {}

export async function copyPostLink(postId) {
  if (!postId) return;
  const postUrl = `${window.location.origin}/#post-${postId}`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(postUrl);
    } else {
      const ta = document.createElement('textarea');
      ta.value = postUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Havola nusxalandi', 'info');
  } catch (_) {
    toast('Havola nusxalandi', 'info');
  }
}

export async function sharePostToChat(postId) {
  if (!postId || !state.me) return;
  const post = state.allPosts?.find(p => p.id === postId);
  const postEl = document.querySelector(`.post[data-id="${postId}"]`);

  const authorName = postEl?.querySelector('.post-name')?.textContent || '';
  const authorUsername = postEl?.querySelector('.post-user')?.textContent?.replace(/^@/, '') || '';
  const authorAvatar = postEl?.querySelector('.post-head .avi img')?.src || '';
  const postText = postEl?.querySelector('.post-caption')?.textContent || post?.text || '';
  const postMediaEl = postEl?.querySelector('.post-media');
  const mediaImg = postMediaEl?.querySelector('img')?.src || '';
  const mediaUrl = post?.mediaUrl || mediaImg || '';
  const mediaType = post?.mediaType || (mediaImg ? 'image' : null);

  const payload = {
    id: postId,
    userId: post?.userId || postEl?.querySelector('.user-avi-btn')?.dataset.uid || '',
    authorName: authorName || 'Noma\'lum',
    authorUsername: authorUsername || '',
    authorAvatar: authorAvatar || '',
    text: (post?.text || postText || '').trim(),
    mediaUrl: mediaUrl,
    mediaType: mediaType,
    createdAt: post?.createdAt || Date.now()
  };

  const { setPendingPostShare } = await import('../chat/chat.js');
  setPendingPostShare(payload);
  const { navigateTo } = await import('../router.js');
  navigateTo('chats');
  toast("Post biriktirildi. Suhbat yoki guruhni tanlang", "info");
}

export function getTargetPostId() {
  const hash = window.location.hash || '';
  if (hash.startsWith('#post-')) return hash.slice(6);
  try {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('post');
    if (p) return p;
  } catch (_) {}
  return sessionStorage.getItem('target_post_id') || null;
}

let _scrolledTargetId = null;

/* ── Glow: lenta qayta chizilganda ham 5 soniya to'liq davom etadi ── */
const HL_MS = 5000;
let _hlId = null;
let _hlStart = 0;

function applyPostHighlight(el) {
  const elapsed = Math.max(0, Date.now() - _hlStart);
  el.style.setProperty('--hl-delay', `-${elapsed}ms`); // yangi element ham qolgan joyidan davom etadi
  el.classList.add('post-link-highlight');
}

function reapplyPostHighlight() {
  if (!_hlId) return;
  if (Date.now() - _hlStart >= HL_MS) { _hlId = null; return; }
  const el = document.querySelector(`.post[data-id="${_hlId}"]`);
  if (el && !el.classList.contains('post-link-highlight')) applyPostHighlight(el);
}

/* ── Scroll to post by URL hash or query (faqat login qilgan userlar uchun) ── */
export function scrollToPostFromHash() {
  if (!state.me?.uid) return;
  const targetId = getTargetPostId();
  if (!targetId || _scrolledTargetId === targetId) return;

  let attempts = 0;
  const tryScroll = async () => {
    let el = document.querySelector(`.post[data-id="${targetId}"]`);
    if (el) {
      _scrolledTargetId = targetId;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 5 sekund tagidan rang yonib turib keyin o'chadi
      _hlId = targetId;
      _hlStart = Date.now();
      applyPostHighlight(el);
      try {
        if (window.location.hash.startsWith('#post-')) {
          history.replaceState(null, '', window.location.pathname);
        }
      } catch (_) {}
      setTimeout(() => {
        // Element lenta qayta chizilganda almashgan bo'lishi mumkin — hozirgisini tozalaymiz
        document.querySelectorAll('.post.post-link-highlight').forEach(x => x.classList.remove('post-link-highlight'));
        _hlId = null;
        sessionStorage.removeItem('target_post_id');
      }, HL_MS);
      return;
    }

    if (attempts === 2) {
      try {
        const { data: postRow } = await sb.from('posts').select('*').eq('id', targetId).maybeSingle();
        if (postRow) {
          const p = mapPost(postRow);
          if (!state.allPosts.some(x => x.id === p.id)) {
            state.allPosts.unshift(p);
            await renderFeed();
            return;
          }
        }
      } catch (_) {}
    }

    attempts++;
    if (attempts < 12) setTimeout(tryScroll, 300);
  };
  setTimeout(tryScroll, 250);
}

/* Ilova ichidan post linkini ochish — "Havolani nusxalash" qilingan
   `${origin}/#post-<id>` ni brauzerga kiritganday: lenta, shu postga scroll + yonish. */
export async function openPostLink(postId) {
  if (!postId) return;
  _scrolledTargetId = null;     // oldin shu post ochilgan bo'lsa ham qayta ishlasin
  _hashPostHandled = false;     // visibleN ni shu postgacha kengaytirsin
  sessionStorage.setItem('target_post_id', postId);
  window.location.hash = '#post-' + postId;
  const { navigateTo } = await import('../router.js');
  navigateTo('home');
  await renderFeed();           // targetId bor -> scrollToPostFromHash o'zi chaqiriladi
}

/* Event delegation — har feed konteyner uchun bir marta (#feed, #savedFeed, ...) */
const _feedBoundEls = new WeakSet();
function bindFeedEvents(feedEl) {
  if (!feedEl || _feedBoundEls.has(feedEl)) return;
  _feedBoundEls.add(feedEl);
  feedEl.addEventListener('click', async (e) => {
    const t = e.target;
    // Post rasm → lightbox (pinch zoom)
    const media = t.closest('.post-media');
    if (media && media.dataset.type === 'image') {
      const url = media.dataset.url || media.querySelector('img')?.src;
      if (url) { e.stopPropagation(); openZoom(url, 'image'); return; }
    }
    const like = t.closest('.like-btn');
    if (like) { e.stopPropagation(); doLike(like.dataset.id, like); return; }
    const save = t.closest('.save-btn');
    if (save) { e.stopPropagation(); doSave(save.dataset.id); return; }
    const cmt = t.closest('.cmt-open-btn');
    if (cmt) {
      e.stopPropagation();
      const { openCmtModal } = await import('./comments.js');
      openCmtModal(cmt.dataset.id);
      return;
    }
    const link = t.closest('.link-btn');
    if (link) { e.stopPropagation(); copyPostLink(link.dataset.id); return; }
    const share = t.closest('.share-btn');
    if (share) { e.stopPropagation(); sharePostToChat(share.dataset.id); return; }
    const avi = t.closest('.user-avi-btn');
    if (avi && avi.dataset.uid && avi.dataset.uid !== state.me?.uid) {
      e.stopPropagation();
      const { openUserProfileModal } = await import('../profile/profile.js');
      openUserProfileModal(avi.dataset.uid);
      return;
    }
    const dl = t.closest('.file-dl');
    if (dl) { e.stopPropagation(); dlFile(dl.dataset.url, dl.dataset.name); return; }
    const card = t.closest('.file-card');
    if (card && !t.closest('.file-dl')) {
      const url = card.dataset.url;
      if (url) window.open(url, '_blank', 'noopener');
      return;
    }
    const more = t.closest('.cap-more');
    if (more) {
      e.stopPropagation();
      const cap = more.closest('.post-caption');
      if (cap) { cap.classList.toggle('cap-collapsed'); cap.classList.toggle('cap-expanded'); }
      return;
    }
    const del = t.closest('.post-del-btn');
    if (del) { e.stopPropagation(); await doDelete(del.dataset.id); return; }
  });
}

/* ── Saqlash (bookmark): saved_posts jadvali ─────────────────────────── */
let _savedLoad = null;
/** Mening saqlangan post id'larim (bir marta yuklanadi, foydalanuvchi almashsa qayta). */
export function ensureSavedLoaded() {
  const uid = state.me?.uid;
  if (!uid) return Promise.resolve();
  if (state._savedFor === uid && _savedLoad) return _savedLoad;
  state._savedFor = uid;
  state.mySavedPosts = new Set();
  _savedLoad = (async () => {
    try {
      const { data, error } = await sb.from('saved_posts').select('post_id')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(1000);
      if (error) throw error;
      state.mySavedPosts = new Set((data || []).map(r => r.post_id));
    } catch (e) {
      console.warn('[feed] saved yuklanmadi:', e?.message || e);
      _savedLoad = null; state._savedFor = null;
    }
  })();
  return _savedLoad;
}

function paintSaveBtn(btn, on) {
  btn.classList.toggle('saved', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on ? 'Saqlanganlardan olib tashlash' : 'Saqlash';
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', on ? 'currentColor' : 'none');
    if (on) svg.setAttribute('stroke', 'none');
    else svg.setAttribute('stroke', 'currentColor');
  }
}

const _saveLocks = new Set();
export async function doSave(postId) {
  if (!state.me || _saveLocks.has(postId)) return;
  _saveLocks.add(postId);
  const wasSaved = state.mySavedPosts.has(postId);
  const sync = on => document.querySelectorAll(`.save-btn[data-id="${postId}"]`).forEach(b => paintSaveBtn(b, on));

  if (wasSaved) state.mySavedPosts.delete(postId); else state.mySavedPosts.add(postId);
  sync(!wasSaved);
  if (wasSaved) {
    const post = document.querySelector(`#savedFeed .post[data-id="${postId}"]`);
    if (post) { post.remove(); window.dispatchEvent(new Event('spacemr:saved-changed')); }
  }

  try {
    if (wasSaved) {
      const { error } = await sb.from('saved_posts').delete().eq('post_id', postId).eq('user_id', state.me.uid);
      if (error) throw error;
    } else {
      const { error } = await sb.from('saved_posts').insert({ post_id: postId, user_id: state.me.uid });
      if (error && error.code !== '23505') throw error; // 23505 = allaqachon saqlangan
    }
  } catch (err) {
    console.warn('[Feed] Saqlash bajarilmadi:', err?.message);
    if (wasSaved) state.mySavedPosts.add(postId); else state.mySavedPosts.delete(postId);
    sync(wasSaved);
    toast("Saqlab bo'lmadi", 'error');
  } finally {
    _saveLocks.delete(postId);
  }
}

/* ── Like ────────────────────────────────────────────────────────────── */
const _likeLocks = new Set();
export async function doLike(postId, btn) {
  if (!state.me) return;
  if (_likeLocks.has(postId)) return;
  _likeLocks.add(postId);
  
  const wasLiked = state.myLikedPosts.has(postId);
  const post     = state.allPosts.find(p => p.id === postId);
  const svg      = btn.querySelector('svg');
  const lc       = document.getElementById(`lc-${postId}`);
  const cur      = post?.likes ?? (parseInt(lc?.textContent, 10) || 0); // Saqlanganlar kabi allPosts'da yo'q postlar uchun DOM'dan

  if (wasLiked) {
    state.myLikedPosts.delete(postId);
    state._knownUnliked.add(postId);
    btn.classList.remove('liked');
    svg?.setAttribute('fill','none'); svg?.setAttribute('stroke','currentColor');
    if (lc) lc.textContent = fmtCount(Math.max(0,cur-1));
    if (post) post.likes = Math.max(0, cur-1);
  } else {
    state.myLikedPosts.add(postId);
    state._knownUnliked.delete(postId);
    btn.classList.add('liked');
    svg?.setAttribute('fill','#f91880'); svg?.setAttribute('stroke','#f91880');
    if (lc) lc.textContent = fmtCount(cur+1);
    if (post) post.likes = cur + 1;
    btn.classList.add('like-pop');
    setTimeout(() => btn.classList.remove('like-pop'), 400);
  }

  // Boshqalarga shu zahoti (DB trigger/postgres_changes kutilmaydi)
  busEmit('like', { postId, n: post?.likes ?? (wasLiked ? Math.max(0, cur-1) : cur+1), on: !wasLiked });

  // Like sonini DB trigger yangilaydi (post_likes → posts.likes_count)
  try {
    if (wasLiked) {
      const { error } = await sb.from('post_likes').delete()
        .eq('post_id', postId).eq('user_id', state.me.uid);
      if (error) throw error;
    } else {
      const { error } = await sb.from('post_likes')
        .insert({ post_id: postId, user_id: state.me.uid });
      if (error && error.code !== '23505') throw error; // 23505 = allaqachon like
    }
  } catch (err) {
    console.warn('[Feed] Like saqlanmadi:', err?.message);
  } finally {
    _likeLocks.delete(postId);
  }
}

/* ── Delete ──────────────────────────────────────────────────────────── */
export async function doDelete(id) {
  // Confirm card yo'q — to'g'ridan-to'g'ri o'chiradi (faqat profil detail dan)
  const post = state.allPosts?.find(p => p.id === id);
  if (!post) return;
  if (post.userId !== state.me?.uid && !isAdmin()) {
    toast("Faqat o'z postingizni o'chira olasiz", 'error');
    return;
  }
  const { error } = await sb.from('posts').delete().eq('id', id);
  if (error) { toast("O'chirib bo'lmadi: " + error.message, 'error'); return; }
  if (post?.mediaPath) sb.storage.from(MEDIA_BUCKET).remove([post.mediaPath]).catch(() => {});
  state.allPosts = state.allPosts.filter(p => p.id !== id);
  document.querySelector(`.post[data-id="${id}"]`)?.remove();
  document.querySelector(`.grid-cell[data-id="${id}"]`)?.remove();
  busEmit('post', { op: 'del', id });
  toast("Post o'chirildi", 'success');
  document.dispatchEvent(new CustomEvent('postsUpdated'));
}
/* ── Keyboard Controls ───────────────────────────────────────────────── */
/* ── patchCounts — update numbers without full re-render ─────────────── */
export function patchCounts(posts) {
  posts.forEach(p => {
    // Like count
    const lc = document.getElementById(`lc-${p.id}`);
    if (lc) lc.textContent = fmtCount(p.likes || 0);

    const rlc = document.querySelector(`.rlc-${p.id}`);
    if (rlc) rlc.textContent = `${p.likes || 0}`;

    // Comment count
    const cc = document.getElementById(`cc-${p.id}`);
    if (cc) cc.textContent = fmtCount(p.commentCount || 0);

    const rcc = document.querySelector(`.rcmt-${p.id}`);
    if (rcc) rcc.textContent = `${p.commentCount || 0}`;

  });
}

/* ── Birinchi render da spinner ──────────────────────────── */
let _feedFirstRender = true;
let _hashPostHandled = false; // link orqali kelingan postni faqat bir marta moslashtiramiz

/* ── Scroll joyini saqlash: feed qayta chizilganda (yangi post, realtime, keyingi postlar
   yuklanishi) foydalanuvchi eng tepaga sakramasin — ko'rinib turgan post o'z joyida qoladi ── */
function captureScrollAnchor(feedEl) {
  // scrollY + ko'rinadigan postlar — qayta chizishda tepaga sakramaslik uchun
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const list = [];
  if (feedEl) {
    for (const el of feedEl.querySelectorAll('.post')) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0) continue;
      list.push({ id: el.dataset.id, top: r.top });
      if (list.length >= 12 || r.top > window.innerHeight) break;
    }
  }
  return { y, anchors: list.length ? list : null, h: feedEl ? feedEl.offsetHeight : 0 };
}
function restoreScrollAnchor(feedEl, snap) {
  if (!snap) return;
  // 1) Post ID bo'yicha nozik tiklash
  if (snap.anchors && feedEl) {
    const posts = Array.from(feedEl.querySelectorAll('.post'));
    for (const a of snap.anchors) {
      const el = posts.find(x => x.dataset.id === a.id);
      if (!el) continue;
      const delta = el.getBoundingClientRect().top - a.top;
      if (Math.abs(delta) > 1) {
        window.scrollBy(0, delta);
      }
      return;
    }
  }
  // 2) ID topilmasa (optimistic id almashtirilgan) — oddiy scrollY
  const y = snap.y || 0;
  if (y > 0 && Math.abs((window.scrollY || 0) - y) > 2) {
    window.scrollTo(0, y);
  }
}

/* ── renderFeed ────────────────────────────────────────────────────── */
export async function renderFeed() {
  if (!state.me) return;
  const feedEl = $('feed');

  // URL'da #post-<id> hash bo'lsa (masalan, "Havolani nusxalash" orqali
  // ulashilgan link), lekin o'sha post visibleN chegarasidan tashqarida
  // (ya'ni feedning pastida) bo'lsa — u hali render qilinmagan bo'ladi va
  // pastdagi scrollToPostFromHash uni topa olmay, sukut bilan hech narsa
  // qilmaydi. Shuning uchun avval postni filtered() ro'yxatida topib,
  // kerak bo'lsa visibleN ni shu postgacha (+bir oz zaxira) oshiramiz.
  const targetId = getTargetPostId();
  if (!_hashPostHandled && targetId) {
    const all = filtered();
    const idx = all.findIndex(p => String(p.id) === String(targetId));
    if (idx !== -1) {
      if (idx >= state.visibleN) state.visibleN = Math.min(idx + 10, all.length);
      _hashPostHandled = true;
    }
  }

  const posts  = filtered().slice(0, state.visibleN);

  // Scroll joyini saqlab qolamiz — realtime/optimistic qayta chizishda tepaga sakramasin
  const _snap = (!targetId && state.view === 'home') ? captureScrollAnchor(feedEl) : null;
  if (_snap?.h > 0 && feedEl) feedEl.style.minHeight = _snap.h + 'px';

  // Birinchi renderda spinner
  if (_feedFirstRender && !feedEl.querySelector('.post')) {
    feedEl.innerHTML = '<div class="spin-wrap"><div class="spinner"></div></div>';
  }
  _feedFirstRender = false;

  await renderFeedTo(feedEl, posts);
  restoreScrollAnchor(feedEl, _snap);
  // minHeight ni keyingi kadrda olib tashlash (layout barqarorlashgach)
  if (feedEl) requestAnimationFrame(() => { feedEl.style.minHeight = ''; });
  reapplyPostHighlight();


  // URL hash yoki query da post id bo'lsa — o'sha postga smooth scroll va ko'k yonish
  if (targetId) scrollToPostFromHash();

  if (state.visibleN < filtered().length || (!state.search && state.view === 'home' && !window.__feedFullyLoaded)) {
    feedEl.insertAdjacentHTML('beforeend', '<div class="spin-wrap"><div class="spinner"></div></div>');
  }
  setupScroll();
}

let _scrollBound = false;
let _scrollTicking = false;
async function _onFeedScroll() {
  if (state.loadingMore || state.view !== 'home') return;
  const maxN = filtered().length;
  if (window.scrollY + window.innerHeight < document.body.scrollHeight - 500) return;

  if (state.visibleN >= maxN) {
    if (window.__fetchMorePosts && !state.search) {
      state.loadingMore = true;
      try {
        const hasMore = await window.__fetchMorePosts();
        if (!hasMore) $('feed')?.querySelector('.spin-wrap')?.remove();
      } finally {
        state.loadingMore = false;
      }
    }
    return;
  }

  state.loadingMore = true;
  try {
    const prevN = state.visibleN;
    state.visibleN = Math.min(prevN + 10, filtered().length);
    const feedEl = $('feed');
    if (!feedEl) return;
    feedEl.querySelector('.spin-wrap')?.remove();
    const newPosts = filtered().slice(prevN, state.visibleN);
    if (newPosts.length > 0) await appendPostsToFeed(feedEl, newPosts);
    if (state.visibleN < filtered().length || (window.__fetchMorePosts && !state.search)) {
      feedEl.insertAdjacentHTML('beforeend', '<div class="spin-wrap"><div class="spinner"></div></div>');
    }
  } finally {
    state.loadingMore = false;
  }
}
function setupScroll() {
  if (_scrollBound) return;
  _scrollBound = true;
  window.addEventListener('scroll', () => {
    if (_scrollTicking) return;
    _scrollTicking = true;
    requestAnimationFrame(() => {
      _scrollTicking = false;
      _onFeedScroll();
    });
  }, { passive: true });
}
/* ── FIX: setupPullToRefresh ─────────────────── */
export function setupPullToRefresh() {
    const homeView = document.getElementById('homeView');
    if (!homeView || homeView._ptrReady) return;
    homeView._ptrReady = true;

    let startY    = 0;
    let isPulling = false;
    let distance  = 0;

    homeView.addEventListener('touchstart', e => {
        if (window.scrollY <= 5) {
            startY    = e.touches[0].clientY;
            isPulling = true;
            distance  = 0;
        }
    }, { passive: true });

    homeView.addEventListener('touchmove', e => {
        if (!isPulling) return;
        distance = e.touches[0].clientY - startY;
    }, { passive: true });

    homeView.addEventListener('touchend', async () => {
        if (isPulling && distance > 130) {
            await renderFeed();
            try { const { loadStories } = await import('./stories.js'); await loadStories(); } catch (_) {}
            toast('Yangilandi', 'success', 1200);
        }
        isPulling = false;
        distance  = 0;
    });
}

/* ── Feed scroll: native scroll ishlatiladi (silliq, momentum bilan) ── */
export function setupFeedScrollSensitivity() {
    // Native browser scroll intentionally used — no override needed.
    // Custom touchmove override was causing janky scroll on iOS/Android.
}