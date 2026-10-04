/* chat-media.js — DM chat sarlavhasidagi avatar/nom bosilganda ochiladigan profil ko'rinishi.
   Ko'rinishi boshqa foydalanuvchi profili (#userProfileModal) bilan bir xil: orqaga tugma, avatar, ism, statistika, tablar
   (Barchasi / Photos / Musics / Files) — lekin ostidagi medialar u odamning postlari emas,
   aynan shu suhbatda ikkalamiz ulashgan rasm, musiqa va fayllar. */
import { sb, mapMessage } from '../core/config.js';
import { esc, fmtSz, defAvi } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { onEsc } from '../ui/esc-stack.js';

const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'];
const AUD_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'aac', 'flac', 'opus', 'wma'];
const LIMIT = 300;

const ICON_PLAY = '<img src="./svg/extra/icon-e5c4dc67a486.svg" alt="" class="icon" width="16" height="16">';
const ICON_PAUSE = '<img src="./svg/extra/icon-61f15d5fa242.svg" alt="" class="icon" width="16" height="16">';
const ICON_FILE = '<img src="./svg/extra/icon-e3ece82ff84d.svg" alt="" class="icon" width="20" height="20">';
const ICON_DL = '<img src="./svg/extra/icon-fa9cc44ef90e.svg" alt="" class="icon" width="16" height="16">';

let _audio = null;
let _tab = 'all';
let _data = { media: [], audio: [], file: [] };
let _token = 0;
let _active = false;      // #userProfileModal hozir chat-media rejimida
let _bound = false;
let _viewer = null;
let _avatar = '';

const TABS = [['all', 'Barchasi'], ['photos', 'Photos'], ['music', 'Musics'], ['file', 'Files']];

function _kind(m) {
  const mime = (m.mediaType || '').toLowerCase();
  const ext = (m.fileName || '').toLowerCase().split('.').pop() || '';
  if (mime.startsWith('audio')) return 'audio';
  if (mime.startsWith('image')) return 'image';
  if (AUD_EXT.includes(ext)) return 'audio';
  if (IMG_EXT.includes(ext)) return 'image';
  return 'file';
}

const _url = m => (m.mediaUrl || '').replace(/"/g, '&quot;');
const _date = m => {
  try { return new Date(m.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (_) { return ''; }
};
const _sub = m => [m.fileSize ? fmtSz(m.fileSize) : '', _date(m)].filter(Boolean).join(' · ');
const $modal = () => document.getElementById('userProfileModal');
const $body = () => document.getElementById('upBody');

function _ensureBound() {
  if (_bound) return;
  _bound = true;
  const body = $body();
  body.addEventListener('click', e => {
    if (!_active) return;
    const tab = e.target.closest('[data-cm-tab]');
    if (tab) { _tab = tab.dataset.cmTab; _paintTabs(); _paintContent(); return; }
    const open = e.target.closest('[data-cm-open]');
    if (open) return _openViewer(+open.dataset.cmOpen);
    const au = e.target.closest('[data-cm-audio]');
    if (au) return _toggleAudio(+au.dataset.cmAudio);
  });
  document.getElementById('upBack')?.addEventListener('click', () => { if (_active) _deactivate(); });
  $modal().addEventListener('click', e => { if (_active && e.target === $modal()) _deactivate(); });
  document.addEventListener('chatmedia:close', closeChatMedia);
  // Rasm ko'rish oynasi (z 600) profil sahifasidan (500) ustida; profilning o'zi shortcuts.js da (userProfileModal)
  onEsc(600, () => {
    if (!_active || !_viewer?.classList.contains('show')) return false;
    _closeViewer();
    return true;
  });
}

function _deactivate() {
  _active = false;
  _token++;
  _stopAudio();
  _closeViewer();
}

/* ── Chizish ────────────────────────────────────────────────────────── */
function _counts() {
  const photos = _data.media.filter(m => m.kind === 'image').length;
  return { photos, music: _data.audio.length, file: _data.file.length };
}

function _paintHead(name) {
  const c = _counts();
  const av = (_avatar || defAvi(name || 'U')).replace(/"/g, '&quot;');
  $body().innerHTML = `
    <div class="up-head"><div class="up-avi-wrap"><div class="up-avi"><img class="w-full h-full object-cover" src="${esc(av)}" onerror="this.src='${defAvi(name || 'U')}'"></div></div></div>
    <div class="up-info">
      <div class="up-name">${esc(name || 'Suhbat')}</div>
      <div class="up-stats">
        <div class="up-stat"><div class="up-stat-val">${c.photos}</div><div class="up-stat-lbl">media</div></div>
        <div class="up-stat"><div class="up-stat-val">${c.music}</div><div class="up-stat-lbl">musiqa</div></div>
        <div class="up-stat"><div class="up-stat-val">${c.file}</div><div class="up-stat-lbl">fayllar</div></div>
      </div>
      <div class="up-posts-tab" id="cmTabs" role="tablist"></div>
      <div id="cmContent"></div>
    </div>`;
  _paintTabs();
  _paintContent();
}

function _paintTabs() {
  const el = document.getElementById('cmTabs');
  if (!el) return;
  el.innerHTML = TABS.map(([k, l]) =>
    `<button type="button" class="profile-grid-tab${k === _tab ? ' active' : ''}" data-cm-tab="${k}" role="tab" aria-selected="${k === _tab}">${l}</button>`).join('');
}

const _cellMedia = (m, i) =>
  `<div class="up-grid-cell up-grid-cell--media" data-cm-open="${i}"><img class="w-full h-full object-cover" src="${esc(_url(m))}" alt="" decoding="async" onerror="this.onerror=null;this.style.display='none';this.parentNode.classList.add('cm-broken')"></div>`;

function _rowsAudio() {
  return _data.audio.map((m, i) => `
    <div class="cm-row" data-cm-audio="${i}">
      <div class="cm-ico cm-aplay">${ICON_PLAY}</div>
      <div class="cm-info"><div class="cm-fn">${esc(m.fileName || 'Audio')}</div><div class="cm-sub">${esc(_sub(m))}</div></div>
    </div>`).join('');
}
function _rowsFiles() {
  return _data.file.map(m => `
    <a class="cm-row" href="${_url(m)}" target="_blank" rel="noopener" download="${esc(m.fileName || 'file')}">
      <div class="cm-ico">${ICON_FILE}</div>
      <div class="cm-info"><div class="cm-fn">${esc(m.fileName || 'Fayl')}</div><div class="cm-sub">${esc(_sub(m))}</div></div>
      <div class="cm-dl">${ICON_DL}</div>
    </a>`).join('');
}

function _paintContent() {
  const box = document.getElementById('cmContent');
  if (!box) return;
  const empty = t => `<div class="up-grid-empty"><div class="up-grid-empty-title">${t}</div></div>`;
  const grid = (html, uniform) => `<div class="up-grid${uniform ? ' up-grid--uniform' : ''}" id="upGrid">${html}</div>`;
  const media = _data.media.map((m, i) => ({ m, i }));
  if (_tab === 'photos') {
    const list = media.filter(x => x.m.kind === 'image');
    box.innerHTML = list.length ? grid(list.map(x => _cellMedia(x.m, x.i)).join(''), true)
      : empty('Hali rasm ulashilmagan');
  } else if (_tab === 'music') {
    box.innerHTML = _data.audio.length ? `<div class="cm-rows">${_rowsAudio()}</div>` : empty('Hali musiqa ulashilmagan');
    _syncAudioUI();
  } else if (_tab === 'file') {
    box.innerHTML = _data.file.length ? `<div class="cm-rows">${_rowsFiles()}</div>` : empty('Hali fayl ulashilmagan');
  } else {
    // Barchasi: rasm katakchalari + (bo'lsa) musiqa va fayllar ro'yxati
    const parts = [];
    if (media.length) parts.push(grid(media.map(x => _cellMedia(x.m, x.i)).join(''), true));
    if (_data.audio.length || _data.file.length) parts.push(`<div class="cm-rows">${_rowsAudio()}${_rowsFiles()}</div>`);
    box.innerHTML = parts.length ? parts.join('') : empty('Hali hech narsa ulashilmagan');
    _syncAudioUI();
  }
}

/* ── Musiqa ─────────────────────────────────────────────────────────── */
function _syncAudioUI() {
  document.querySelectorAll('#cmContent [data-cm-audio]').forEach(r => {
    const on = !!_audio && !_audio.paused && +r.dataset.cmAudio === _audio._i;
    r.classList.toggle('playing', on);
    r.querySelector('.cm-aplay').innerHTML = on ? ICON_PAUSE : ICON_PLAY;
  });
}
function _stopAudio() {
  if (!_audio) return;
  try { _audio.pause(); } catch (_) {}
  _audio = null;
  _syncAudioUI();
}
function _toggleAudio(i) {
  const m = _data.audio[i];
  if (!m) return;
  if (_audio && _audio._i === i) {
    _audio.paused ? _audio.play().catch(() => {}) : _audio.pause();
    return;
  }
  _stopAudio();
  const a = new Audio(m.mediaUrl);
  a._i = i;
  a.onplay = a.onpause = _syncAudioUI;
  a.onended = () => { if (_audio === a) _audio = null; _syncAudioUI(); };
  a.onerror = () => { toast('Musiqa ijro etilmadi', 'error'); if (_audio === a) _audio = null; _syncAudioUI(); };
  _audio = a;
  a.play().catch(() => {});
}

/* ── Rasm ko'rish ─────────────────────────────────────────────── */
function _ensureViewer() {
  if (_viewer) return _viewer;
  _viewer = document.createElement('div');
  _viewer.id = 'cmViewer';
  _viewer.addEventListener('click', e => { if (!e.target.closest('img')) _closeViewer(); });
  document.body.appendChild(_viewer);
  return _viewer;
}
function _openViewer(i) {
  const m = _data.media[i];
  if (!m) return;
  const v = _ensureViewer();
  v.innerHTML = `<img src="${esc(_url(m))}" alt="">`;
  v.classList.add('show');
}
function _closeViewer() {
  if (!_viewer) return;
  _viewer.classList.remove('show');
  _viewer.innerHTML = '';
}

/* ── Ochish / yopish ────────────────────────────────────────────────── */
export async function openChatMedia({ chatId, name, avatar } = {}) {
  if (!chatId) return;
  _ensureBound();
  const my = ++_token;
  _active = true;
  _tab = 'all';
  _data = { media: [], audio: [], file: [] };
  _avatar = avatar || '';
  _stopAudio();
  $body().innerHTML = '<div class="spin-wrap pt-80px"><div class="spinner"></div></div>';
  $modal().scrollTop = 0;
  $modal().classList.add('show');

  const { data, error } = await sb.from('messages').select('*')
    .eq('chat_id', chatId).eq('type', 'file')
    .order('created_at', { ascending: false }).limit(LIMIT);
  if (my !== _token || !_active) return;
  if (error) {
    console.warn('[ChatMedia]', error.message);
    $body().innerHTML = '<div class="up-grid-empty"><div class="up-grid-empty-title">Yuklanmadi</div></div>';
    return;
  }
  for (const r of (data || [])) {
    const m = mapMessage(r);
    if (!m || !m.mediaUrl) continue;
    m.kind = _kind(m);
    if (m.kind === 'image') _data.media.push(m);
    else if (m.kind === 'audio') _data.audio.push(m);
    else _data.file.push(m);
  }
  _paintHead(name);
}

export function closeChatMedia() {
  if (!_active) return;
  _deactivate();
  $modal()?.classList.remove('show');
}
