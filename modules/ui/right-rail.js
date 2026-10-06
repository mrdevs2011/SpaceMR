/**
 * Right rail (desktop ≥1200px) — ~50 kishilik doira:
 * Onlayn, Guruhlar, So‘nggi faollik.
 * Yangilanish: postsUpdated / groupsUpdated hodisalari + 15s zaxira tick (o'z realtime kanali yo'q — roadmap 5.3).
 */
import { sb, state, mapProfile } from '../core/config.js';
import { isUidOnline, onlineUids } from '../core/rt-bus.js';
import { $, esc, defAvi, isOnline } from '../core/utils.js';
import { groupListItems } from '../chat/groups.js';

const MAX_ONLINE = 12;
const MAX_GROUPS = 8;
const MAX_RECENT = 8;

let _tick = null;
let _started = false;
let _refreshTimer = null;

function rail() { return $('rightRail'); }

function showRail(on) {
  const el = rail();
  if (!el) return;
  if (on) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

function fit() {
  // home, profile, saved, notifs va qidiruv (explore overlay) da — 3 ustun
  const view = state.view || 'home';
  const exploreOpen = !!document.getElementById('searchOverlay')?.classList.contains('open');
  const isDesktop = window.matchMedia('(min-width: 1200px)').matches;
  rail()?.classList.toggle('rr-apps-mode', view === 'apps');
  const allowed = view === 'home' || view === 'profile' || view === 'saved' || view === 'notifs' || view === 'apps' || exploreOpen;
  showRail(
    allowed &&
    isDesktop &&
    !!state.me?.uid
  );
  // Desktop: sozlamalar profil sahifasida doimo ochiq (ochish/yopish yo'q)
  const sw = $('rrSettingsWrap');
  if (sw) sw.hidden = true; // tugma kerak emas — panel o'zi ochiq

  const settingsOverlay = document.getElementById('settingsOverlay');
  const railEl = rail();
  if (isDesktop && settingsOverlay && railEl && settingsOverlay.parentElement !== railEl) {
    railEl.appendChild(settingsOverlay);
  }
  // Mobil/planshet: overlay yashirin (hidden) right-rail ichida qolib ketmasin — body ga qaytaramiz
  if (!isDesktop && settingsOverlay && railEl && settingsOverlay.parentElement === railEl) {
    document.body.appendChild(settingsOverlay);
    document.body.classList.remove('desktop-settings-pinned');
  }
  if (settingsOverlay && state.me?.uid) {
    // Kashf ochiq bo'lsa o'ng ustunda oddiy kartalar ko'rinadi (sozlamalar emas)
    if (isDesktop && view === 'profile' && !exploreOpen) {
      if (!settingsOverlay.classList.contains('show')) {
        // Forma ma'lumotlarini to'ldirish (lazy)
        import('../auth/auth.js').then(m => {
          m.populateProfileForm?.();
        }).catch(() => {});
        settingsOverlay.classList.add('show');
        document.body.classList.add('desktop-settings-pinned');
      } else {
        document.body.classList.add('desktop-settings-pinned');
      }
    } else if (isDesktop) {
      // Profil emas — yopamiz
      settingsOverlay.classList.remove('show');
      document.body.classList.remove('desktop-settings-pinned');
    }
  }
}

/** Router navigatsiyasidan chaqiriladi */
export function onRouteChange() {
  fit();
  // Comments panel ochiq qolgan bo'lsa, view o'zgarganda yopamiz
  const exploreOpen = !!document.getElementById('searchOverlay')?.classList.contains('open');
  if (!['home', 'profile', 'saved', 'notifs', 'apps'].includes(state.view || '') && !exploreOpen) {
    const cmt = document.getElementById('rrCmtPanel');
    if (cmt && !cmt.hidden) {
      cmt.hidden = true;
      document.querySelectorAll('#rightRail .rr-card').forEach(c => { c.hidden = false; });
    }
  }
}

function aviHtml(name, url, online) {
  const src = url || defAvi(name || '?');
  return `<span class="rr-avi"><img src="${esc(src)}" alt="" onerror="this.style.display='none'">${online ? '<span class="rr-dot" title="onlayn"></span>' : ''}</span>`;
}

function cmtOpen() {
  const cmt = document.getElementById('rrCmtPanel');
  return cmt && !cmt.hidden;
}

async function loadOnline() {
  const box = $('rrOnlineList');
  if (!box || !state.me?.uid) return;
  try {
    const { data, error } = await sb.from('profiles')
      .select('id, username, full_name, avatar, last_seen, approval, blocked, blocked_until')
      .eq('approval', 'approved')
      .eq('blocked', false)
      .order('last_seen', { ascending: false })
      .limit(40);
    if (error) throw error;
    const me = state.me.uid;
    const online = (data || [])
      .map(mapProfile)
      .filter(u => u && u.uid !== me && (isUidOnline(u.uid, isOnline(u.lastSeenAt))))
      .slice(0, MAX_ONLINE);
    // Presence bo'yicha ham qo'shimcha (ro'yxatda yo'q lekin onlayn)
    // (limit ichida qolamiz)
    if (!online.length) {
      box.innerHTML = '<div class="rr-empty">Hozircha hech kim onlayn emas</div>';
      return;
    }
    box.innerHTML = online.map(u => {
      const name = u.fullName || u.username || 'Foydalanuvchi';
      const sub = u.username ? '@' + u.username : 'onlayn';
      return `<button type="button" class="rr-row" data-rr-user="${esc(u.uid)}">
        ${aviHtml(name, u.avatar, true)}
        <span class="rr-meta"><div class="rr-name">${esc(name)}</div><div class="rr-sub">${esc(sub)}</div></span>
      </button>`;
    }).join('');
  } catch (e) {
    console.warn('[right-rail] online', e?.message || e);
    box.innerHTML = '<div class="rr-empty">Yuklab bo‘lmadi</div>';
  }
}

function loadGroups() {
  const box = $('rrGroupsList');
  if (!box) return;
  const items = (groupListItems || []).slice(0, MAX_GROUPS);
  if (!items.length) {
    box.innerHTML = '<div class="rr-empty">Hali guruh yo‘q</div>';
    return;
  }
  box.innerHTML = items.map(g => {
    const name = g.name || g.title || 'Guruh';
    const n = g.subscriberCount || (g.members?.length || 0);
    const sub = (n ? n + ' a\'zo' : 'Guruh');
    const av = g.avatar || g.photoURL || '';
    return `<button type="button" class="rr-row" data-rr-group="${esc(g.id)}">
      ${aviHtml(name, av, false)}
      <span class="rr-meta"><div class="rr-name">${esc(name)}</div><div class="rr-sub">${esc(sub)}</div></span>
    </button>`;
  }).join('');
}

function loadRecent() {
  const box = $('rrRecentList');
  if (!box) return;
  const posts = (state.allPosts || []).slice(0, MAX_RECENT);
  if (!posts.length) {
    box.innerHTML = '<div class="rr-empty">Hali yangilik yo‘q</div>';
    return;
  }
  box.innerHTML = posts.map(p => {
    const name = p.userFullName || 'Kimdir';
    const text = (p.text || '').trim().replace(/\s+/g, ' ').slice(0, 60) || (p.mediaType ? 'Media' : 'Post');
    const uid = p.userId || '';
    const av = state._userCache?.[uid]?.avatar || '';
    return `<button type="button" class="rr-row" data-rr-post="${esc(p.id)}" data-rr-user="${esc(uid)}">
      ${aviHtml(name, av, false)}
      <span class="rr-meta"><div class="rr-name">${esc(name)}</div><div class="rr-sub">${esc(text)}</div></span>
    </button>`;
  }).join('');
}

function scheduleRefresh(delay = 200) {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => { refresh(); }, delay);
}

async function refresh() {
  fit();
  if (!rail() || rail().hasAttribute('hidden')) return;
  if (cmtOpen()) return;
  await loadOnline();
  loadGroups();
  loadRecent();
}

function onClick(e) {
  const row = e.target.closest('.rr-row');
  if (!row) return;
  const uid = row.getAttribute('data-rr-user');
  const gid = row.getAttribute('data-rr-group');
  const pid = row.getAttribute('data-rr-post');
  if (gid) {
    import('../chat/groups.js').then(m => m.openGroupThread?.(gid));
    return;
  }
  if (pid) {
    // Post havolasi: bosh sahifaga o'tib, aynan shu postga scroll + yoritish (qaysi sahifadan bosilmasin)
    import('../feed/feed.js').then(m => m.openPostLink(pid)).catch(() => {});
    return;
  }
  if (uid) {
    import('../profile/profile.js').then(m => m.openUserProfileModal?.(uid)).catch(() => {});
  }
}

export function startRightRail() {
  if (_started) return;
  _started = true;
  rail()?.addEventListener('click', onClick);
  $('rrSettingsBtn')?.addEventListener('click', () => $('settingsBtn')?.click());
  window.addEventListener('resize', fit);
  document.addEventListener('groupsUpdated', () => { if (!cmtOpen()) loadGroups(); });
  document.addEventListener('profilesPreloaded', () => scheduleRefresh(50));
  document.addEventListener('postsUpdated', () => { if (!cmtOpen()) loadRecent(); });
  fit();
  refresh();
  // Zaxira: realtime uzilsa ham 15s da yangilanadi (oldin 45s edi)
  _tick = setInterval(() => scheduleRefresh(0), 45000);
}

export function stopRightRail() {
  if (_tick) { clearInterval(_tick); _tick = null; }
  clearTimeout(_refreshTimer);
  showRail(false);
  _started = false;
}

// Auto-start when logged in
startRightRail();
// fit() allaqachon onRouteChange/resize da chaqiriladi — 2s polling kerak emas
document.addEventListener('profilesPreloaded', () => { if (state.me?.uid) fit(); });


/* Presence o'zgarganda onlayn ro'yxatni yangilash */
document.addEventListener('presenceChanged', () => {
  if (document.visibilityState === 'visible') loadOnline();
});

/* Kimdir ismi/avatarini o'zgartirganda onlayn ro'yxatni yangilash */
window.addEventListener('spacemr:resync', () => scheduleRefresh(0));
document.addEventListener('profileChanged', () => {
  if (document.visibilityState === 'visible') loadOnline();
});
