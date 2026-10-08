/* SpaceMR Group tugmasi: mobil header + desktop chap panel.
   Guruh avatari (username = 'spacemr') doira ichida, yonida "SpaceMR Group" yozuvi; bosilsa guruh chati ochiladi. */
import { sb } from '../core/config.js';

const USERNAME = 'spacemr';
const FALLBACK = './svg/logo.png';
const CACHE_KEY = 'spacemr_grp_chip_avatar';

function _paint(src) {
  document.querySelectorAll('.grp-chip-img').forEach(img => {
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  });
}

function _bindFallback() {
  document.querySelectorAll('.grp-chip-img').forEach(img => {
    img.addEventListener('error', () => {
      if (img.getAttribute('src') === FALLBACK) return;
      img.setAttribute('src', FALLBACK);
      try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
    });
  });
}

let _busy = false;
let _done = false;
async function _load() {
  if (_busy || _done) return;
  _busy = true;
  try {
    const { data, error } = await sb.from('groups').select('avatar').ilike('username', USERNAME).maybeSingle();
    if (error || !data) return;
    _done = true;
    const av = data.avatar || '';
    if (av) {
      _paint(av);
      try { localStorage.setItem(CACHE_KEY, av); } catch (_) {}
    } else {
      _paint(FALLBACK);
      try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
    }
  } catch (_) {
    /* tarmoq xatosi: keshlangan yoki standart logo qoladi */
  } finally {
    _busy = false;
  }
}

function _init() {
  document.querySelectorAll('[data-grp-chip]').forEach(el => {
    if (!el.getAttribute('title')) el.setAttribute('title', 'Muammo va takliflar');
  });
  let cached = '';
  try { cached = localStorage.getItem(CACHE_KEY) || ''; } catch (_) {}
  _bindFallback();
  if (cached) _paint(cached);

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-grp-chip]');
    if (!btn) return;
    e.preventDefault();
    import('../url-router.js')
      .then(m => m.applyPath('/chats/g/' + USERNAME))
      .catch(() => {});
  });

  try {
    sb.auth.onAuthStateChange((_evt, session) => { if (session) setTimeout(_load, 0); });
    sb.auth.getSession().then(({ data }) => { if (data?.session) _load(); }).catch(() => {});
  } catch (_) {}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init, { once: true });
else _init();


/* ROADMAP 10: sozlamalardan SpaceMR guruhiga */
function _bindFeedback() {
  const row = document.getElementById('settingsFeedbackRow');
  if (!row || row._bound) return;
  row._bound = true;
  const go = () => {
    import('../url-router.js')
      .then(m => m.applyPath('/chats/g/spacemr'))
      .catch(() => { location.href = '/chats/g/spacemr'; });
    document.getElementById('settingsOverlay')?.classList.remove('show');
  };
  row.addEventListener('click', go);
  row.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bindFeedback, { once: true });
else _bindFeedback();


/* ROADMAP 3 — push tur sozlamalari (localStorage) */
function _bindPushPrefs() {
  const map = {
    pushPrefMsg: 'spacemr_push_msg',
    pushPrefComment: 'spacemr_push_comment',
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el || el._bound) return;
    el._bound = true;
    try {
      const v = localStorage.getItem(key);
      if (v === '0') el.checked = false;
      else el.checked = true;
    } catch (_) {}
    el.addEventListener('change', () => {
      try { localStorage.setItem(key, el.checked ? '1' : '0'); } catch (_) {}
    });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bindPushPrefs, { once: true });
else _bindPushPrefs();


