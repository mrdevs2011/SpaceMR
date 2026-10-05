/* msg-menu.js — xabar kontekst menyusi (Telegram uslubida).
   Desktop: xabar ustida sichqonchaning O'NG tugmasi. Mobil: xabar ustida bosib turish (long-press).
   Amallar: Nusxalash, Tahrirlash, Uzatish, O'chirish, Tanlash (ko'p tanlash paneli bilan).
   DM chat (#chatThreadMessages) uchun. Xabarlar har realtime o'zgarishda qayta chizilgani uchun
   holat (tanlov, ochiq menyu) xabar ID'lari bo'yicha saqlanadi va msgMenuAfterPaint() bilan tiklanadi. */
import { sb, state } from '../core/config.js';
import { toast } from '../ui/toast.js';
import { $, esc, defAvi, showConfirm, copyToClipboard } from '../core/utils.js';
import { onEsc } from '../ui/esc-stack.js';
import { markDissolve, unmarkDissolve } from '../ui/dissolve.js';
import { reactInit, reactStripHtml, reactPickerHtml, reactBindPicker, reactToggle, reactAfterPaint, reactReset, reactHoverHide, reactionsOf } from './msg-reactions.js';

const LONG_MS = 420;
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const IC = {
  copy: '<img src="./svg/menu/copy.svg" alt="" class="icon" width="18" height="18">',
  edit: '<img src="./svg/menu/edit.svg" alt="" class="icon" width="18" height="18">',
  fwd: '<img src="./svg/menu/fwd.svg" alt="" class="icon" width="18" height="18">',
  del: '<img src="./svg/menu/del.svg" alt="" class="icon" width="18" height="18">',
  sel: '<img src="./svg/menu/sel.svg" alt="" class="icon" width="18" height="18">',
  resend: '<img src="./svg/menu/resend.svg" alt="" class="icon" width="18" height="18">',
  x: '<img src="./svg/menu/x.svg" alt="" class="icon" width="18" height="18">',
  seen: '<img src="./svg/extra/icon-041fdea3033a.svg" alt="" class="icon" width="18" height="11">',
  sent: '<img src="./svg/extra/icon-e20961b31619.svg" alt="" class="icon" width="12" height="10">',
};

let api = null, box = null, menu = null, selBar = null, fwdEl = null;
let openId = null, selMode = false, editing = null;
let lp = null, lpTimer = null, lpOpened = false, suppressUntil = 0;
let drag = null, scrollRaf = 0; // surib belgilash holati
const sel = new Set();

const isDM = () => !state.currentChatKind || state.currentChatKind === 'dm';
const tbl = () => isDM() ? 'messages' : 'group_messages';
const msgOf = id => (api?.getMsgs() || []).find(m => m.id === id);
const isMine = m => m && m.senderId === state.me?.uid;
const isCallMsg = m => !!(m && m.text && m.text.includes('"__callLog"'));   // qo'ng'iroq yozuvi: faqat o'chirish / tanlash
/* O'chirish huquqi: o'z xabarim YOKI moderator (sayt admini / shu guruhning owner-admini) — boshqaning xabarini ham.
   Haqiqiy ruxsatni baza (RLS: messages_delete / gmsg_delete) ham tekshiradi. */
const canDel = m => !!m && (isMine(m) || !!api.canModerate?.());
const rowOf = el => el?.closest?.('.chat-msg[data-msg-id]:not([data-msg-id=""])') || null;
/** Xabar qatori: pufakning o'zi yoki uning yonidagi bo'sh joy (qator bo'ylab) — ikkalasi ham xabarga tegishli */
function rowAtPoint(target, y) {
  const r = rowOf(target);
  if (r) return r;
  if (target !== box) return null; // sana belgisi va h.k. emas, faqat ro'yxatning bo'sh joyi
  let best = null, bd = 1e9;
  for (const row of box.querySelectorAll('.chat-msg[data-msg-id]:not([data-msg-id=""])')) {
    const b = row.getBoundingClientRect();
    const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
    if (d < bd) { bd = d; best = row; }
  }
  return bd <= 3 ? best : null;
}
// Mobilda bitta bosish menyu ochadi — lekin bu elementlar o'z ishini qiladi (play, havola, rasm, avatar)
const TAP_KEEP = 'a, button, audio, input, textarea, [data-cm-open], .msg-avi-btn, .grp-sender-name[data-uid]';
const coarse = () => window.matchMedia('(pointer: coarse)').matches;
const pad = n => String(n).padStart(2, '0');

function when(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const now = new Date(), t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `bugun ${t}`;
  if (diff === 1) return `kecha ${t}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${t}`;
}

/* ── Menyu ─────────────────────────────────────────────────────────── */
function ensureMenu() {
  if (menu) return;
  menu = document.createElement('div');
  menu.id = 'msgCtx';
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-mc]');
    if (!b) return;
    const id = openId;
    closeMenu();
    run(b.dataset.mc, id);
  });
  // Reaksiya: tezkor qator yoki kengaytirilgan paneldagi emoji; chevron — panelni ochadi/yopadi
  menu.addEventListener('click', e => {
    const r = e.target.closest('[data-r]');
    if (r) { const id = openId; closeMenu(); if (id) reactToggle(id, r.dataset.r); return; }
    if (e.target.closest('[data-rmore]')) toggleReactPanel();
  });
  menu.addEventListener('contextmenu', e => e.preventDefault());
  // "Kimlar ko'rdi": desktop — hover, sensorli — bosish
  menu.addEventListener('mouseover', e => {
    const r = e.target.closest?.('.mc-readers.has-list');
    if (r && !coarse()) showSeenList(r);
  });
  menu.addEventListener('mouseout', e => {
    const r = e.target.closest?.('.mc-readers');
    if (r && !r.contains(e.relatedTarget)) hideSeenSoon();
  });
  menu.addEventListener('click', e => {
    const r = e.target.closest?.('.mc-readers.has-list');
    if (!r || !coarse()) return;
    if (seenEl?.classList.contains('show')) hideSeen(); else showSeenList(r);
  });
  document.body.appendChild(menu);
}

/* ── Guruh: xabarimni kimlar ko'rdi ────────────────────────────────── */
let seenEl = null, seenHideT = 0, readersSeq = 0;
const _rdProf = new Map();                   // uid → {name, avatar}
let _rdCache = { gid: null, at: 0, rows: [] };

async function fetchReaders(gid, createdAt) {
  const now = Date.now();
  if (_rdCache.gid !== gid || now - _rdCache.at > 3000) {
    const { data, error } = await sb.from('group_members').select('user_id, joined_at, last_read_at').eq('group_id', gid);
    if (error) throw error;
    _rdCache = { gid, at: now, rows: data || [] };
  }
  const me = state.me?.uid;
  const t = Number(createdAt) || Date.parse(createdAt) || 0;
  const rows = _rdCache.rows.filter(r => r.user_id !== me && r.last_read_at && Date.parse(r.last_read_at) >= t
    && (!r.joined_at || Date.parse(r.joined_at) <= t + 1000));
  const need = rows.map(r => r.user_id).filter(u => !_rdProf.has(u));
  if (need.length) {
    const { data } = await sb.from('profiles').select('id, full_name, username, avatar').in('id', need);
    (data || []).forEach(p => _rdProf.set(p.id, { name: p.full_name || p.username || 'Foydalanuvchi', avatar: p.avatar || '' }));
    need.forEach(u => { if (!_rdProf.has(u)) _rdProf.set(u, { name: 'Foydalanuvchi', avatar: '' }); });
  }
  return rows
    .sort((a, b) => Date.parse(a.last_read_at) - Date.parse(b.last_read_at))
    .map(r => ({ uid: r.user_id, ..._rdProf.get(r.user_id) }));
}

async function loadReaders(m) {
  const gid = $('chatThreadModal')?.dataset?.gid;
  if (!gid || !m.id || m.status === 'sending') return;
  const seq = ++readersSeq;
  try {
    const list = await fetchReaders(gid, m.createdAt);
    // Reaksiya bildirgan odam xabarni ko'rgan — o'qish belgisi bo'lmasa ham ro'yxatga qo'shamiz
    const rx = reactionsOf(m.id), have = new Set(list.map(u => u.uid));
    const extra = [...rx.keys()].filter(u => u !== state.me?.uid && !have.has(u));
    if (extra.length) {
      const need = extra.filter(u => !_rdProf.has(u));
      if (need.length) {
        const { data } = await sb.from('profiles').select('id, full_name, username, avatar').in('id', need);
        (data || []).forEach(p => _rdProf.set(p.id, { name: p.full_name || p.username || 'Foydalanuvchi', avatar: p.avatar || '' }));
        need.forEach(u => { if (!_rdProf.has(u)) _rdProf.set(u, { name: 'Foydalanuvchi', avatar: '' }); });
      }
      extra.forEach(u => list.push({ uid: u, ..._rdProf.get(u) }));
    }
    if (seq !== readersSeq || openId !== m.id || !list.length) return;
    paintReaders(list, m.id);
  } catch (_) { /* last_read_at ustuni hali yo'q (062) — oddiy "Yuborildi" qoladi */ }
}

const rdAvi = (u, cls) => `<img class="${cls}" src="${esc(u.avatar || defAvi(u.name))}" alt="" draggable="false">`;

function paintReaders(list, mid) {
  const el = menu?.querySelector('.mc-readers');
  if (!el) return;
  const one = list.length === 1;
  el.innerHTML = `${IC.seen}<span class="mc-rd-label">${one ? esc(list[0].name) : list.length + ' kishi ko‘rdi'}</span>`
    + (one ? rdAvi(list[0], 'mc-rd-avi') : `<span class="mc-rd-stack">${list.slice(0, 3).map(u => rdAvi(u, 'mc-rd-avi')).join('')}</span>`);
  el.classList.add('has-list');
  el._list = list;
  el._mid = mid;
}

function ensureSeenList() {
  if (seenEl) return;
  seenEl = document.createElement('div');
  seenEl.id = 'msgSeenList';
  seenEl.addEventListener('mouseenter', () => clearTimeout(seenHideT));
  seenEl.addEventListener('mouseleave', () => hideSeenSoon());
  seenEl.addEventListener('contextmenu', e => e.preventDefault());
  seenEl.addEventListener('click', e => {
    const b = e.target.closest('[data-uid]');
    if (!b) return;
    const uid = b.dataset.uid;
    closeMenu();
    import('../profile/profile.js').then(mod => mod.openUserProfileModal(uid)).catch(() => {});
  });
  document.body.appendChild(seenEl);
}

function showSeenList(rowEl) {
  const list = rowEl?._list;
  if (!list?.length || !menu) return;
  clearTimeout(seenHideT);
  ensureSeenList();
  const rx = reactionsOf(rowEl._mid);   // kim qanday emoji bilan reaksiya bildirgan
  seenEl.innerHTML = `<div class="sl-scroll">${list.map(u =>
    `<button type="button" class="sl-item" data-uid="${esc(u.uid)}">${rdAvi(u, 'sl-avi')}<span class="sl-name">${esc(u.name)}</span>${rx.get(u.uid) ? `<span class="sl-react">${esc(rx.get(u.uid))}</span>` : ''}${IC.seen}</button>`).join('')}</div>`;
  seenEl.style.visibility = 'hidden';
  seenEl.classList.add('show');
  const mr = menu.getBoundingClientRect(), rr = rowEl.getBoundingClientRect();
  const w = seenEl.offsetWidth, h = seenEl.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let left, top;
  if (mr.right + 6 + w <= vw - 8) { left = mr.right + 6; top = rr.bottom - h; }          // menyuning o'ng tomonida
  else if (mr.left - 6 - w >= 8) { left = mr.left - 6 - w; top = rr.bottom - h; }       // chap tomonida
  else {                                                                                // tor ekran: menyu tagida / tepasida
    left = Math.max(8, Math.min(vw - w - 8, mr.left));
    top = mr.bottom + 6 + h <= vh - 8 ? mr.bottom + 6 : mr.top - h - 6;
  }
  seenEl.style.left = left + 'px';
  seenEl.style.top = Math.max(8, Math.min(vh - h - 8, top)) + 'px';
  seenEl.style.visibility = '';
}

function hideSeen() { clearTimeout(seenHideT); seenEl?.classList.remove('show'); }
function hideSeenSoon() { clearTimeout(seenHideT); seenHideT = setTimeout(hideSeen, 160); }

function menuHtml(m) {
  const mine = isMine(m);
  const it = (k, ico, label, cls = '') => `<button type="button" class="mc-item ${cls}" data-mc="${k}">${ico}<span>${label}</span></button>`;
  // Yuborilayotgan xabar — faqat "Qayta yuborish"
  if (mine && m.status === 'sending') {
    return it('resend', IC.resend, 'Qayta yuborish');
  }
  if (isCallMsg(m)) {
    let c = '';
    if (canDel(m)) c += it('del', IC.del, 'O‘chirish', 'danger');
    return c + it('sel', IC.sel, 'Tanlash');
  }
  const hasText = !!(m.text || '').trim();
  let h = '';
  const isPostShare = m.text && m.text.includes('"__postShare"');
  if (hasText && isDM()) h += it('copy', IC.copy, isPostShare ? 'Havolani nusxalash' : 'Nusxalash');
  if (mine && m.type === 'text' && !isPostShare) h += it('edit', IC.edit, 'Tahrirlash');
  h += it('link', IC.copy, 'Xabar havolasi');
  h += it('fwd', IC.fwd, 'Uzatish');
  if (canDel(m)) h += it('del', IC.del, 'O‘chirish', 'danger');
  h += it('sel', IC.sel, 'Tanlash');
  if (mine && !isDM()) {
    // Guruh: "kimlar ko'rdi" (ro'yxat openMenu() dan keyin asinxron yuklanadi)
    h += `<div class="mc-sep"></div><div class="mc-seen mc-readers">${IC.sent}<span class="mc-rd-label">Yuborildi · ${when(m.createdAt)}</span></div>`;
  } else if (mine) {
    const read = m.status === 'read' && m.readAt;
    h += `<div class="mc-sep"></div><div class="mc-seen">${read ? IC.seen : IC.sent}<span>${read ? 'O‘qildi · ' + when(m.readAt) : 'Yuborildi · ' + when(m.createdAt)}</span></div>`;
  }
  return h;
}

function openMenu(row, x, y) {
  const id = row.dataset.msgId, m = msgOf(id);
  if (!m) return;
  closeMenu();
  ensureMenu();
  reactHoverHide();
  openId = id;
  row.classList.add('mc-active');
  const canReact = !!m.id && !(isMine(m) && m.status === 'sending') && !isCallMsg(m);
  menu.classList.remove('mc-expanded');
  menu.innerHTML = (canReact ? reactStripHtml(m) : '') + `<div class="mc-items">${menuHtml(m)}</div>`;
  // Reaksiya qatori: sichqoncha g'ildiragi bilan gorizontal aylantirish
  menu.querySelector('.mc-r-scroll')?.addEventListener('wheel', ev => {
    if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { ev.currentTarget.scrollLeft += ev.deltaY; ev.preventDefault(); }
  }, { passive: false });
  if (!isDM() && isMine(m)) loadReaders(m);
  menu.style.visibility = 'hidden';
  menu.classList.add('show');
  const w = menu.offsetWidth, h = menu.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let left, top;
  if (x != null) { // desktop: kursor yonida
    left = x + w > vw - 8 ? x - w : x;
    top = y + h > vh - 8 ? y - h : y;
  } else { // mobil: pufakcha tagida (sig'masa tepasida)
    const r = (row.querySelector('.chat-bubble') || row).getBoundingClientRect();
    left = isMine(m) ? r.right - w : r.left;
    top = r.bottom + 8;
    if (top + h > vh - 8) top = r.top - h - 8;
  }
  left = Math.max(8, Math.min(vw - w - 8, left));
  top = Math.max(8, Math.min(vh - h - 8, top));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.transformOrigin = `${x != null ? '0' : (isMine(m) ? '100%' : '0')} 0`;
  menu.style.visibility = '';
}

/** Menyu balandligini (va kerak bo'lsa top'ini) silliq o'zgartiradi: change() DOM'ni o'zgartiradi */
function morphMenu(change) {
  const r0 = menu.getBoundingClientRect(), h0 = r0.height;
  change();
  menu.style.transition = 'none'; menu.style.boxSizing = 'border-box'; menu.style.height = 'auto';
  const h1 = menu.getBoundingClientRect().height, vh = window.innerHeight;
  let top = r0.top;
  if (top + h1 > vh - 8) top = vh - 8 - h1;
  top = Math.max(8, top);
  menu.style.height = h0 + 'px'; menu.style.overflow = 'hidden';
  void menu.offsetHeight;
  menu.style.transition = 'height .26s cubic-bezier(.2, .8, .2, 1), top .26s cubic-bezier(.2, .8, .2, 1)';
  menu.style.height = h1 + 'px'; menu.style.top = top + 'px';
  clearTimeout(morphMenu._t);
  morphMenu._t = setTimeout(() => { menu.style.height = ''; menu.style.transition = ''; menu.style.overflow = ''; menu.style.boxSizing = ''; }, 300);
}

/** Chevron: menyu ichida tanlangan reaksiya emojilari paneli (menyu bandlari yopiladi), qayta bosilsa — orqaga */
async function toggleReactPanel() {
  if (!menu || !openId) return;
  const more = menu.querySelector('[data-rmore]');
  if (menu.classList.contains('mc-expanded')) {
    morphMenu(() => {
      menu.classList.remove('mc-expanded');
      menu.querySelector('.mr-pick')?.remove();
    });
    more?.setAttribute('aria-expanded', 'false');
    return;
  }
  const id = openId;
  const html = await reactPickerHtml();
  if (openId !== id || !menu.classList.contains('show')) return;
  morphMenu(() => {
    menu.insertAdjacentHTML('beforeend', html);
    menu.classList.add('mc-expanded');
  });
  more?.setAttribute('aria-expanded', 'true');
  reactBindPicker(menu);
}

function closeMenu() {
  hideSeen();
  readersSeq++;
  if (menu) menu.classList.remove('show');
  box?.querySelectorAll('.mc-active').forEach(r => r.classList.remove('mc-active'));
  openId = null;
}

/* ── Amallar ───────────────────────────────────────────────────────── */
function run(act, id) {
  const m = msgOf(id);
  if (!m) return;
  if (act === 'copy') {
    if (m.text && m.text.includes('"__postShare"')) {
      try {
        const ps = JSON.parse(m.text);
        if (ps?.post?.id) {
          const url = `${window.location.origin}/p/${ps.post.id}`;
          copyToClipboard(url);
          toast('Nusxalandi');
          return;
        }
      } catch (_) {}
    }
    copyToClipboard((m.text || '').trim());
    toast('Nusxalandi');
    return;
  }
  if (act === 'link') {
    copyToClipboard(`${window.location.origin}${window.location.pathname}#m-${id}`);
    toast('Havola nusxalandi');
    return;
  }
  if (act === 'edit') return startEdit(m);
  if (act === 'fwd') return forward([id]);
  if (act === 'del') return remove([id]);
  if (act === 'sel') return enterSelect(id);
  if (act === 'resend') return resendMsg(id);
}


async function resendMsg(id) {
  const m = msgOf(id);
  if (!m || !isMine(m)) return;
  // Media hali yuklanayotgan bo'lsa — kutish
  if ((m.type === 'voice' || m.type === 'file') && !m.mediaPath) {
    toast('Hali yuklanmoqda…', 'info');
    return;
  }
  const dm = isDM();
  const threadId = m.chatId || state.currentChatId
    || document.getElementById('chatThreadModal')?.dataset?.gid || null;
  if (!threadId) {
    toast('Suhbat topilmadi', 'error');
    return;
  }
  const base = {
    id: m.id,
    sender_id: state.me.uid,
    type: m.type || 'text',
    text: m.text || null,
    media_path: m.mediaPath || null,
    media_type: m.mediaType || null,
    file_name: m.fileName || null,
    file_size: m.fileSize ?? null,
    duration: m.duration ?? null,
  };
  const row = dm
    ? { ...base, chat_id: threadId }
    : { ...base, group_id: threadId };
  try {
    const { error } = await sb.from(tbl()).insert(row);
    if (error) {
      // Allaqachon bor (duplicate) — muvaffaqiyat deb hisoblaymiz
      if (error.code === '23505') {
        if (typeof api.markSent === 'function') api.markSent(id);
        else api.reload?.();
        return;
      }
      console.warn('[MsgMenu] resend:', error.message);
      toast('Qayta yuborilmadi', 'error');
      return;
    }
    if (typeof api.markSent === 'function') api.markSent(id);
    else api.reload?.();
  } catch (e) {
    console.warn('[MsgMenu] resend:', e?.message || e);
    toast('Qayta yuborilmadi', 'error');
  }
}

function remove(ids) {
  const own = ids.filter(id => canDel(msgOf(id)));   // o'chirishga ruxsat berilganlar (o'zimniki yoki moderator sifatida)
  if (!own.length) return;
  showConfirm(own.length > 1 ? `${own.length} ta xabar o‘chirilsinmi?` : 'Xabar o‘chirilsinmi?', () => {
    // 1) UI dan darhol (0 ms) — dissolve + local list
    markDissolve(own);
    if (editing && own.some(id => id === editing.id)) cancelEdit(true);
    exitSelect();
    if (typeof api.applyLocalDelete === 'function') api.applyLocalDelete(own);
    else api.reload?.();

    // 2) Haqiqiy o'chirish orqa fonda
    const idList = own.slice();
    sb.from(tbl()).delete().in('id', idList).then(({ error }) => {
      if (error) {
        unmarkDissolve(idList);
        console.warn('[MsgMenu] delete:', error.message);
        toast('O‘chirilmadi', 'error');
        api.reload?.(); // ro'yxatni tiklash
      }
    }).catch(e => {
      unmarkDissolve(idList);
      console.warn('[MsgMenu] delete:', e?.message || e);
      toast('O‘chirilmadi', 'error');
      api.reload?.();
    });
  }, 'O‘chirish', 'O‘chirish');
}

/* ── Tahrirlash (input ustida "Tahrirlash" paneli, reply-bar qayta ishlatiladi) ── */
function startEdit(m) {
  exitSelect();
  editing = { id: m.id, text: m.text || '' };
  const inp = $('chatThreadInput');
  inp.value = editing.text;
  api.syncInput();
  inp.focus();
  try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {}
  $('chatReplyName').textContent = 'Tahrirlash';
  $('chatReplyText').textContent = editing.text.slice(0, 140);
  $('chatReplyBar').classList.add('active');
}

export function isEditing() { return !!editing; }

export function cancelEdit(clearInput = true) {
  if (!editing) return;
  editing = null;
  $('chatReplyBar')?.classList.remove('active');
  if (clearInput) { const inp = $('chatThreadInput'); if (inp) inp.value = ''; api?.syncInput(); }
}

/** sendChatMessage() tahrirlash rejimida shuni chaqiradi */
export async function commitEdit(rawText) {
  const ed = editing;
  if (!ed) return false;
  const text = (rawText || '').trim();
  if (!text) return true;
  if (text === (ed.text || '').trim()) { cancelEdit(true); return true; }
  const { error } = await sb.from(tbl())
    .update({ text, edited_at: new Date().toISOString() }).eq('id', ed.id);
  if (error) { console.warn('[MsgMenu] edit:', error.message); toast('Tahrirlanmadi', 'error'); return true; }
  cancelEdit(true);
  api.reload();
  return true;
}

/* ── Tanlash rejimi ────────────────────────────────────────────────── */
function ensureSelBar() {
  if (selBar) return;
  selBar = document.createElement('div');
  selBar.id = 'msgSelBar';
  selBar.innerHTML = `
    <button type="button" class="msb-btn" data-sb="fwd"><span>Uzatish</span><b class="msb-n"></b></button>
    <button type="button" class="msb-btn" data-sb="del"><span>O‘chirish</span><b class="msb-n"></b></button>
    <button type="button" class="msb-btn" data-sb="copy"><span>Nusxalash</span></button>
    <button type="button" class="msb-btn" data-sb="edit"><span>Tahrirlash</span></button>
    <span class="msb-sp"></span>
    <button type="button" class="msb-cancel" data-sb="x" title="Bekor qilish" aria-label="Bekor qilish">${IC.x}</button>`;
  selBar.addEventListener('click', e => {
    const b = e.target.closest('[data-sb]');
    if (!b) return;
    const ids = [...sel];
    if (b.dataset.sb === 'x') exitSelect();
    else if (b.dataset.sb === 'copy') {
      const t = (api.getMsgs() || []).filter(m => sel.has(m.id)).map(m => (m.text || '').trim()).filter(Boolean).join('\n');
      if (t) { copyToClipboard(t); toast('Nusxalandi'); } else toast('Nusxalanadigan matn yo‘q');
    }
    else if (b.dataset.sb === 'edit') { const m = msgOf(ids[0]); if (m) startEdit(m); }
    else if (b.dataset.sb === 'fwd') forward(ids, true);
    else if (b.dataset.sb === 'del') remove(ids);
  });
  // Telegramdagidek: tanlash paneli SARLAVHA o'rnida (tepada)
  const _m = $('chatThreadModal'), _h = _m.querySelector('.chat-thread-hdr');
  if (_h && _h.parentNode === _m) _m.insertBefore(selBar, _h); else _m.appendChild(selBar);
}

function enterSelect(id) {
  closeMenu();
  reactHoverHide();
  cancelEdit(true);
  ensureSelBar();
  selMode = true;
  sel.clear();
  if (id) sel.add(id);
  // Panel sarlavha ustiga yopishadi: balandligi sarlavhaga teng — layout siljimaydi
  const _hd = $('chatThreadModal').querySelector('.chat-thread-hdr');
  if (_hd && _hd.offsetHeight) selBar.style.height = _hd.offsetHeight + 'px';
  box.classList.add('msg-selecting');
  $('chatThreadModal').classList.add('msg-sel-on');
  paintSel();
}

function exitSelect() {
  if (!selMode) return;
  selMode = false;
  sel.clear();
  box?.classList.remove('msg-selecting');
  box?.querySelectorAll('.mc-selected').forEach(r => r.classList.remove('mc-selected'));
  $('chatThreadModal')?.classList.remove('msg-sel-on');
}

function toggleSel(id) {
  if (sel.has(id)) sel.delete(id); else sel.add(id);
  paintSel();
}

function paintSel(keepEmpty) {
  if (!selMode) return;
  if (!sel.size && !keepEmpty) { exitSelect(); return; }
  box.querySelectorAll('.chat-msg[data-msg-id]').forEach(r => r.classList.toggle('mc-selected', sel.has(r.dataset.msgId)));
  selBar.querySelectorAll('.msb-n').forEach(n => { n.textContent = sel.size; });
  // Nusxalash / Tahrirlash / O'chirish — FAQAT o'z xabarlarim tanlangan bo'lsa (DM ham, guruh ham).
  // Birorta begona xabar aralashsa — faqat "Uzatish" qoladi.
  const allMine = [...sel].every(id => isMine(msgOf(id)));
  const hasCall = [...sel].some(id => isCallMsg(msgOf(id)));
  selBar.querySelector('[data-sb="fwd"]').hidden = hasCall;
  selBar.querySelector('[data-sb="del"]').hidden = !allMine || ![...sel].every(id => canDel(msgOf(id)));
  selBar.querySelector('[data-sb="copy"]').hidden = hasCall || !allMine || !(api.getMsgs() || []).some(m => sel.has(m.id) && (m.text || '').trim());
  const one = sel.size === 1 ? msgOf([...sel][0]) : null;
  selBar.querySelector('[data-sb="edit"]').hidden = hasCall || !(allMine && one && one.type === 'text' && !(one.text && one.text.includes('"__postShare"')));
}

/* ── Uzatish (foydalanuvchi tanlash oynasi) ────────────────────────── */
async function forward(ids, fromSel = false) {
  const list = (api.getMsgs() || []).filter(m => ids.includes(m.id));
  if (!list.length) return;
  const users = await api.getUsers().catch(() => []) || [];
  if (!fwdEl) {
    fwdEl = document.createElement('div');
    fwdEl.id = 'msgFwd';
    fwdEl.innerHTML = `<div class="mf-card" role="dialog" aria-label="Uzatish">
      <div class="mf-head"><span>Uzatish</span><button type="button" class="mf-close" data-mf="x" title="Yopish">${IC.x}</button></div>
      <input type="text" class="mf-search" placeholder="Qidirish..." autocomplete="off" spellcheck="false">
      <div class="mf-list"></div></div>`;
    fwdEl.addEventListener('click', e => { if (e.target === fwdEl || e.target.closest('[data-mf="x"]')) fwdEl.classList.remove('show'); });
    document.body.appendChild(fwdEl);
  }
  const listEl = fwdEl.querySelector('.mf-list'), search = fwdEl.querySelector('.mf-search');
  const paint = q => {
    q = (q || '').trim().toLowerCase();
    const res = users.filter(u => !q || (u.fullName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q));
    listEl.innerHTML = res.length
      ? res.map(u => `<div class="mf-row" data-uid="${esc(u.uid)}"><img src="${esc(u.avatar || defAvi(u.fullName || 'U'))}" alt="" onerror="this.src='${defAvi(u.fullName || 'U')}'"><span>${esc(u.fullName || u.username || 'Foydalanuvchi')}</span></div>`).join('')
      : '<div class="mf-empty">Topilmadi</div>';
  };
  search.value = '';
  search.oninput = () => paint(search.value);
  paint('');
  listEl.onclick = async e => {
    const row = e.target.closest('.mf-row');
    if (!row) return;
    fwdEl.classList.remove('show');
    const chatId = await api.chatIdFor(row.dataset.uid);
    if (!chatId) { toast('Suhbat ochilmadi', 'error'); return; }
    for (const m of list) { // tartib saqlansin — ketma-ket
      const { error } = await sb.from('messages').insert({
        chat_id: chatId, sender_id: state.me.uid, type: m.type,
        text: m.text || null, media_path: m.mediaPath || null, media_type: m.mediaType || null,
        file_name: m.fileName || null, file_size: m.fileSize || null, duration: m.duration || null,
      });
      if (error) { console.warn('[MsgMenu] forward:', error.message); toast('Uzatilmadi', 'error'); return; }
    }
    toast('Uzatildi');
    if (fromSel) exitSelect();
  };
  fwdEl.classList.add('show');
  setTimeout(() => { if (!coarse()) search.focus(); }, 30);
}

/* ── Surib belgilash (Telegram uslubi) ────────────────────────────────
   Xabarni bosib turish -> shu xabar belgilanadi (tanlash rejimi), barmoqni tepaga/pastga surilsa
   oradagi xabarlar ham belgilanadi (qaytsa — belgi olinadi). Chetga yaqinlashsa ro'yxat o'zi aylanadi. */
const rowsList = () => [...box.querySelectorAll('.chat-msg[data-msg-id]:not([data-msg-id=""])')];

function rowIndexAtY(rows, y) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (y < r.top) {
      if (i === 0) return 0;
      return (y - rows[i - 1].getBoundingClientRect().bottom) < (r.top - y) ? i - 1 : i;
    }
    if (y <= r.bottom) return i;
  }
  return rows.length - 1;
}

function beginDrag(row, y) {
  const id = row.dataset.msgId;
  window.getSelection?.()?.removeAllRanges();
  if (!selMode) enterSelect(id); else toggleSel(id);
  if (!selMode) return; // oxirgi belgi olib tashlandi — surish yo'q
  drag = { anchor: id, adding: sel.has(id), base: new Set(sel), lastY: y };
  scrollRaf = requestAnimationFrame(autoScroll);
}

function updateDrag(y) {
  if (!drag || !selMode) return;
  drag.lastY = y;
  const rows = rowsList();
  const a = rows.findIndex(r => r.dataset.msgId === drag.anchor);
  const c = rowIndexAtY(rows, y);
  if (a < 0 || c < 0) return;
  const lo = Math.min(a, c), hi = Math.max(a, c);
  const next = new Set(drag.base);
  for (let i = lo; i <= hi; i++) {
    const id = rows[i].dataset.msgId;
    if (drag.adding) next.add(id); else next.delete(id);
  }
  sel.clear();
  next.forEach(id => sel.add(id));
  paintSel(true);
}

function autoScroll() {
  scrollRaf = 0;
  if (!drag) return;
  const r = box.getBoundingClientRect(), y = drag.lastY, edge = 56;
  let v = 0;
  if (y < r.top + edge) v = -Math.ceil((r.top + edge - y) / 4);
  else if (y > r.bottom - edge) v = Math.ceil((y - (r.bottom - edge)) / 4);
  v = Math.max(-22, Math.min(22, v));
  if (v) { box.scrollTop += v; updateDrag(y); }
  scrollRaf = requestAnimationFrame(autoScroll);
}

function endDrag() {
  if (!drag) return;
  drag = null;
  if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
  suppressUntil = Date.now() + 400; // qo'yib yuborilgandan keyingi "click" ni yutamiz
  if (selMode && !sel.size) exitSelect(); else paintSel();
}

/* ── Hodisalar ─────────────────────────────────────────────────────── */
function cancelLp() { clearTimeout(lpTimer); lpTimer = null; lp = null; }

export function initMsgMenu(opts) {
  api = opts;
  box = opts.box;
  if (!box || box.dataset.msgMenu) return;
  box.dataset.msgMenu = '1';
  reactInit(box);

  // Desktop: o'ng tugma. Sensorli qurilmada brauzerning o'z menyusini bostiramiz (long-press o'zimiz ushlaymiz).
  box.addEventListener('contextmenu', e => {
    const row = rowAtPoint(e.target, e.clientY);
    if (!row) return;
    e.preventDefault();
    if (coarse() || selMode) return;
    openMenu(row, e.clientX, e.clientY);
  });

  // Mobil: bosib turish -> belgilash, suring -> oradagilar ham belgilanadi
  box.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const row = rowAtPoint(e.target, t.clientY);
    if (!row) return;
    cancelLp();
    lp = { row, x: t.clientX, y: t.clientY };
    lpTimer = setTimeout(() => {
      const r = lp?.row, y0 = lp?.y;
      cancelLp();
      if (!r || !r.isConnected) return;
      navigator.vibrate?.(12);
      lpOpened = true;
      closeMenu();
      // Yuborilayotgan xabar — tanlash emas, "Qayta yuborish" menyusi
      const mm = msgOf(r.dataset.msgId);
      if (mm && mm.status === 'sending' && isMine(mm)) {
        openMenu(r, null, null);
        return;
      }
      beginDrag(r, y0);
    }, LONG_MS);
  }, { passive: true });
  box.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (drag) { e.preventDefault(); updateDrag(t.clientY); return; } // surish paytida ro'yxat o'zi siljimasin
    if (!lp) return;
    if (Math.abs(t.clientX - lp.x) > 10 || Math.abs(t.clientY - lp.y) > 10) cancelLp();
  }, { passive: false });
  // Bosib turib qo'yib yuborilganda brauzer "click" yuborishi mumkin (play tugmasi, havola...) — uni yutamiz
  const endTouch = () => { cancelLp(); endDrag(); if (lpOpened) { lpOpened = false; suppressUntil = Date.now() + 400; } };
  box.addEventListener('touchend', endTouch, { passive: true });
  box.addEventListener('touchcancel', endTouch, { passive: true });

  // Desktop: sichqonchani bosib turing (yoki tanlash rejimida shunchaki suring) — xuddi shu mantiq
  let ms = null, msTimer = null;
  box.addEventListener('mousedown', e => {
    if (e.button !== 0 || coarse()) return;
    if (!selMode && e.target.closest('a,button,input,textarea,audio,[contenteditable]')) return;
    const row = rowAtPoint(e.target, e.clientY);
    if (!row) return;
    clearTimeout(msTimer);
    ms = { row, x: e.clientX, y: e.clientY };
    if (!selMode) msTimer = setTimeout(() => {
      const r = ms?.row, y0 = ms?.y;
      if (!r || !r.isConnected) return;
      lpOpened = false;
      const mm = msgOf(r.dataset.msgId);
      if (mm && mm.status === 'sending' && isMine(mm)) {
        openMenu(r, null, null);
        return;
      }
      beginDrag(r, y0);
    }, LONG_MS);
  });
  document.addEventListener('mousemove', e => {
    if (drag) { updateDrag(e.clientY); return; }
    if (!ms) return;
    if (Math.abs(e.clientX - ms.x) <= 6 && Math.abs(e.clientY - ms.y) <= 6) return;
    clearTimeout(msTimer);
    if (selMode) { const r = ms.row; ms = null; if (r.isConnected) beginDrag(r, e.clientY); }
    else ms = null; // oddiy matn belgilash
  });
  document.addEventListener('mouseup', () => { clearTimeout(msTimer); ms = null; endDrag(); });

  // Bosib turgandan keyingi "click" (masalan play tugmasi) va tanlash rejimidagi bosishlar
  box.addEventListener('click', e => {
    if (Date.now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); return; }
    if (!selMode) {
      // Mobil: xabar (yoki uning qatori) ustiga bitta bosish -> menyu
      if (!coarse()) return;
      const r = rowAtPoint(e.target, e.clientY);
      if (!r) return;
      const keep = e.target.closest?.(TAP_KEEP);
      if (keep && box.contains(keep)) return; // play tugmasi, havola, rasm...
      if (e.target.closest?.('.chat-msg.emoji-only.emo-1 .chat-bubble-text')) return; // bitta emoji — faqat animatsiya
      e.stopPropagation(); e.preventDefault();
      openMenu(r, null, null);
      return;
    }
    const row = rowAtPoint(e.target, e.clientY);
    if (!row) return;
    e.stopPropagation(); e.preventDefault();
    toggleSel(row.dataset.msgId);
  }, true);

  box.addEventListener('scroll', () => { if (openId) closeMenu(); }, { passive: true });

  // Menyudan tashqariga bosilsa yopiladi
  document.addEventListener('pointerdown', e => {
    if (!openId || menu?.contains(e.target) || seenEl?.contains(e.target)) return;
    if (e.pointerType === 'touch') suppressUntil = Date.now() + 350;
    closeMenu();
  }, true);
  // Esc (z = ekrandagi qatlam): uzatish oynasi 620, kontekst menyu 600, tanlash rejimi / tahrirlash-javob — chat ustida (365)
  onEsc(620, () => { if (!fwdEl?.classList.contains('show')) return false; fwdEl.classList.remove('show'); return true; });
  onEsc(600, () => { if (!openId) return false; closeMenu(); return true; });
  onEsc(365, () => {
    if (selMode) { exitSelect(); return true; }
    if (editing) { cancelEdit(true); return true; }
    return false;
  });
  window.addEventListener('resize', () => { if (menu?.contains(document.activeElement)) return; closeMenu(); });
  $('chatReplyClose')?.addEventListener('click', () => cancelEdit(true));
}

/** paintMessages() dan keyin chaqiriladi — tanlov/ochiq menyu holatini yangi DOM'ga qaytaradi */
export function msgMenuAfterPaint() {
  if (!api) return;
  reactAfterPaint();
  if (selMode) {
    const ids = new Set((api.getMsgs() || []).map(m => m.id));
    for (const id of [...sel]) if (!ids.has(id)) sel.delete(id);
    paintSel();
  }
  if (openId) {
    const row = box.querySelector(`.chat-msg[data-msg-id="${openId}"]`);
    if (row) row.classList.add('mc-active'); else closeMenu();
  }
}

/** Chat yopilganda / almashtirilganda */
export function msgMenuReset() {
  reactReset();
  cancelLp();
  endDrag();
  closeMenu();
  exitSelect();
  cancelEdit(true);
  fwdEl?.classList.remove('show');
}
