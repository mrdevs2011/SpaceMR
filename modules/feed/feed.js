import { busEmit } from '../core/rt-bus.js';
import { sb, state, CAP_LIMIT, getMediaUrl, isAdmin, mapProfile, mapPost, MEDIA_BUCKET } from '../core/config.js';
import { $, esc, renderMarkdown, fmt, fmtSz, defAvi,
         showConfirm,
         dlFile, openZoom, showHeartBurst, fmtCount, smoothScrollIntoView} from '../core/utils.js';
import { toast }                            from '../ui/toast.js';
import { schedulePaint }                   from '../core/perf.js';
import { getFileIcon } from '../core/file-icons.js';
import './post-image-zoom.js';
import { cachedMediaUrlSync, resolvePublicMedia } from '../core/store/media-cache.js';
import { syncLike } from './like-sync.js';
import { ensureVideoDuration, hardenVideoPlayback } from '../core/video-policy.js';
// Feed/upload native <video controls>: WebM duration Infinity → progress oxirida qotadi
if (typeof window !== 'undefined') {
  window.__fixVidDur = function (v) {
    try { ensureVideoDuration(v); } catch (_) {}
    try { hardenVideoPlayback(v); } catch (_) {}
  };
}


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
    <span class="cap-short">${short}…<span class="cap-more">Ko'proq ko'rsatish</span></span>
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
  const mt = (p.mediaType || '').toLowerCase();
  const urlL = String(p.mediaUrl || '').toLowerCase();
  const isImg = mt.startsWith('image') || /\.(jpe?g|png|gif|webp|avif|heic|bmp)(\?|$)/i.test(urlL);
  const isVid = mt.startsWith('video') || /\.(mp4|webm|mov|mkv|avi)(\?|$)/i.test(urlL);
  if (isImg)
    return `<div class="post-media pm-loading" data-id="${p.id}" data-type="image" data-url="${esc(p.mediaUrl)}"${ratio} role="button" tabindex="0" aria-label="Rasmni kattalashtirish"><img src="${esc(p.mediaUrl)}" loading="lazy" decoding="async" onload="this.closest('.post-media')?.classList.remove('pm-loading')" onerror="this.closest('.post-media')?.classList.remove('pm-loading')"></div>`;
  if (isVid)
    return `<div class="post-media" data-id="${p.id}" data-type="video" data-url="${esc(p.mediaUrl)}"${ratio}><video src="${esc(p.mediaUrl)}" controls playsinline preload="metadata" style="width:100%;height:auto;display:block;background:#000" onloadedmetadata="window.__fixVidDur&&window.__fixVidDur(this)"></video></div>`;
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
        username: state._userCache[uid].username,
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
      uMap[u] = { fullName: d.fullName, username: d.username, avatar: d.avatar || defAvi(d.fullName) };
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
        <div class="avi user-avi-btn" data-uid="${p.userId}"><img loading="lazy" decoding="async" src="${esc(u.avatar)}" onerror="this.style.display='none'"></div>
        <div class="post-meta user-avi-btn" data-uid="${p.userId}">
          <span class="post-name">${esc(u.fullName||'Noma\'lum')}</span>
          ${u.username ? `<span class="post-user">@${esc(u.username)}</span>` : ''}
          <span class="post-dot">·</span>
          <span class="post-time" style="cursor:pointer" title="Postni ochish">${fmt(p.createdAt)}</span>
        </div>
        <button class="post-more-btn" data-id="${p.id}" data-uid="${p.userId}" data-can-del="${canDel ? '1' : ''}" title="Yana" aria-label="Yana" aria-haspopup="menu">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
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

  if (feedEl.id === 'feed') reconcileFeed(feedEl, html, posts);
  else feedEl.innerHTML = html;
  bindFeedEvents(feedEl);
}

/* Asosiy lenta: butun innerHTML ni almashtirish o'rniga faqat farqni qo'llaymiz —
   yangi postni qo'shamiz, o'chganini olib tashlaymiz, qolgan postlar DOM da o'z joyida
   qoladi (rasm/video qayta yuklanmaydi, sahifa tepaga sakramaydi). */
function reconcileFeed(feedEl, html, posts) {
  const existing = new Map();
  for (const el of Array.from(feedEl.children)) {
    if (el.classList.contains('post') && el.dataset.id) existing.set(el.dataset.id, el);
  }
  if (!existing.size) { feedEl.innerHTML = html; return; }   // birinchi chizish / bo'sh holat

  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const fresh = new Map();
  for (const el of Array.from(tpl.content.children)) {
    if (el.classList.contains('post') && el.dataset.id) fresh.set(el.dataset.id, el);
  }

  // Spinner / bo'sh holat kabi post bo'lmaganlarni olib tashlaymiz (renderFeed qayta qo'shadi)
  for (const el of Array.from(feedEl.children)) {
    if (!el.classList.contains('post')) el.remove();
  }
  const wanted = new Set(posts.map(p => String(p.id)));
  existing.forEach((el, id) => { if (!wanted.has(id)) el.remove(); });

  let prev = null;
  for (const p of posts) {
    const id = String(p.id);
    const el = existing.get(id) || fresh.get(id);
    if (!el) continue;
    const at = prev ? prev.nextElementSibling : feedEl.firstElementChild;
    if (at !== el) feedEl.insertBefore(el, at);
    prev = el;
  }
}

/* ── Init: URL'dan kelgan post id ni saqlab qo'yamiz (login qilmagan bo'lsa ham yo'qolmasligi uchun) ── */
try {
  const hash = window.location.hash || '';
  let initPostId = null, initCmtId = null;
  if (hash.startsWith('#post-')) {
    const [pid, cid] = hash.slice(6).split('~c-');   // #post-<postId>~c-<izohId>
    initPostId = pid; initCmtId = cid || null;
  }
  if (!initPostId) {
    const p = new URLSearchParams(window.location.search).get('post');
    if (p) initPostId = p;
  }
  if (initPostId) {
    sessionStorage.setItem('target_post_id', initPostId);
    if (initCmtId) sessionStorage.setItem('target_cmt_id', initCmtId);
    else sessionStorage.removeItem('target_cmt_id');
  }
} catch (_) {}

export async function copyPostLink(postId) {
  if (!postId) return;
  return copyUrl(`${window.location.origin}/p/${postId}`);
}

/** Izoh havolasi: ochilganda o'sha postga o'tadi, izohlarni ochadi va izohni yoritadi. */
export async function copyCommentLink(postId, cmtId) {
  if (!postId || !cmtId) return;
  return copyUrl(`${window.location.origin}/p/${postId}#c-${cmtId}`);
}

async function copyUrl(postUrl) {
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
  const mediaVid = postMediaEl?.querySelector('video')?.currentSrc || postMediaEl?.querySelector('video')?.src || '';
  const mediaAud = postMediaEl?.querySelector('audio')?.currentSrc || postMediaEl?.querySelector('audio')?.src || '';
  const mediaUrl = post?.mediaUrl || mediaImg || mediaVid || mediaAud || '';
  const mediaPath = post?.mediaPath || '';
  let mediaType = post?.mediaType || null;
  if (!mediaType) {
    if (mediaImg) mediaType = 'image';
    else if (mediaVid) mediaType = 'video';
    else if (mediaAud) mediaType = 'audio';
  }

  const payload = {
    id: postId,
    userId: post?.userId || postEl?.querySelector('.user-avi-btn')?.dataset.uid || '',
    authorName: authorName || "Noma'lum",
    authorUsername: authorUsername || '',
    authorAvatar: authorAvatar || '',
    text: (post?.text || postText || '').trim(),
    mediaUrl: mediaUrl,
    mediaPath: mediaPath,
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
  if (hash.startsWith('#post-')) return hash.slice(6).split('~c-')[0];
  try {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('post');
    if (p) return p;
  } catch (_) {}
  return sessionStorage.getItem('target_post_id') || null;
}

export function getTargetCommentId() {
  const hash = window.location.hash || '';
  if (hash.startsWith('#post-')) return hash.slice(6).split('~c-')[1] || null;
  return sessionStorage.getItem('target_cmt_id') || null;
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));
const CMT_HL_MS = 5000;

/* Izoh havolasi bilan kelinganda: izohlarni ochamiz, izohga scroll qilamiz va yoritamiz */
async function focusCommentFromLink(postId, cmtId) {
  try {
    const { openCmtModal } = await import('./comments.js');
    const open = document.querySelector(`.post[data-id="${postId}"] .post-cmt-panel`) || state.cmtPostId === postId;
    if (!open) await openCmtModal(postId);
    for (let i = 0; i < 24; i++) {
      const row = document.querySelector(`.cmt-row[data-cmt-id="${cmtId}"]`);
      if (row) {
        smoothScrollIntoView(row, { block: 'center' });
        row.classList.add('cmt-link-highlight');
        setTimeout(() => row.classList.remove('cmt-link-highlight'), CMT_HL_MS);
        return;
      }
      await _sleep(250);
    }
    toast("Izoh topilmadi — o'chirilgan bo'lishi mumkin", 'error');
  } catch (e) { console.warn('[feed] izohga o\'tilmadi:', e?.message || e); }
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
      smoothScrollIntoView(el, { block: 'center' });
      const cmtId = getTargetCommentId();
      if (cmtId) {
        // Izoh havolasi: yoritish izohning o'zida bo'ladi, post emas
        focusCommentFromLink(targetId, cmtId);
      } else {
        // 5 sekund tagidan rang yonib turib keyin o'chadi
        _hlId = targetId;
        _hlStart = Date.now();
        applyPostHighlight(el);
        if (state.focusOpenCmts) {
          state.focusOpenCmts = false;
          import('./comments.js').then(m => { if (!m.isCmtOpen(targetId)) m.openCmtModal(targetId); }).catch(() => {});
        }
      }
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
        sessionStorage.removeItem('target_cmt_id');
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
export async function openPostLink(postId, cmtId = null, opts = {}) {
  if (!postId) return;
  _scrolledTargetId = null;     // oldin shu post ochilgan bo'lsa ham qayta ishlasin
  _hashPostHandled = false;     // visibleN ni shu postgacha kengaytirsin
  sessionStorage.setItem('target_post_id', postId);
  if (cmtId) sessionStorage.setItem('target_cmt_id', cmtId);
  else sessionStorage.removeItem('target_cmt_id');
  const { navigateTo } = await import('../router.js');
  navigateTo('home');           // fokusni tozalaydi
  state.focusPostId = postId;   // URL: /p/<id>[#c-<izoh>]
  state.focusCmtId = cmtId || null;
  state.focusOpenCmts = !!opts.comments;   // /p/<id>/comments: post ochilgach izohlar ham ochiladi
  window.dispatchEvent(new Event('spacemr:route'));
  await renderFeed();           // targetId bor -> scrollToPostFromHash o'zi chaqiriladi
}

/* Event delegation — har feed konteyner uchun bir marta (#feed, #savedFeed, ...) */
const _feedBoundEls = new WeakSet();
function bindFeedEvents(feedEl) {
  if (!feedEl || _feedBoundEls.has(feedEl)) return;
  _feedBoundEls.add(feedEl);
  feedEl.addEventListener('click', async (e) => {
    const t = e.target;
    // Post rasm → lightbox (chatdagi kabi zoom)
    const media = t.closest('.post-media');
    if (media && (media.dataset.type === 'image' || media.querySelector('img'))) {
      const url = media.dataset.url || media.querySelector('img')?.currentSrc || media.querySelector('img')?.src;
      if (url && !t.closest('video, a, button')) {
        e.preventDefault();
        e.stopPropagation();
        openZoom(url, 'image');
        return;
      }
    }
    const like = t.closest('.like-btn');
    if (like) { e.stopPropagation(); doLike(like.dataset.id, like); return; }
    const save = t.closest('.save-btn');
    if (save) { e.stopPropagation(); doSave(save.dataset.id, save); return; }
    const cmt = t.closest('.cmt-open-btn');
    if (cmt) {
      e.stopPropagation();
      const { openCmtModal } = await import('./comments.js');
      openCmtModal(cmt.dataset.id);
      return;
    }
    const tm = t.closest('.post-time');
    if (tm) {
      const pe = tm.closest('.post');
      if (pe?.dataset.id) { e.stopPropagation(); openPostLink(pe.dataset.id); return; }
    }
    const link = t.closest('.link-btn');
    if (link) { e.stopPropagation(); copyPostLink(link.dataset.id); return; }
    const share = t.closest('.share-btn');
    if (share) { e.stopPropagation(); sharePostToChat(share.dataset.id); return; }
    const avi = t.closest('.user-avi-btn');
    if (avi && avi.dataset.uid) {
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
      if (url) location.assign(url);
      return;
    }
    const capMore = t.closest('.cap-more');
    if (capMore) {
      e.stopPropagation();
      const cap = capMore.closest('.post-caption');
      if (cap) { cap.classList.toggle('cap-collapsed'); cap.classList.toggle('cap-expanded'); }
      return;
    }
    const more = t.closest('.post-more-btn');
    if (more) { e.stopPropagation(); openPostMenu(more); return; }
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
      const { data, error } = await Promise.race([
        sb.from('saved_posts').select('post_id')
          .eq('user_id', uid).order('created_at', { ascending: false }).limit(1000),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
      ]);
      if (error) throw error;
      state.mySavedPosts = new Set((data || []).map(r => r.post_id));
    } catch (e) {
      console.warn('[feed] saved yuklanmadi:', e?.message || e);
      _savedLoad = null; state._savedFor = null;
    }
  })();
  return _savedLoad;
}

/* Ikonkalarni oldindan yuklaymiz: bosilganda src almashishi tarmoq/dekodni kutmasin (0ms, titroqsiz) */
const _PRELOAD_ICONS = ['heart', 'heart-filled', 'bookmark-outline', 'bookmark-filled'];
const _preloaded = [];
try {
  _PRELOAD_ICONS.forEach(n => {
    const im = new Image();
    im.decoding = 'sync';
    im.src = './svg/social/' + n + '.svg';
    _preloaded.push(im);
  });
} catch (_) {}

function paintSaveBtn(btn, on) {
  btn.classList.toggle('saved', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on ? 'Saqlanganlardan olib tashlash' : 'Saqlash';
  // Bookmark endi <img> — manbani almashtiramiz (to'la / kontur)
  const im = btn.querySelector('img.icon');
  if (im && (im.getAttribute('src') || '').includes('/bookmark')) {
    im.setAttribute('src', on ? './svg/social/bookmark-filled.svg' : './svg/social/bookmark-outline.svg');
  }
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', on ? 'currentColor' : 'none');
    if (on) svg.setAttribute('stroke', 'none');
    else svg.setAttribute('stroke', 'currentColor');
  }
}

/* Saqlash: UI shu zahoti (0ms) o'zgaradi, server bilan orqa fonda sinxronlanadi.
   Haqiqat manbai — foydalanuvchi ko'rib turgan tugma holati (Set hali yuklanmagan bo'lishi mumkin).
   Tez-tez bosilsa — faqat oxirgi istalgan holat serverga yoziladi. */
const _saveWant = new Map();    // postId -> istalgan holat
const _saveServer = new Map();  // postId -> serverda tasdiqlangan holat
const _saveBusy = new Set();

export function doSave(postId, btn) {
  if (!state.me) return;
  const was = btn ? btn.classList.contains('saved') : state.mySavedPosts.has(postId);
  const want = !was;
  if (!_saveServer.has(postId)) _saveServer.set(postId, was);

  if (want) state.mySavedPosts.add(postId); else state.mySavedPosts.delete(postId);
  document.querySelectorAll('.save-btn[data-id="' + postId + '"]').forEach(b => paintSaveBtn(b, want));
  if (btn) paintSaveBtn(btn, want);
  if (!want) {
    const post = document.querySelector('#savedFeed .post[data-id="' + postId + '"]');
    if (post) { post.remove(); window.dispatchEvent(new Event('spacemr:saved-changed')); }
  }
  _saveWant.set(postId, want);
  _flushSave(postId);
}

async function _flushSave(postId) {
  if (_saveBusy.has(postId)) return;
  _saveBusy.add(postId);
  try {
    while (_saveWant.get(postId) !== _saveServer.get(postId)) {
      const target = _saveWant.get(postId);
      try {
        if (target) {
          // upsert + ignoreDuplicates: allaqachon saqlangan bo'lsa 409 (konsol xatosi) o'rniga jimgina o'tadi
          const { error } = await sb.from('saved_posts').upsert({ post_id: postId, user_id: state.me.uid }, { onConflict: 'user_id,post_id', ignoreDuplicates: true });
          if (error && error.code !== '23505') throw error;
        } else {
          const { error } = await sb.from('saved_posts').delete().eq('post_id', postId).eq('user_id', state.me.uid);
          if (error) throw error;
        }
        _saveServer.set(postId, target);
      } catch (err) {
        console.warn('[Feed] Saqlash bajarilmadi:', err?.message);
        const back = _saveServer.get(postId);
        _saveWant.set(postId, back);
        if (back) state.mySavedPosts.add(postId); else state.mySavedPosts.delete(postId);
        document.querySelectorAll('.save-btn[data-id="' + postId + '"]').forEach(b => paintSaveBtn(b, back));
        toast("Saqlab bo'lmadi", 'error');
        break;
      }
    }
  } finally {
    _saveBusy.delete(postId);
    _saveWant.delete(postId);
    _saveServer.delete(postId);
  }
}

/* ── Like ────────────────────────────────────────────────────────────── */
/* Barcha ko'rinishlarda (lenta, detal, rail) like holati va sonini bir zumda chizadi */
function paintLike(postId, on, n, btn, pop) {
  if (on) { state.myLikedPosts.add(postId); state._knownUnliked.delete(postId); }
  else    { state.myLikedPosts.delete(postId); state._knownUnliked.add(postId); }
  const post = state.allPosts.find(p => p.id === postId);
  if (post) post.likes = n;
  const btns = new Set(document.querySelectorAll(`.like-btn[data-id="${postId}"]`));
  if (btn) btns.add(btn);
  btns.forEach(b => {
    b.classList.toggle('liked', on);
    const svg = b.querySelector('svg');
    svg?.setAttribute('fill', on ? '#f91880' : 'none');
    svg?.setAttribute('stroke', on ? '#f91880' : 'currentColor');
    // Yurak endi <img> — manbani almashtiramiz (faqat heart ikonkasi bo'lsa)
    const im = b.querySelector('img.icon');
    const cs = im?.getAttribute('src') || '';
    if (im && cs.includes('/heart')) im.setAttribute('src', on ? './svg/social/heart-filled.svg' : './svg/social/heart.svg');
    // Tugmaning o'z hisoblagichi (feed: #lc-<id>, profil detali: .dm-act-count)
    const sp = b.querySelector('span');
    if (sp) sp.textContent = fmtCount(n);
    if (on && pop) { b.classList.add('like-pop'); setTimeout(() => b.classList.remove('like-pop'), 400); }
  });
  // Bir post bir nechta view'da bo'lishi mumkin (ID takrorlanadi) — hammasini yangilaymiz
  document.querySelectorAll(`[id="lc-${postId}"]`).forEach(el => { el.textContent = fmtCount(n); });
}

export function doLike(postId, btn) {
  if (!state.me) return;
  const wasLiked = state.myLikedPosts.has(postId);
  const post     = state.allPosts.find(p => p.id === postId);
  const lc       = document.getElementById(`lc-${postId}`);
  const ownN     = parseInt(btn?.querySelector('span')?.textContent, 10);
  // Saqlanganlar kabi allPosts'da yo'q postlar uchun — bosilgan tugmaning o'z hisoblagichidan (ID takrorlanishi mumkin)
  const cur      = post?.likes ?? (Number.isFinite(ownN) ? ownN : (parseInt(lc?.textContent, 10) || 0));
  const want     = !wasLiked;
  const n        = Math.max(0, cur + (want ? 1 : -1));

  // 1) UI — shu zahoti (0ms), tarmoq kutilmaydi; boshqalarga ham shu zahoti
  paintLike(postId, want, n, btn, true);
  busEmit('like', { postId, n, on: want });

  // 2) Orqa fonda saqlanadi (DB trigger post_likes → posts.likes_count ni yangilaydi); xato bo'lsa qaytariladi
  syncLike(postId, state.me.uid, wasLiked, want, (serverOn, meta) => {
    const cnt = Math.max(0, meta.baseCount + (serverOn ? 1 : 0) - (meta.baseLiked ? 1 : 0));
    paintLike(postId, serverOn, cnt, null, false);
    busEmit('like', { postId, n: cnt, on: serverOn });
    toast('Like saqlanmadi', 'error');
  }, { baseLiked: wasLiked, baseCount: cur });
}

/* ── Delete ──────────────────────────────────────────────────────────── */
/* ── Post ⋯ menyusi: hamma postda; o'zimniki/admin uchun "O'chirish" ──── */
let _postMenu = null;
function _postMenuOutside(e) {
  if (!_postMenu) return;
  if (_postMenu.contains(e.target) || _postMenu._for?.contains(e.target)) return; // trigger o'zi toggle qiladi
  closePostMenu();
}
function closePostMenu() {
  if (!_postMenu) return;
  _postMenu.remove(); _postMenu = null;
  document.removeEventListener('click', _postMenuOutside, true);
  document.removeEventListener('keydown', _postMenuKey, true);
  window.removeEventListener('scroll', closePostMenu, true);
  window.removeEventListener('resize', closePostMenu);
}
function _postMenuKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePostMenu(); } }

export async function copyText(text, okMsg = 'Nusxalandi') {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); }
    else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(okMsg, 'success');
  } catch (_) { toast('Nusxalab bo\'lmadi', 'error'); }
}

function openPostMenu(btn) {
  const id = btn.dataset.id, uid = btn.dataset.uid;
  const post = state.allPosts?.find(p => p.id === id);
  const items = [];
  if (uid && uid !== state.me?.uid) items.push({ label: 'Profilni ko\'rish', run: async () => {
    const { openUserProfileModal } = await import('../profile/profile.js'); openUserProfileModal(uid);
  }});
  if (post?.text) items.push({ label: 'Matnni nusxalash', run: () => copyText(post.text) });
  if (btn.dataset.canDel) items.push({ label: 'Postni o\'chirish', danger: true, run: () =>
    showConfirm('Bu post butunlay o\'chiriladi.', () => doDelete(id), 'Post o\'chirilsinmi?', 'O\'chirish')
  });
  showMenu(btn, items);
}

/** Umumiy ⋯ dropdown: items = [{ label, danger?, run }]. Post va izohlar ishlatadi. */
export function showMenu(btn, items) {
  const reopen = _postMenu && _postMenu._for === btn;
  closePostMenu();
  if (reopen || !items.length) return; // ikkinchi bosish — yopadi

  const m = document.createElement('div');
  m.className = 'post-menu'; m.setAttribute('role', 'menu'); m._for = btn;
  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.className = 'post-menu-item' + (it.danger ? ' danger' : '');
    b.textContent = it.label;
    b.onclick = (e) => { e.stopPropagation(); closePostMenu(); it.run(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);

  const r = btn.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.top = top + 'px';
  m.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
  _postMenu = m;
  setTimeout(() => {
    document.addEventListener('click', _postMenuOutside, true);
    document.addEventListener('keydown', _postMenuKey, true);
    window.addEventListener('scroll', closePostMenu, true);
    window.addEventListener('resize', closePostMenu);
  }, 0);
}

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
  if (post?.mediaPath) {
    sb.storage.from(MEDIA_BUCKET).remove([post.mediaPath]).then(() => {
      import('../admin/admin-storage.js').then(m => m.refreshStorageUsage?.()).catch(() => {});
    }).catch(() => {});
  }
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
  if ((snap.y || 0) <= 5) return; // eng tepada — yangi post tepada ko'rinsin, joyni siljitmaymiz
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

/* Post media → OPFS/IDB kesh (ikkinchi ko'rishda diskdan) */
export function hydratePostMediaCache(root) {
  if (!root || typeof IntersectionObserver === 'undefined') return;
  const imgs = root.querySelectorAll('.post-media[data-type="image"] img');
  imgs.forEach(img => {
    const url = img.currentSrc || img.src;
    if (!url || url.startsWith('blob:') || img.dataset.mcCached) return;
    img.dataset.mcCached = '1';
    resolvePublicMedia(url, { priority: 'low' }).then(blobUrl => {
      if (blobUrl && blobUrl !== url && img.isConnected) {
        // faqat bir xil kontent — src ni almashtirmaymiz (flash yo'q); keyingi ochilishda cachedMediaUrlSync
      }
    }).catch(() => {});
  });
}
