/**
 * Stories — Instagram uslubida 24 soatlik hikoyalar.
 * Feed yuqorisida horizontal strip (mobile + desktop).
 */
import { sb, state, mapProfile, mediaPublicUrl, MEDIA_BUCKET } from '../core/config.js';
import { $, esc, defAvi, lockScroll, unlockScroll, showConfirm } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { onEsc } from '../ui/esc-stack.js';
import { loadSnapshot, saveSnapshot, syncMedia, scheduleIdleSync, cacheItem, cachedUrl, cachedUrlSync, storyExpiresAt, isExpired } from './story-cache.js';
import { fixVideoDuration } from '../core/video-policy.js';

const STORY_MS = 5000; // har bir story ko'rsatish muddati

/** O'z ismim (story strip + viewer uchun) */
function myName(meP) {
  return (meP && (meP.fullName || meP.username)) || state.me?.displayName || state.me?.username || 'Men';
}

/** @type {{ uid: string, name: string, avatar: string, items: any[], hasUnseen: boolean }[]} */
let _groups = [];
let _viewerIdx = 0;   // guruh indeksi
let _itemIdx = 0;     // guruh ichidagi story
let _timer = null;
let _progressRaf = null;
let _startedAt = 0;
let _elapsed = 0;     // story'da o'tgan vaqt (ms) — tezlik/orqaga o'tkazish uchun
let _lastTs = 0;
let _rate = 1;        // 1 = oddiy, 2 = 2x oldinga, -2 = 2x orqaga
let _paused = false;
let _pausedAt = 0;
let _holdTimer = null;
let _isHolding = false;
let _startX = 0;
let _startY = 0;
let _bound = false;
let _showToken = 0;   // eski yuklanish callbacklarini bekor qilish uchun
let _reactionToken = 0;
let _selectedStoryReaction = new Map();
let _mediaTimeout = null;

function disposeStoryMedia() {
  const media = $('svMedia');
  if (!media) return;
  media.querySelectorAll('video').forEach(videoEl => {
    try {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
    } catch (_) {}
  });
  media.innerHTML = '';
}

function spawnFlyingEmoji(emoji) {
  const v = $('storyViewer'); if (!v) return;
  const el = document.createElement('div'); el.className = 'sv-flying-emoji';
  if (emoji && (emoji.includes('.png') || emoji.includes('/'))) {
    const src = emoji.startsWith('/') ? emoji : ('/' + emoji);
    el.innerHTML = `<img class="sv-reaction-emoji" src="${src}" style="width:48px;height:48px;" alt="">`;
  } else {
    el.textContent = emoji || '❤️';
  }
  v.appendChild(el); setTimeout(() => el.remove(), 850);
}

function ensureDom() {
  if ($('storiesBar')) return;
  const home = $('homeView');
  if (!home) return;

  const bar = document.createElement('div');
  bar.id = 'storiesBar';
  bar.className = 'stories-bar';
  bar.innerHTML = `<div class="stories-track" id="storiesTrack"></div>`;

  // Yuqorida doim ko'rinsin: composer/feed dan OLDIN
  const anchor = $('homeComposer') || $('feed');
  if (anchor) home.insertBefore(bar, anchor);
  else home.prepend(bar);

  // Viewer overlay (body ga)
  if (!$('storyViewer')) {
    const v = document.createElement('div');
    v.id = 'storyViewer';
    v.className = 'story-viewer';
    v.hidden = true;
    v.innerHTML = `
      <div class="sv-progress" id="svProgress"></div>
      <div class="sv-top">
        <div class="sv-user">
          <div class="sv-avi" id="svAvi"></div>
          <div class="sv-meta">
            <div class="sv-name" id="svName"></div>
            <div class="sv-time" id="svTime"></div>
          </div>
        </div>
        <div class="sv-top-actions" style="display:flex;align-items:center;gap:4px;pointer-events:auto">
          <button type="button" class="sv-close sv-delete" id="svDelete" hidden aria-label="O'chirish" title="Hikoyani o'chirish">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
          </button>
          <button type="button" class="sv-close" id="svClose" aria-label="Yopish">
            <img src="./svg/action/close.svg" alt="" class="icon" width="22" height="22">
          </button>
        </div>
      </div>
      <div class="sv-media" id="svMedia"></div>
      <div class="sv-rate" id="svRate" hidden style="position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 28px);transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font:600 14px/1 system-ui,sans-serif;pointer-events:none;z-index:5"></div>
      <div class="sv-bottom" id="svBottom">
        <div class="sv-reactions" id="svReactions">
          <button type="button" class="sv-react-chip" aria-pressed="false" data-emoji="emoji/2d/1f44d.png" aria-label="Like"><img class="sv-reaction-emoji" src="/emoji/2d/1f44d.png" alt=""></button>
          <button type="button" class="sv-react-chip" aria-pressed="false" data-emoji="emoji/2d/2764.png" aria-label="Sevgi"><img class="sv-reaction-emoji" src="/emoji/2d/2764.png" alt=""></button>
          <button type="button" class="sv-react-chip" aria-pressed="false" data-emoji="emoji/2d/1f525.png" aria-label="Olov"><img class="sv-reaction-emoji" src="/emoji/2d/1f525.png" alt=""></button>
          <button type="button" class="sv-react-chip" aria-pressed="false" data-emoji="emoji/2d/1f602.png" aria-label="Kulgu"><img class="sv-reaction-emoji" src="/emoji/2d/1f602.png" alt=""></button>
        </div>
        <div class="sv-own-bar" id="svOwnBar" hidden>
          <span class="sv-views-badge" id="svViewsBadge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><span class="sv-views-count">0</span><span>ta ko'rildi</span></span>
        </div>
      </div>
    `;
    document.body.appendChild(v);
  }

  if (!_bound) {
    _bound = true;
    const v = $('storyViewer');
    $('svClose')?.addEventListener('click', e => {
      e.stopPropagation();
      closeViewer();
    });

    $('svDelete')?.addEventListener('click', e => {
      e.stopPropagation();
      const group = _groups[_viewerIdx];
      const item = group?.items?.[_itemIdx];
      if (!group || !item || !group.isMe) return;
      freezeStory();
      showConfirm("Ushbu hikoyani o'chirmoqchimisiz?", async () => {
        try {
          const { error } = await sb.from('stories').delete().eq('id', item.id);
          if (error) throw error;
          if (item.mediaPath) {
            sb.storage.from(MEDIA_BUCKET).remove([item.mediaPath]).catch(() => {});
          }
          toast("Hikoya o'chirildi", "success");
          group.items.splice(_itemIdx, 1);
          if (!group.items.length) {
            _groups.splice(_viewerIdx, 1);
            closeViewer();
          } else {
            if (_itemIdx >= group.items.length) _itemIdx = group.items.length - 1;
            showCurrent();
          }
          loadStories();
        } catch (err) {
          toast("Hikoyani o'chirib bo'lmadi", "error");
          unfreezeStory();
        }
      }, "Hikoyani o'chirish", "O'chirish", () => {
        unfreezeStory();
      });
    });

    $('svViewsBadge')?.addEventListener('click', e => {
      e.stopPropagation();
      const currentItem = _groups[_viewerIdx]?.items?.[_itemIdx];
      if (!currentItem?.id) return;
      openStoryViewersModal(currentItem.id);
    });

    // Avatar / ism bosilsa — egasining profiliga o'tish (o'z storym bo'lsa — mening profilim)
    $('svAvi')?.parentElement?.addEventListener('click', async e => {
      e.stopPropagation();
      const g = _groups[_viewerIdx];
      if (!g?.uid) return;
      closeViewer();
      try {
        if (g.uid === state.me?.uid) {
          const { navigateTo } = await import('../router.js');
          navigateTo('profile');
        } else {
          const { openUserProfileModal } = await import('../profile/profile.js');
          openUserProfileModal(g.uid);
        }
      } catch (err) { console.warn('[stories] profilga o\'tish:', err?.message || err); }
    });

    // Kontekst menyu (Copy image, Copy link va h.k.) ni butunlay bloklash
    v?.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
    v?.addEventListener('dragstart', e => {
      e.preventDefault();
      return false;
    });

    // Touch va sichqoncha bilan boshqaruv:
    // Bosib turganda — story freeze (muzlatish)
    // Qo'yib yuborganda — unfreeze (davom etish)
    // Qisqa bosish (tap): o'ng taraf -> keyingi story, chap taraf -> oldingi story
    if (v) {
      v.addEventListener('pointerdown', e => {
        if (e.button && e.button !== 0) return;
        if (e.target.closest('#svClose') || e.target.closest('.sv-user') || e.target.closest('#svBottom')) return;
        _isHolding = false;
        _startX = e.clientX;
        _startY = e.clientY;
        clearTimeout(_holdTimer);
        // Bosilgan joy: chap 1/3 = 2x orqaga, o'ng 1/3 = 2x oldinga, o'rta = freeze
        const hr = ($('svMedia') || v).getBoundingClientRect();
        const hRatio = (e.clientX - hr.left) / (hr.width || 1);
        const zone = hRatio < 0.33 ? 'left' : (hRatio > 0.66 ? 'right' : 'center');
        _holdTimer = setTimeout(() => {
          _isHolding = true;
          _startHold(zone);
        }, 500);
      });

      v.addEventListener('pointermove', e => {
        if (!_isHolding && (Math.abs(e.clientX - _startX) > 14 || Math.abs(e.clientY - _startY) > 14)) {
          clearTimeout(_holdTimer);
        }
      });

      const handlePointerEnd = e => {
        clearTimeout(_holdTimer);
        if (_isHolding) {
          _isHolding = false;
          _endHold();
          return;
        }
        if (e.target.closest('#svClose') || e.target.closest('.sv-user') || e.target.closest('#svBottom')) return;

        const dx = e.clientX - _startX;
        const dy = e.clientY - _startY;

        // Swipe pastga: story'ni yopish (Instagram/Telegram standart imo-ishorasi)
        if (dy > 60 && Math.abs(dy) > Math.abs(dx)) {
          closeViewer();
          return;
        }
        // Swipe chapga/o'ngga: boshqa foydalanuvchining hikoyasiga o'tish
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) {
            // Chapga surish -> keyingi foydalanuvchi
            if (_viewerIdx < _groups.length - 1) {
              _viewerIdx++;
              _itemIdx = 0;
              showCurrent();
            } else {
              closeViewer();
            }
          } else {
            // O'ngga surish -> oldingi foydalanuvchi
            if (_viewerIdx > 0) {
              _viewerIdx--;
              _itemIdx = 0;
              showCurrent();
            }
          }
          return;
        }

        // Agar ozgina siljigan bo'lsa (drag), tasodifiy tap bo'lib ketmasin
        if (Math.abs(dx) > 15 || Math.abs(dy) > 15) return;

        // Bir marta qisqa bosish: chap/o'ng navigatsiya
        const mediaEl = $('svMedia') || v;
        const rect = mediaEl.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / (rect.width || 1);
        if (ratio < 0.40) {
          step(-1, true);
        } else {
          step(1, true);
        }
      };

      v.addEventListener('pointerup', handlePointerEnd);
      v.addEventListener('pointercancel', () => {
        clearTimeout(_holdTimer);
        if (_isHolding) {
          _isHolding = false;
          _endHold();
        }
      });
      v.addEventListener('pointerleave', () => {
        clearTimeout(_holdTimer);
        if (_isHolding) {
          _isHolding = false;
          _endHold();
        }
      });

      $('svReactions')?.addEventListener('click', async e => {
        const chip = e.target.closest('.sv-react-chip');
        if (!chip?.dataset.emoji) return;
        e.stopPropagation();
        const group = _groups[_viewerIdx];
        const story = group?.items?.[_itemIdx];
        if (!group || !story || group.isMe || !state.me?.uid) return;
        const storyId = story.id;
        const userId = state.me.uid;
        const previous = _selectedStoryReaction.get(storyId) || null;
        const next = previous === chip.dataset.emoji ? null : chip.dataset.emoji;
        const request = ++_reactionToken;
        const paint = value => {
          if (_groups[_viewerIdx]?.items?.[_itemIdx]?.id !== storyId) return;
          $('svReactions')?.querySelectorAll('.sv-react-chip').forEach(button => {
            const selected = button.dataset.emoji === value;
            button.classList.toggle('is-selected', selected);
            button.classList.remove('is-saving');
            button.disabled = false;
            button.setAttribute('aria-pressed', String(selected));
          });
        };
        if (next) _selectedStoryReaction.set(storyId, next);
        else _selectedStoryReaction.delete(storyId);
        paint(next);
        if (next) spawnFlyingEmoji(next);
        try { window.haptic?.success?.(); } catch (_) {}
        $('svReactions')?.querySelectorAll('.sv-react-chip').forEach(button => {
          button.disabled = true;
          if (button.dataset.emoji === next || button.dataset.emoji === previous) button.classList.add('is-saving');
        });
        try {
          const { error } = await sb.from('story_views').upsert({
            story_id: storyId,
            user_id: userId,
            reaction: next,
            viewed_at: new Date().toISOString()
          }, { onConflict: 'story_id,user_id' });
          if (error) throw error;
          if (request === _reactionToken) paint(next);
          if (next) {
            toast('Reaksiya saqlandi', 'success');
          } else {
            toast('Reaksiya bekor qilindi', 'info');
          }
        } catch (error) {
          if (_selectedStoryReaction.get(storyId) === next || (!_selectedStoryReaction.has(storyId) && next === null)) {
            if (previous) _selectedStoryReaction.set(storyId, previous);
            else _selectedStoryReaction.delete(storyId);
          }
          if (request === _reactionToken) paint(previous);
          console.warn('[stories] reaction save:', error?.message || error);
          toast('Reaksiyani saqlab bo‘lmadi', 'error');
        }
      });




    }

    onEsc(910, () => { const m = $('svViewersModal'); if (!m || m.hidden) return false; closeStoryViewersModal(); return true; });
    // Esc: hikoya ko'rgich eng ustki qatlam (shortcuts.js bilan umumiy navbat)
    onEsc(900, () => { const v = $('storyViewer'); if (!v || v.hidden) return false; closeViewer(); return true; });
    document.addEventListener('keydown', e => {
      if ($('storyViewer')?.hidden) return;
      if (e.key === 'ArrowRight') step(1, true);
      if (e.key === 'ArrowLeft') step(-1, true);
    });
  }
}

const _MON = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
/** Story kelgan aniq vaqt (brauzer vaqt mintaqasida): "14:40" yoki boshqa kun bo'lsa "14:40, 12 avg" */
function fmtClock(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return d.toDateString() === new Date().toDateString() ? hm : `${hm}, ${d.getDate()} ${_MON[d.getMonth()]}`;
}

function fmtAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'hozir';
  if (sec < 3600) return Math.floor(sec / 60) + ' daqiqa';
  if (sec < 86400) return Math.floor(sec / 3600) + ' soat';
  return Math.floor(sec / 86400) + ' kun';
}

/** Optimistic: o'z storyni darhol stripga qo'shish (server hali yuklamayotgan) */
export function injectLocalStory(item) {
  if (!state.me?.uid || !item) return;
  ensureDom();
  const me = state.me.uid;
  let g = _groups.find(x => x.uid === me);
  if (!g) {
    const meP = state._userCache?.[me] || {};
    g = {
      uid: me,
      name: myName(meP),
      avatar: meP.avatar || defAvi(meP.fullName || 'U'),
      items: [],
      hasUnseen: true,
      isMe: true,
    };
    _groups = [g, ..._groups.filter(x => x.uid !== me)];
  }
  // temp id bilan dublikat bo'lmasin
  g.items = g.items.filter(i => i.id !== item.id);
  g.items.push({
    id: item.id,
    mediaPath: item.mediaPath || null,
    mediaType: item.mediaType || 'image',
    mediaUrl: item.mediaUrl,
    caption: item.caption || '',
    createdAt: item.createdAt || new Date().toISOString(),
    seen: true,
    _optimistic: true,
  });
  g.hasUnseen = true;
  // Meni birinchi qatorga
  _groups = [g, ..._groups.filter(x => x.uid !== me)];
  renderBar();
}

/** Serverdan story guruhlarini oladi (DOM'siz) — loadStories() ham, sayt ochilishidagi erta yuklash ham shuni ishlatadi */
async function fetchGroups(me) {
  const nowIso = new Date().toISOString();
  const selStories = cols => sb.from('stories').select(cols)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: true });
  let { data: rows, error } = await selStories('id, user_id, media_path, media_type, caption, created_at, expires_at');
  // caption ustuni hali yo'q bo'lsa (patch qo'llanmagan) — izohsiz yuklaymiz
  if (error && /caption/i.test(error.message || '')) {
    ({ data: rows, error } = await selStories('id, user_id, media_path, media_type, created_at, expires_at'));
  }
  if (error) throw error;

  const stories = rows || [];
  const uids = [...new Set(stories.map(s => s.user_id))];
  if (me && !uids.includes(me)) uids.push(me);

  // Profillar va ko'rilganlar — parallel
  const profP = uids.length
    ? sb.from('profiles').select('id, full_name, username, avatar').in('id', uids)
    : Promise.resolve({ data: [] });
  const viewP = (stories.length && me)
    ? sb.from('story_views').select('story_id').eq('user_id', me).in('story_id', stories.map(s => s.id))
    : Promise.resolve({ data: [] });
  const [{ data: pr }, { data: vv }] = await Promise.all([profP, viewP]);
  const pMap = Object.fromEntries((pr || []).map(mapProfile).map(p => [p.uid, p]));
  const viewed = new Set((vv || []).map(v => v.story_id));

  // Group by user
  const byUser = new Map();
  for (const s of stories) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id).push({
      id: s.id,
      mediaPath: s.media_path,
      mediaType: s.media_type || 'image',
      mediaUrl: mediaPublicUrl(s.media_path),
      caption: s.caption || '',
      createdAt: s.created_at,                                   // story bazaga tushgan vaqt (server)
      expiresAt: storyExpiresAt(s.created_at, s.expires_at),     // created_at + 24 soat
      seen: viewed.has(s.id),
    });
  }

  const groups = [];
  const myItems = byUser.get(me) || [];
  const meP = pMap[me] || state._userCache?.[me] || {};
  groups.push({
    uid: me,
    name: myName(meP),
    avatar: meP.avatar || defAvi(meP.fullName || 'U'),
    items: myItems,
    hasUnseen: myItems.some(i => !i.seen),
    isMe: true,
  });

  // Others: unseen first, then seen
  const others = [...byUser.keys()].filter(u => u !== me).map(uid => {
    const items = byUser.get(uid) || [];
    const p = pMap[uid] || {};
    return {
      uid,
      name: p.fullName || p.username || 'Foydalanuvchi',
      avatar: p.avatar || defAvi(p.fullName || '?'),
      items,
      hasUnseen: items.some(i => !i.seen),
      isMe: false,
    };
  });
  others.sort((a, b) => (b.hasUnseen ? 1 : 0) - (a.hasUnseen ? 1 : 0));
  groups.push(...others.filter(g => g.items.length > 0));
  return groups;
}

/* ── Erta yuklash: sayt ochilishi bilan (splash boshlanishidan oldin, auth/DOM kutmasdan) ──
   1) IndexedDB'dagi oxirgi story ro'yxati + birinchi fayllar blob URL'ga tayyorlanadi;
   2) serverdan yangi ro'yxat fonda so'raladi. loadStories() keyin tayyor natijani oladi. */
let _boot = null;   // { uid, t, snap: Promise, net: Promise<groups|null> }
function _authUid() {
  try { return JSON.parse(localStorage.getItem('spacemr-auth') || 'null')?.user?.id || null; } catch (_) { return null; }
}
export function bootStories() {
  if (_boot) return;
  const uid = _authUid();
  if (!uid) return;
  const net = fetchGroups(uid).then(g => { saveSnapshot(uid, g); syncMedia(g); return g; }).catch(() => null);
  const snap = loadSnapshot(uid).then(async r => {
    // Birinchi (ko'rilmagan oldin) fayllarni blob URL'ga tayyorlab qo'yamiz — viewer ochilganda darhol chiqadi
    const items = (r?.groups || []).flatMap(g => g.items || []);
    const first = [...items.filter(i => !i.seen), ...items.filter(i => i.seen)].slice(0, 10);
    await Promise.all(first.map(i => cachedUrl(i.id)));
    return r;
  }).catch(() => null);
  _boot = { uid, t: Date.now(), snap, net };
}

export async function loadStories() {
  ensureDom();
  const track = $('storiesTrack');
  if (!track || !state.me?.uid) return;
  const me = state.me.uid;

  const _hasReal = () => !!track.querySelector('.story-item:not(.story-item--skel)');

  // Erta yuklash tayyor bo'lsa — o'shani olamiz (bir marta); bo'lmasa — yangi so'rov
  let boot = _boot && _boot.uid === me && (Date.now() - _boot.t) < 60000 ? _boot : null;
  _boot = null;
  const net = boot ? boot.net.then(g => g || fetchGroups(me)) : fetchGroups(me);

  /* Birinchi yuklashda: keshdagi ro'yxat DARHOL chiqadi (IndexedDB), keyin serverdan yangilanadi.
     Kesh ham yo'q bo'lsa — skeleton (haqiqiy story-item bilan bir xil layout). */
  if (!_hasReal()) {
    const snap = await (boot?.snap || loadSnapshot(me));
    if (!_hasReal()) {
      if (snap?.groups?.length) { _groups = snap.groups; renderBar(); }
      else renderSkeleton(_cachedStoryCount());
    }
  }

  try {
    const groups = await net;
    _groups = groups;
    renderBar();
    // Keshni serverdagi ro'yxat bilan solishtirish: yangilari keshlanadi, eskilari/o'chirilganlari o'chadi
    saveSnapshot(me, groups); syncMedia(groups); scheduleIdleSync(groups);
  } catch (e) {
    console.warn('[stories]', e?.message || e);
    if (_groups.length) { renderBar(); return; }   // internet yo'q — keshdagi ro'yxat turaveradi
    // Jadval yo'q bo'lsa ham "Sizning story" ko'rsatamiz
    const meP = state._userCache?.[me] || {};
    _groups = [{
      uid: me,
      name: myName(meP),
      avatar: meP.avatar || defAvi(meP.fullName || 'U'),
      items: [],
      hasUnseen: false,
      isMe: true,
    }];
    renderBar();
  }
}

const _storyCntKey = () => 'spacemr_story_cnt:' + (state.me?.uid || '');
function _cachedStoryCount() {
  try {
    const n = parseInt(localStorage.getItem(_storyCntKey()) || '1', 10);
    return Math.min(Math.max(n || 1, 1), 30);
  } catch (_) { return 1; }
}
function _saveStoryCount(n) {
  try { localStorage.setItem(_storyCntKey(), String(n)); } catch (_) {}
}

/** n ta skeleton: .story-item / .story-ring / .story-label bilan aynan bir xil o'lcham */
function renderSkeleton(n) {
  const track = $('storiesTrack');
  if (!track) return;
  const count = Math.min(Math.max(n || 1, 1), 30);
  const cur = track.querySelectorAll('.story-item--skel').length;
  if (cur === count && cur === track.children.length) return; // o'zgarmagan — animatsiya uzilmasin
  track.setAttribute('aria-busy', 'true');
  track.innerHTML = Array.from({ length: count }, () =>
    `<div class="story-item story-item--skel" aria-hidden="true">
      <div class="story-ring story-ring--skel"></div>
      <span class="story-label"><i class="story-skel-bar">&nbsp;</i></span>
    </div>`).join('');
}

function renderBar() {
  const track = $('storiesTrack');
  if (!track) return;
  track.style.minHeight = '';
  track.removeAttribute('aria-busy');
  _saveStoryCount(_groups.length);

  track.innerHTML = _groups.map((g, i) => {
    const ring = g.isMe && !g.items.length
      ? 'story-ring story-ring--add'
      : (g.hasUnseen ? 'story-ring story-ring--new' : 'story-ring story-ring--seen');
    const plus = g.isMe
      ? `<span class="story-plus" aria-hidden="true">+</span>`
      : '';
    return `<button type="button" class="story-item" data-idx="${i}" title="${esc(g.name)}">
      <div class="${ring}">
        <img src="${esc(g.avatar)}" alt="" onerror="this.style.display='none'">
        ${plus}
      </div>
      <span class="story-label">${esc(g.isMe && !g.items.length ? 'Story qo\'shish' : (g.name || '').split(' ')[0])}</span>
    </button>`;
  }).join('');

  track.querySelectorAll('.story-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const g = _groups[idx];
      if (!g) return;
      if (g.isMe && !g.items.length) {
        openStoryAdd();
        return;
      }
      if (g.isMe && g.items.length) {
        // long-press style: if click plus area — add; else view
        // Simple: click opens viewer; to add, use the empty state or double-tap plus
        openViewer(idx, 0);
        return;
      }
      openViewer(idx, g.items.findIndex(it => !it.seen));
    });
  });

  // Me with items: also allow add via long-press on plus — add small add chip
  const meBtn = track.querySelector('.story-item[data-idx="0"]');
  if (meBtn && _groups[0]?.items?.length) {
    meBtn.querySelector('.story-plus')?.addEventListener('click', e => {
      e.stopPropagation();
      openStoryAdd();
    });
  }
}

/* Story qo'shish: fayl menejeri emas, post kabi composer kartasi ochiladi (modules/upload.js) */
function openStoryAdd() {
  import('./upload.js').then(m => m.openStoryComposer()).catch(e => console.error(e));
}

/** Foydalanuvchining hikoyalarini ochadi (URL: /s/<username>). Hikoya bo'lmasa false. */
export async function openStoriesOf(uid) {
  if (!_groups.some(g => g.uid === uid)) { try { await loadStories(); } catch (_) {} }
  const idx = _groups.findIndex(g => g.uid === uid);
  if (idx < 0 || !_groups[idx].items.length) return false;
  const first = _groups[idx].items.findIndex(it => !it.seen);
  openViewer(idx, first < 0 ? 0 : first);
  return true;
}
export function closeStoryViewer() { closeViewer(); }

function openViewer(groupIdx, itemIdx) {
  if (!_groups[groupIdx]?.items?.length) return;
  _viewerIdx = groupIdx;
  _itemIdx = Math.max(0, itemIdx < 0 ? 0 : itemIdx);
  const v = $('storyViewer');
  if (!v) return;
  v.hidden = false;
  lockScroll('storyViewer');
  state.storyUid = _groups[groupIdx]?.uid || null;   // URL: /s/<username>
  window.dispatchEvent(new Event('spacemr:route'));
  showCurrent();
}

function _storyVideo() { return $('svMedia')?.querySelector('video') || null; }

function _showRate(txt) {
  const b = $('svRate');
  if (!b) return;
  if (txt) { b.textContent = txt; b.hidden = false; } else { b.hidden = true; }
}

/** 1 = oddiy, 2 = 2x oldinga, -2 = 2x orqaga (video orqaga o'ynamaydi — currentTime tick'da suriladi) */
function setStoryRate(r) {
  _rate = r;
  const v = _storyVideo();
  if (!v) return;
  try {
    if (r < 0) v.pause();
    else { v.playbackRate = r; if (!_paused) v.play().catch(() => {}); }
  } catch (_) {}
}

function _startHold(zone) {
  if (zone === 'left')       { setStoryRate(-2); _showRate('◀◀ 2x'); }
  else if (zone === 'right') { setStoryRate(2);  _showRate('2x ▶▶'); }
  else                       { freezeStory(); }
}

function _endHold() {
  setStoryRate(1);
  _showRate('');
  unfreezeStory();
}

function freezeStory() {
  if (_paused) return;
  _paused = true;
  _pausedAt = performance.now();
  try { _storyVideo()?.pause(); } catch (_) {}
}

function unfreezeStory() {
  if (!_paused) return;
  _paused = false;
  if (_pausedAt) {
    _startedAt += (performance.now() - _pausedAt);
    _pausedAt = 0;
  }
  try { const v = _storyVideo(); if (v) v.play().catch(() => {}); } catch (_) {}
}

function closeStoryViewersModal() {
  const m = $('svViewersModal');
  if (m && !m.hidden) {
    m.hidden = true;
    const v = $('storyViewer');
    if (v && !v.hidden) unfreezeStory();
  }
}

async function openStoryViewersModal(storyId) {
  freezeStory();
  let modal = $('svViewersModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'svViewersModal';
    modal.className = 'sv-viewers-modal';
    modal.innerHTML = `
      <div class="sv-viewers-backdrop" id="svViewersBackdrop"></div>
      <div class="sv-viewers-sheet">
        <div class="sv-viewers-header">
          <div class="sv-viewers-title-wrap">
            <h3 class="sv-viewers-title">Hikoyani ko'rganlar</h3>
            <span class="sv-viewers-badge-pill" id="svViewersBadgePill">0</span>
          </div>
          <button type="button" class="sv-viewers-close" id="svViewersClose" aria-label="Yopish">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="sv-viewers-list" id="svViewersList">
          <div class="sv-viewers-loading"><span class="sv-loading-spinner" aria-hidden="true"></span><span>Yuklanmoqda…</span></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#svViewersBackdrop')?.addEventListener('click', closeStoryViewersModal);
    modal.querySelector('#svViewersClose')?.addEventListener('click', closeStoryViewersModal);
  }

  modal.hidden = false;
  const listEl = modal.querySelector('#svViewersList');
  const pillEl = modal.querySelector('#svViewersBadgePill');
  if (listEl) {
    listEl.innerHTML = '<div class="sv-viewers-loading"><span class="sv-loading-spinner" aria-hidden="true"></span><span>Yuklanmoqda…</span></div>';
  }

  try {
    const { data, count, error } = await sb.from('story_views')
      .select('story_id, user_id, viewed_at', { count: 'exact' })
      .eq('story_id', storyId)
      .order('viewed_at', { ascending: false });

    if (error) throw error;
    const views = data || [];
    const totalCount = (typeof count === 'number' && !isNaN(count)) ? count : views.length;
    if (pillEl) pillEl.textContent = String(totalCount);

    const cur = _groups[_viewerIdx]?.items?.[_itemIdx];
    if (cur && cur.id === storyId) {
      cur.viewsCount = totalCount;
      const countEl = $('svViewsBadge')?.querySelector('.sv-views-count');
      if (countEl) countEl.textContent = String(totalCount);
    }

    if (!views.length) {
      if (listEl) {
        listEl.innerHTML = `
          <div class="sv-viewers-empty">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8" class="sv-viewers-empty-icon"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
            <p>Hozircha hech kim ko'rmagan</p>
          </div>
        `;
      }
      return;
    }

    const uids = [...new Set(views.map(v => v.user_id).filter(Boolean))];
    const { data: profs } = uids.length
      ? await sb.from('profiles').select('id, full_name, username, avatar').in('id', uids)
      : { data: [] };

    const pMap = new Map((profs || []).map(p => [p.id, p]));

    if (listEl) {
      listEl.innerHTML = views.map(v => {
        const p = pMap.get(v.user_id) || {};
        const name = p.full_name || p.username || 'Foydalanuvchi';
        const uname = p.username ? `@${p.username}` : '';
        const timeAgo = v.viewed_at ? fmtAgo(v.viewed_at) : '';
        const avi = p.avatar || defAvi(name);
        return `
          <div class="sv-viewer-row" data-uid="${esc(v.user_id)}">
            <div class="sv-viewer-avi">
              <img src="${esc(avi)}" alt="" onerror="this.src='${esc(defAvi(name))}'">
            </div>
            <div class="sv-viewer-info">
              <div class="sv-viewer-name">${esc(name)}</div>
              <div class="sv-viewer-meta">${esc(uname)}${uname && timeAgo ? ' · ' : ''}${esc(timeAgo)}</div>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.sv-viewer-row').forEach(row => {
        row.addEventListener('click', async () => {
          const uid = row.getAttribute('data-uid');
          if (!uid) return;
          closeStoryViewersModal();
          closeViewer();
          try {
            if (uid === state.me?.uid) {
              const { navigateTo } = await import('../router.js');
              navigateTo('profile');
            } else {
              const { openUserProfileModal } = await import('../profile/profile.js');
              openUserProfileModal(uid);
            }
          } catch (err) {
            console.warn('[stories] viewer profiliga o\'tish:', err?.message || err);
          }
        });
      });
    }
  } catch (err) {
    console.warn('[stories] viewers fetch failed:', err?.message || err);
    if (listEl) {
      listEl.innerHTML = `
        <div class="sv-viewers-empty">
          <p>Ro'yxatni yuklab bo'lmadi</p>
        </div>
      `;
    }
  }
}

function closeViewer() {
  closeStoryViewersModal();
  clearTimeout(_mediaTimeout);
  ++_showToken;
  clearTimeout(_holdTimer);
  _isHolding = false;
  _paused = false;
  _rate = 1;
  _showRate('');
  _pausedAt = 0;
  clearTimeout(_timer);
  cancelAnimationFrame(_progressRaf);
  const v = $('storyViewer');
  if (v) v.hidden = true;
  state.storyUid = null;
  unlockScroll('storyViewer');
  disposeStoryMedia();
  loadStories(); // ringlarni yangilash
}

function buildProgress(n, active, ratio) {
  const el = $('svProgress');
  if (!el) return;
  if (el.children.length !== n) {
    el.innerHTML = Array.from({ length: n }, () =>
      `<div class="sv-seg"><div class="sv-seg-fill"></div></div>`
    ).join('');
  }
  const fills = el.querySelectorAll('.sv-seg-fill');
  fills.forEach((fill, i) => {
    let w = '0%';
    if (i < active) w = '100%';
    else if (i === active) w = Math.min(100, Math.max(0, ratio * 100)) + '%';
    fill.style.width = w;
  });
}

async function showCurrent() {
  clearTimeout(_timer);
  cancelAnimationFrame(_progressRaf);
  _paused = false;
  _rate = 1;
  _elapsed = 0;
  _showRate('');

  const g = _groups[_viewerIdx];
  if (!g || !g.items.length) { closeViewer(); return; }
  if (_itemIdx >= g.items.length) {
    // next group
    if (_viewerIdx + 1 < _groups.length && _groups[_viewerIdx + 1].items.length) {
      _viewerIdx++;
      _itemIdx = 0;
      return showCurrent();
    }
    closeViewer();
    return;
  }
  if (_itemIdx < 0) {
    if (_viewerIdx > 0) {
      _viewerIdx--;
      _itemIdx = _groups[_viewerIdx].items.length - 1;
      return showCurrent();
    }
    _itemIdx = 0;
  }

  const item = g.items[_itemIdx];
  if (isExpired(item)) { _itemIdx++; return showCurrent(); }   // 24 soat o'tgan — ko'rsatilmaydi
  $('svName').textContent = g.name;
  $('svTime').textContent = fmtAgo(item.createdAt) + ' · ' + fmtClock(item.createdAt);
  $('svAvi').innerHTML = `<img src="${esc(g.avatar)}" alt="" onerror="this.style.display='none'">`;

  const isMine = !!g.isMe || (!!state.me?.uid && g.uid === state.me.uid);
  const ownBar = $('svOwnBar');
  const delBtn = $('svDelete');
  if (delBtn) delBtn.hidden = !isMine;


  if (isMine) {
    if (ownBar) {
      ownBar.hidden = false;
      const viewsBadge = $('svViewsBadge');
      const countEl = viewsBadge?.querySelector('.sv-views-count');
      const countStoryId = item.id;
      if (countEl) countEl.textContent = (item.viewsCount != null) ? String(item.viewsCount) : '0';
      sb.from('story_views').select('story_id', { count: 'exact' }).eq('story_id', countStoryId)
        .then(({ data, count, error }) => {
          if (_groups[_viewerIdx]?.items?.[_itemIdx]?.id !== countStoryId) return;
          if (error) {
            console.warn('[stories] views count:', error.message || error);
            if (countEl && item.viewsCount == null) countEl.textContent = '0';
            return;
          }
          const realCount = (typeof count === 'number' && !isNaN(count))
            ? count
            : (Array.isArray(data) ? data.length : 0);
          item.viewsCount = realCount;
          if (countEl) countEl.textContent = String(realCount);
        }).catch(err => {
          if (_groups[_viewerIdx]?.items?.[_itemIdx]?.id !== countStoryId) return;
          console.warn('[stories] views count:', err?.message || err);
          if (countEl && item.viewsCount == null) countEl.textContent = '0';
        });
    }
  } else {
    if (ownBar) ownBar.hidden = true;
  }

  const reactionStoryId = item.id;
  const reactionUserId = state.me?.uid;
  const reactionToken = ++_reactionToken;
  const reactions = $('svReactions');
  if (reactions) {
    reactions.hidden = isMine;
    if (!isMine) {
      reactions.querySelectorAll('.sv-react-chip').forEach(button => {
        button.classList.remove('is-selected', 'is-saving');
        button.disabled = false;
        button.setAttribute('aria-disabled', 'false');
        button.setAttribute('aria-pressed', 'false');
      });
      const cachedReaction = _selectedStoryReaction.get(reactionStoryId) || null;
      if (cachedReaction) {
        reactions.querySelectorAll('.sv-react-chip').forEach(button => {
          const selected = button.dataset.emoji === cachedReaction;
          button.classList.toggle('is-selected', selected);
          button.setAttribute('aria-pressed', String(selected));
        });
      }
      if (reactionUserId) {
        sb.from('story_views').select('reaction').eq('story_id', reactionStoryId).eq('user_id', reactionUserId).maybeSingle()
          .then(({ data, error }) => {
            if (reactionToken !== _reactionToken || _groups[_viewerIdx]?.items?.[_itemIdx]?.id !== reactionStoryId) return;
            if (error) { console.warn('[stories] reaction load:', error.message); return; }
            const saved = data?.reaction || null;
            if (saved) _selectedStoryReaction.set(reactionStoryId, saved);
            else _selectedStoryReaction.delete(reactionStoryId);
            reactions.querySelectorAll('.sv-react-chip').forEach(button => {
              const selected = button.dataset.emoji === saved;
              button.classList.toggle('is-selected', selected);
              button.setAttribute('aria-pressed', String(selected));
            });
          }).catch(error => console.warn('[stories] reaction load:', error?.message || error));
      }
    }
  }

  disposeStoryMedia();
  const media = $('svMedia');
  clearTimeout(_mediaTimeout);
  const loading = document.createElement('div');
  loading.className = 'sv-media-loading';
  loading.innerHTML = '<span class="sv-loading-spinner" aria-hidden="true"></span><span>Hikoya yuklanmoqda…</span>';
  media.appendChild(loading);
  let duration = STORY_MS;
  const isVideo = String(item.mediaType || '').startsWith('video');

  const token = ++_showToken;
  const el = document.createElement(isVideo ? 'video' : 'img');
  el.alt = '';
  el.style.opacity = '0';
  if (isVideo) {
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.preload = 'auto';
    duration = 15000;
  }
  media.appendChild(el);

  if (item.caption) {
    const cap = document.createElement('div');
    cap.className = 'sv-caption';
    cap.textContent = item.caption;
    media.appendChild(cap);
  }

  // Mark viewed
  markViewed(item);

  // Media manbasi: avval IndexedDB keshi (tarmoqsiz, tez); yo'q bo'lsa — URL, rasm bo'lsa fonda keshlanadi
  let src = cachedUrlSync(item.id);
  if (!src) { src = await cachedUrl(item.id); if (token !== _showToken) return; }
  if (!src) { src = item.mediaUrl; if (!isVideo) cacheItem(item); }

  // Progress faqat media tayyor bo'lgandan KEYIN boshlanadi
  const n = g.items.length;
  buildProgress(n, _itemIdx, 0);
  const showMediaFailure = () => {
    if (token !== _showToken) return;
    clearTimeout(_mediaTimeout); loading.remove(); el.style.display = 'none';
    if (media.querySelector('.sv-media-error')) return;
    const box = document.createElement('div'); box.className = 'sv-media-error';
    box.addEventListener('pointerdown', e => e.stopPropagation());
    box.addEventListener('pointerup', e => e.stopPropagation());
    box.innerHTML = '<svg viewBox="0 0 48 48" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="7" width="38" height="34" rx="5"/><circle cx="17" cy="19" r="3"/><path d="m7 35 11-10 7 6 5-5 11 10M24 14v9m0 5v.5"/></svg><span>Hikoyani yuklab bo‘lmadi</span>';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Qayta urinish';
    retry.addEventListener('pointerdown', e => e.stopPropagation());
    retry.addEventListener('pointerup', e => e.stopPropagation());
    retry.addEventListener('click', e => { e.stopPropagation(); showCurrent(); });
    box.appendChild(retry); media.appendChild(box);
  };
  const startProgress = () => {
    if (token !== _showToken) return;
    clearTimeout(_mediaTimeout); loading.remove();
    el.style.opacity = '1';
    _startedAt = performance.now();
    _elapsed = 0; _rate = 1; _lastTs = performance.now();
    const tick = (now) => {
      const dt = Math.max(0, Math.min(100, now - _lastTs)); // fon tab'dan qaytganda sakramasin
      _lastTs = now;
      if (_paused) {
        _progressRaf = requestAnimationFrame(tick);
        return;
      }
      _elapsed = Math.max(0, _elapsed + dt * _rate);   // _rate < 0 — orqaga (0 dan pastga tushmaydi)
      if (isVideo && _rate < 0) { try { el.currentTime = Math.min(_elapsed, duration) / 1000; } catch (_) {} }
      const ratio = Math.min(1, _elapsed / duration);
      buildProgress(n, _itemIdx, ratio);
      if (ratio >= 1) {
        try { el.pause && el.pause(); } catch (_) {}
        step(1);
        return;
      }
      _progressRaf = requestAnimationFrame(tick);
    };
    _progressRaf = requestAnimationFrame(tick);
  };
  if (isVideo) {
    el.addEventListener('loadedmetadata', () => {
      if (token !== _showToken) return;
      const applyDur = (d) => {
        if (isFinite(d) && d > 0) duration = Math.min(d, 60) * 1000;
      };
      applyDur(el.duration);
      if (!isFinite(el.duration) || el.duration <= 0) {
        fixVideoDuration(el).then(sec => { if (token === _showToken) applyDur(sec); });
      }
    });
    el.addEventListener('ended', () => { if (token === _showToken) step(1); });
    const begin = () => {
      el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
      startProgress();
    };
    el.onerror = showMediaFailure;
    el.src = src;
    if (el.readyState >= 2) begin();
    else el.addEventListener('loadeddata', begin, { once: true });
  } else {
    el.onload = startProgress;
    el.onerror = showMediaFailure;
    el.src = src;
    if (el.complete && el.naturalWidth > 0) startProgress();
  }
  _mediaTimeout = setTimeout(showMediaFailure, 15000);

  // Keyingi story mediasini oldindan yuklab qo'yish
  const nextItem = g.items[_itemIdx + 1] || _groups[_viewerIdx + 1]?.items?.[0];
  if (nextItem?.mediaUrl && !String(nextItem.mediaType || '').startsWith('video')) {
    const pre = new Image(); pre.src = cachedUrlSync(nextItem.id) || nextItem.mediaUrl;
    cacheItem(nextItem);
  }
}

async function markViewed(item) {
  const g = _groups[_viewerIdx];
  if (!state.me?.uid || item.seen || g?.isMe || (g?.uid && g.uid === state.me.uid)) return;
  item.seen = true;
  try {
    const { error } = await sb.from('story_views').upsert(
      { story_id: item.id, user_id: state.me.uid, viewed_at: new Date().toISOString() },
      { onConflict: 'story_id,user_id', ignoreDuplicates: true }
    );
  } catch (err) { item.seen = false; console.warn('[stories] mark viewed:', err?.message || err); return; }
  if (g) g.hasUnseen = g.items.some(i => !i.seen);
  saveSnapshot(state.me.uid, _groups);
}

function step(dir, manual = false) {
  if (dir < 0) {
    // Chap tomonga bosilganda: agar oldingi story bo'lsa o'tadi
    if (_itemIdx > 0) {
      _itemIdx--;
      showCurrent();
    } else if (_viewerIdx > 0) {
      _viewerIdx--;
      _itemIdx = Math.max(0, _groups[_viewerIdx].items.length - 1);
      showCurrent();
    }
  } else {
    // O'ng tomonga bosilganda: agar o'ng tomonda story bo'lsa o'tadi
    const g = _groups[_viewerIdx];
    if (g && _itemIdx + 1 < g.items.length) {
      _itemIdx++;
      showCurrent();
    } else if (_viewerIdx + 1 < _groups.length && _groups[_viewerIdx + 1].items.length) {
      _viewerIdx++;
      _itemIdx = 0;
      showCurrent();
    } else if (!manual) {
      closeViewer();   // vaqt tugab oxirgi story'dan keyin — yopiladi; qo'lda bosilganda — joyida qoladi
    }
  }
}

export function initStories() {
  ensureDom();
  loadStories();
}
