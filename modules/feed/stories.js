/**
 * Stories — Instagram uslubida 24 soatlik hikoyalar.
 * Feed yuqorisida horizontal strip (mobile + desktop).
 */
import { sb, state, mapProfile, mediaPublicUrl } from '../core/config.js';
import { $, esc, defAvi } from '../core/utils.js';
import { onEsc } from '../ui/esc-stack.js';

const STORY_MS = 5000; // har bir story ko'rsatish muddati

/** @type {{ uid: string, name: string, avatar: string, items: any[], hasUnseen: boolean }[]} */
let _groups = [];
let _viewerIdx = 0;   // guruh indeksi
let _itemIdx = 0;     // guruh ichidagi story
let _timer = null;
let _progressRaf = null;
let _startedAt = 0;
let _paused = false;
let _pausedAt = 0;
let _holdTimer = null;
let _isHolding = false;
let _startX = 0;
let _startY = 0;
let _bound = false;


function ensureStoriesCss() {
  const _old = document.getElementById('stories-bar-css'); if (_old) _old.remove();
  const s = document.createElement('style');
  s.id = 'stories-bar-css'; // v2 full viewer
  s.textContent = `
.stories-bar {
  display: block;
  width: 100%;
  padding: 10px 0 6px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  position: relative;
  z-index: 2;
}
.stories-track {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 4px 12px 8px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.stories-track::-webkit-scrollbar { display: none; }
.story-item {
  flex: 0 0 auto;
  width: 72px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--text);
  font-family: var(--font);
  position: relative;
}
.story-loading { display: flex; align-items: center; padding: 18px 16px; }
.story-loading .spinner { width: 24px; height: 24px; margin: 0; }
.story-ring {
  width: 64px; height: 64px; border-radius: 50%;
  padding: 2px;
  display: grid; place-items: center;
  position: relative;
  background: var(--bg3);
}
.story-ring--new {
  background: linear-gradient(135deg, #f59e0b, #ec4899 55%, #8b5cf6);
}
.story-ring--seen { background: var(--line2, #333); }
.story-ring--add { background: var(--bg3); border: 1px dashed var(--line2); }
.story-ring img, .story-ring > img {
  width: 56px; height: 56px; border-radius: 50%; object-fit: cover;
  background: var(--bg2);
}
.story-plus {
  position: absolute; right: -2px; bottom: -2px;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--blue, #1d9bf0); color: #fff;
  font-size: 16px; line-height: 18px; text-align: center;
  border: 2px solid var(--bg);
  z-index: 2;
  pointer-events: auto;
  box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  font-weight: 600;
}
.story-label {
  font-size: 11px; max-width: 72px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; color: var(--text2);
}
.story-viewer {
  position: fixed; inset: 0; z-index: 10000;
  background: #000;
  display: flex; flex-direction: column;
  align-items: stretch;
  justify-content: center;
  font-family: var(--font, system-ui, sans-serif);
  color: #fff;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.story-viewer[hidden] { display: none !important; }

.sv-progress {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; gap: 4px;
  padding: max(10px, env(safe-area-inset-top)) 12px 0;
  z-index: 5;
}
.sv-seg {
  flex: 1; height: 2.5px; border-radius: 2px;
  background: rgba(255,255,255,0.28);
  overflow: hidden;
}
.sv-seg-fill {
  height: 100%; width: 0%;
  background: #fff;
  border-radius: 2px;
}

.sv-top {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: max(22px, calc(env(safe-area-inset-top) + 14px)) 12px 12px;
  z-index: 5;
  background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 100%);
  pointer-events: none;
}
.sv-user {
  display: flex; align-items: center; gap: 10px;
  min-width: 0; pointer-events: auto;
}
.sv-avi {
  width: 36px; height: 36px; border-radius: 50%;
  overflow: hidden; flex-shrink: 0;
  background: #222; border: 1.5px solid rgba(255,255,255,0.35);
}
.sv-avi img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.sv-meta { min-width: 0; }
.sv-name {
  font-size: 14px; font-weight: 700; line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 180px;
}
.sv-time {
  font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 1px;
}
.sv-close {
  width: 40px; height: 40px; border: none; border-radius: 50%;
  background: transparent; color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  pointer-events: auto; flex-shrink: 0;
}
.sv-close:hover { background: rgba(255,255,255,0.1); }

.sv-media {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #000;
  z-index: 1;
  user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none;
  pointer-events: none;
}
.sv-media img {
  max-width: 100%; max-height: 100%;
  width: 100%; height: 100%;
  object-fit: contain;
  display: block;
  user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none; -webkit-user-drag: none;
  pointer-events: none;
}

.sv-caption {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 2;
  padding: 56px 16px calc(24px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0));
  color: #fff; font-size: 16px; line-height: 1.4; text-align: center;
  white-space: pre-wrap; overflow-wrap: anywhere; pointer-events: none;
  user-select: none; -webkit-user-select: none;
}

.sv-nav {
  position: absolute; top: 0; bottom: 0;
  width: 35%; z-index: 3; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.sv-prev { left: 0; }
.sv-next { right: 0; }

@media (min-width: 700px) {
  .story-viewer { background: rgba(0,0,0,0.92); }
  .sv-media {
    inset: 4% auto;
    left: 50%; transform: translateX(-50%);
    width: min(420px, 92vw);
    height: 92%;
    border-radius: 12px;
    overflow: hidden;
    background: #0a0a0a;
  }
  .sv-progress {
    left: 50%; transform: translateX(-50%);
    width: min(420px, 92vw);
  }
  .sv-top {
    left: 50%; transform: translateX(-50%);
    width: min(420px, 92vw);
    border-radius: 12px 12px 0 0;
  }
  .sv-nav { width: 28%; }
  .sv-prev { left: calc(50% - min(210px, 46vw)); }
  .sv-next { right: calc(50% - min(210px, 46vw)); left: auto; }
}

`;
  document.head.appendChild(s);
}

function ensureDom() {
  ensureStoriesCss();
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
        <button type="button" class="sv-close" id="svClose" aria-label="Yopish">
          <img src="./svg/action/close.svg" alt="" class="icon" width="22" height="22">
        </button>
      </div>
      <div class="sv-media" id="svMedia"></div>
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
        if (e.target.closest('#svClose') || e.target.closest('.sv-user')) return;
        _isHolding = false;
        _startX = e.clientX;
        _startY = e.clientY;
        clearTimeout(_holdTimer);
        _holdTimer = setTimeout(() => {
          _isHolding = true;
          freezeStory();
        }, 140);
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
          unfreezeStory();
          return;
        }
        if (e.target.closest('#svClose') || e.target.closest('.sv-user')) return;
        // Bir marta qisqa bosish: chap/o'ng navigatsiya
        const mediaEl = $('svMedia') || v;
        const rect = mediaEl.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / (rect.width || 1);
        if (ratio < 0.40) {
          step(-1);
        } else {
          step(1);
        }
      };

      v.addEventListener('pointerup', handlePointerEnd);
      v.addEventListener('pointercancel', () => {
        clearTimeout(_holdTimer);
        if (_isHolding) {
          _isHolding = false;
          unfreezeStory();
        }
      });
      v.addEventListener('pointerleave', () => {
        clearTimeout(_holdTimer);
        if (_isHolding) {
          _isHolding = false;
          unfreezeStory();
        }
      });
    }

    // Esc: hikoya ko'rgich eng ustki qatlam (shortcuts.js bilan umumiy navbat)
    onEsc(900, () => { const v = $('storyViewer'); if (!v || v.hidden) return false; closeViewer(); return true; });
    document.addEventListener('keydown', e => {
      if ($('storyViewer')?.hidden) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    });
  }
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
      name: 'Sizning story',
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

export async function loadStories() {
  ensureDom();
  const track = $('storiesTrack');
  if (!track || !state.me?.uid) return;

  // Strip balandligini saqlab qolamiz — feed scroll tepaga sakramasin
  const _prevH = track.offsetHeight;
  if (_prevH > 0) track.style.minHeight = _prevH + 'px';
  track.innerHTML = '<div class="story-loading"><div class="spinner"></div></div>';

  try {
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
    if (state.me?.uid && !uids.includes(state.me.uid)) uids.push(state.me.uid);

    let profiles = [];
    if (uids.length) {
      const { data: pr } = await sb.from('profiles')
        .select('id, full_name, username, avatar')
        .in('id', uids);
      profiles = (pr || []).map(mapProfile);
    }
    const pMap = Object.fromEntries(profiles.map(p => [p.uid, p]));

    // Viewed set
    let viewed = new Set();
    if (stories.length && state.me?.uid) {
      const ids = stories.map(s => s.id);
      const { data: vv } = await sb.from('story_views')
        .select('story_id')
        .eq('user_id', state.me.uid)
        .in('story_id', ids);
      (vv || []).forEach(v => viewed.add(v.story_id));
    }

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
        createdAt: s.created_at,
        seen: viewed.has(s.id),
      });
    }

    const me = state.me.uid;
    const groups = [];

    // Own first
    const myItems = byUser.get(me) || [];
    const meP = pMap[me] || {};
    groups.push({
      uid: me,
      name: 'Sizning story',
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

    _groups = groups;
    renderBar();
  } catch (e) {
    console.warn('[stories]', e?.message || e);
    // Jadval yo'q bo'lsa ham "Sizning story" ko'rsatamiz
    const meP = state._userCache?.[state.me.uid] || {};
    _groups = [{
      uid: state.me.uid,
      name: 'Sizning story',
      avatar: meP.avatar || defAvi(meP.fullName || 'U'),
      items: [],
      hasUnseen: false,
      isMe: true,
    }];
    renderBar();
  }
}

function renderBar() {
  const track = $('storiesTrack');
  if (!track) return;
  track.style.minHeight = '';

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
      <span class="story-label">${esc(g.isMe ? (g.items.length ? 'Sizning story' : 'Story qo\'shish') : g.name.split(' ')[0])}</span>
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

function openViewer(groupIdx, itemIdx) {
  if (!_groups[groupIdx]?.items?.length) return;
  _viewerIdx = groupIdx;
  _itemIdx = Math.max(0, itemIdx < 0 ? 0 : itemIdx);
  const v = $('storyViewer');
  if (!v) return;
  v.hidden = false;
  document.body.style.overflow = 'hidden';
  showCurrent();
}

function freezeStory() {
  if (_paused) return;
  _paused = true;
  _pausedAt = performance.now();
}

function unfreezeStory() {
  if (!_paused) return;
  _paused = false;
  if (_pausedAt) {
    _startedAt += (performance.now() - _pausedAt);
    _pausedAt = 0;
  }
}

function closeViewer() {
  clearTimeout(_holdTimer);
  _isHolding = false;
  _paused = false;
  _pausedAt = 0;
  clearTimeout(_timer);
  cancelAnimationFrame(_progressRaf);
  const v = $('storyViewer');
  if (v) v.hidden = true;
  document.body.style.overflow = '';
  const media = $('svMedia');
  if (media) {
    media.innerHTML = '';
  }
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
  $('svName').textContent = g.name;
  $('svTime').textContent = fmtAgo(item.createdAt);
  $('svAvi').innerHTML = `<img src="${esc(g.avatar)}" alt="" onerror="this.style.display='none'">`;

  const media = $('svMedia');
  media.innerHTML = '';
  let duration = STORY_MS;

  const img = document.createElement('img');
  img.src = item.mediaUrl;
  img.alt = '';
  media.appendChild(img);

  if (item.caption) {
    const cap = document.createElement('div');
    cap.className = 'sv-caption';
    cap.textContent = item.caption;
    media.appendChild(cap);
  }

  // Mark viewed
  markViewed(item);

  // Progress animation
  _startedAt = performance.now();
  const n = g.items.length;
  const tick = (now) => {
    if (_paused) {
      _progressRaf = requestAnimationFrame(tick);
      return;
    }
    const ratio = Math.min(1, (now - _startedAt) / duration);
    buildProgress(n, _itemIdx, ratio);
    if (ratio >= 1) {
      step(1);
      return;
    }
    _progressRaf = requestAnimationFrame(tick);
  };
  buildProgress(n, _itemIdx, 0);
  _progressRaf = requestAnimationFrame(tick);
}

async function markViewed(item) {
  if (!state.me || item.seen) return;
  item.seen = true;
  try {
    await sb.from('story_views').upsert({
      story_id: item.id,
      user_id: state.me.uid,
      viewed_at: new Date().toISOString(),
    });
  } catch (_) {}
  // Update hasUnseen on group
  const g = _groups[_viewerIdx];
  if (g) g.hasUnseen = g.items.some(i => !i.seen);
}

function step(dir) {
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
    } else {
      closeViewer();
    }
  }
}

export function initStories() {
  ensureDom();
  loadStories();
}
