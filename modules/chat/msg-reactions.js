/* msg-reactions.js — xabarga reaksiya (Telegram uslubida), DM va guruh uchun bir xil.
   - Kontekst menyu tepasida tezkor reaksiyalar qatori + chevron (msg-menu.js shuni chizadi)
   - Chevron bosilsa menyu ichida belgilangan balandlikdagi emoji paneli ochiladi (scroll + qidiruv)
   - Reaksiyalar xabar pufakchasi tagida chip bo'lib ko'rinadi (bosilsa — o'zimning reaksiyam almashadi/olinadi)
   - Saqlash: public.message_reactions (063 + 094 SQL), bir foydalanuvchi — bir xabarga bitta reaksiya.
     emoji ustuniga rasm EMAS, faqat PATH yoziladi ("emoji/2d/1f525.png"); ko'rsatishda <img> real vaqtda chiziladi.
   - Jonli: postgres_changes (thread_id bo'yicha). DOM: paintMessages() dan keyin reactAfterPaint() chiplarni qayta qo'yadi. */
import { sb, state } from '../core/config.js';
import { esc, defAvi } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { emojiImg, warmEmoji, emojiPath, toKey } from '../ui/emoji-img.js';

export const QUICK = ['2764', '1f44d', '1f44e', '1f525', '1f970', '1f44f', '1f601'];   // kalitlar (hex) — kodda emoji belgisi yo'q
/** Reaksiyaga arziydigan tanlangan emojilar (menyu qatori + chevron paneli) */
export const REACTS = ['2764', '1f44d', '1f44e', '1f525', '1f970', '1f44f', '1f601', '1f602', '1f923', '1f62e', '1f622', '1f62d', '1f621', '1f92f', '1f631', '1f914', '1f929', '1f60d', '1f60e', '1f973', '1f389', '1f4af', '1f64f', '1f44c', '1f4aa', '1f91d', '1f440', '1f494', '2764-200d-1f525', '1f634', '1f921', '1f974', '1fae1', '1f3c6', '26a1', '1f37e'];
const TABLE = 'message_reactions';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHEV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

let box = null, cur = null, ch = null, seq = 0, bound = false;
const byMsg = new Map();   // msgId -> Map(uid -> emoji)
const pops = new Map();    // msgId -> { e, t } — yangi qo'shilgan reaksiya (animatsiya uchun)
const prof = new Map();    // uid -> { name, avatar } (keshda yo'q bo'lsa)
const me = () => state.me?.uid;
/* Bazadagi qiymat HAR DOIM path: "emoji/2d/<kalit>.png". Eski qatorlardagi belgi ham path'ga o'giriladi; yaroqsiz qiymat '' bo'ladi. */
const norm = e => emojiPath(e);

function threadNow() {
  const dm = !state.currentChatKind || state.currentChatKind === 'dm';
  const id = dm ? state.currentChatId : document.getElementById('chatThreadModal')?.dataset?.gid;
  return id && UUID_RE.test(String(id)) ? { kind: dm ? 'dm' : 'group', id: String(id) } : null;
}

const put = r => {
  const e = norm(r.emoji);
  if (!e) return;
  let m = byMsg.get(r.message_id);
  if (!m) byMsg.set(r.message_id, m = new Map());
  m.set(r.user_id, e);
};
const drop = r => {
  const m = byMsg.get(r.message_id);
  if (!m) return;
  m.delete(r.user_id);
  if (!m.size) byMsg.delete(r.message_id);
};

function teardown() {
  seq++;
  if (ch) { try { sb.removeChannel(ch); } catch (_) {} ch = null; }
}

/** Joriy suhbat o'zgargan bo'lsa — reaksiyalarni yuklab, jonli kanalga ulanadi */
function sync() {
  const t = threadNow();
  const key = t ? t.kind + ':' + t.id : '';
  const was = cur ? cur.kind + ':' + cur.id : '';
  if (key === was) return;
  teardown();
  byMsg.clear();
  cur = t;
  if (!t) return;
  const my = seq;
  sb.from(TABLE).select('message_id,user_id,emoji').eq('thread_id', t.id).then(({ data, error }) => {
    if (my !== seq) return;
    if (error) { console.warn('[React] yuklanmadi:', error.message); return; }
    byMsg.clear();
    (data || []).forEach(put);
    paintAll();
  });
  ch = sb.channel('react-' + t.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `thread_id=eq.${t.id}` }, p => {
      if (my !== seq) return;
      const row = p.eventType === 'DELETE' ? p.old : p.new;
      if (!row?.message_id) return;
      if (p.eventType !== 'DELETE' && row.user_id !== me() && norm(row.emoji) && byMsg.get(row.message_id)?.get(row.user_id) !== norm(row.emoji)) pops.set(row.message_id, { e: norm(row.emoji), t: Date.now() });
      if (p.eventType === 'DELETE') drop(row); else put(row);
      paintMsg(row.message_id);
    })
    .subscribe();
}

/* ── Chiplar ───────────────────────────────────────────────────────── */
function avatarOf(uid) {
  const c = state._userCache?.[uid];
  if (c) return { name: c.fullName || c.username || 'U', avatar: c.avatar || '' };
  if (uid === me()) return { name: state.me?.fullName || state.me?.name || 'U', avatar: state.me?.avatar || '' };
  const p = prof.get(uid);
  if (p) return p;
  fetchProfiles([uid]);
  return { name: 'U', avatar: '' };
}

let _pf = new Set(), _pfT = 0;
function fetchProfiles(uids) {
  uids.forEach(u => _pf.add(u));
  clearTimeout(_pfT);
  _pfT = setTimeout(async () => {
    const need = [..._pf].filter(u => !prof.has(u)); _pf = new Set();
    if (!need.length) return;
    try {
      const { data } = await sb.from('profiles').select('id, full_name, username, avatar').in('id', need);
      (data || []).forEach(p => prof.set(p.id, { name: p.full_name || p.username || 'U', avatar: p.avatar || '' }));
      need.forEach(u => { if (!prof.has(u)) prof.set(u, { name: 'U', avatar: '' }); });
      paintAll(true);
    } catch (_) {}
  }, 80);
}

function chipsHtml(m) {
  const g = new Map();
  for (const [uid, e] of m) { if (!g.has(e)) g.set(e, []); g.get(e).push(uid); }
  const few = m.size <= 3;   // kam odam — avatarlar, ko'p bo'lsa — son
  const mineE = m.get(me());
  return [...g].map(([e, uids]) => {
    const tail = few
      ? `<span class="mr-avs">${uids.map(u => { const a = avatarOf(u); return `<img class="mr-av" src="${esc(a.avatar || defAvi(a.name))}" alt="" draggable="false">`; }).join('')}</span>`
      : `<span class="mr-n">${uids.length}</span>`;
    return `<button type="button" class="mr-chip${mineE === e ? ' mine' : ''}${few ? ' few' : ''}" data-re="${esc(e)}"><span class="mr-e">${emojiImg(e)}</span>${tail}</button>`;
  }).join('');
}

function paintMsg(id, force) {
  if (!box || !id) return;
  const row = box.querySelector(`.chat-msg[data-msg-id="${CSS.escape(String(id))}"]`);
  const bub = row?.querySelector('.chat-bubble');
  if (!bub) return;
  // Chiplar pufak ICHIDA emas — qatorning o'zida, pufakdan butunlay pastda (Telegram uslubi)
  bub.querySelector(':scope > .msg-reacts')?.remove();   // eski joydagi nusxa bo'lsa
  let el = row.querySelector(':scope > .msg-reacts');
  const m = byMsg.get(id);
  if (!m || !m.size) { el?.remove(); row.classList.remove('has-reacts'); return; }
  row.classList.add('has-reacts');
  const html = chipsHtml(m);
  if (!el) { el = document.createElement('div'); el.className = 'msg-reacts'; row.appendChild(el); }
  // Guruhda boshqa odam xabari: chiplar avatardan emas, pufak chetidan boshlansin
  el.style.marginLeft = row.classList.contains('theirs') ? bub.offsetLeft + 'px' : '';
  if (el._html === html && !force) return;
  el._html = html;
  el.innerHTML = html;
  el.querySelectorAll('.mr-av').forEach(im => im.addEventListener('error', () => { im.onerror = null; im.src = defAvi('U'); }, { once: true }));
  const pp = pops.get(id);
  if (pp) {
    pops.delete(id);
    if (Date.now() - pp.t < 1500) {
      const chip = [...el.querySelectorAll('.mr-chip')].find(c => c.dataset.re === pp.e);
      if (chip) chip.classList.add('pop');
    }
  }
}

function paintAll(force) {
  if (!box) return;
  box.querySelectorAll('.chat-msg[data-msg-id]:not([data-msg-id=""])').forEach(r => paintMsg(r.dataset.msgId, force));
}

/* ── Amal ──────────────────────────────────────────────────────────── */
export async function reactToggle(msgId, emoji) {
  emoji = norm(emoji);   // bazaga faqat path boradi (rasm emas, belgi ham emas)
  if (!emoji) return;
  sync();
  const t = cur, uid = me();
  if (!t || !uid || !msgId) return;
  const prev = byMsg.get(msgId)?.get(uid);
  const remove = prev === emoji;
  const rollback = () => { pops.delete(msgId); if (prev) put({ message_id: msgId, user_id: uid, emoji: prev }); else drop({ message_id: msgId, user_id: uid }); paintMsg(msgId); };
  if (remove) drop({ message_id: msgId, user_id: uid }); else { put({ message_id: msgId, user_id: uid, emoji }); pops.set(msgId, { e: emoji, t: Date.now() }); }
  paintMsg(msgId);   // optimistik — darhol
  try {
    const { error } = remove
      ? await sb.from(TABLE).delete().eq('message_id', msgId).eq('user_id', uid)
      : await sb.from(TABLE).upsert({ message_id: msgId, thread_id: t.id, kind: t.kind, user_id: uid, emoji }, { onConflict: 'message_id,user_id' });
    if (error) { console.warn('[React]', error.message); rollback(); toast('Reaksiya yuborilmadi', 'error'); }
  } catch (e) { console.warn('[React]', e?.message || e); rollback(); toast('Reaksiya yuborilmadi', 'error'); }
}

/* ── Menyu qismlari (msg-menu.js ishlatadi) ────────────────────────── */
export function reactStripHtml(m) {
  sync();
  const mine = byMsg.get(m.id)?.get(me());
  return `<div class="mc-react"><div class="mc-r-scroll">${REACTS.map(e => `<button type="button" class="mc-r${mine === norm(e) ? ' on' : ''}" data-r="${norm(e)}" aria-label="Reaksiya">${emojiImg(e)}</button>`).join('')}</div><button type="button" class="mc-r-more" data-rmore aria-label="Ko‘proq reaksiya" aria-expanded="false">${CHEV}</button></div>`;
}

/* ── Hover (faqat sichqonchali qurilma): xabar chetida bitta tezkor reaksiya; ustiga borilsa — vertikal scrollli ro'yxat (10 ta) ── */
export const HOVER_SET = ['2764', '1f44d', '1f44e', '1f525', '1f970', '1f44f', '1f601', '1f62e', '1f622', '1f389'];
warmEmoji([...REACTS, ...HOVER_SET]);                 // reaksiya paneli/chiplari
const QK = 'spacemr_react_quick';
const canHover = () => !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
let hb = null, hp = null, hRow = null, hideT = 0, openT = 0, dwellT = 0, dwellRow = null;
const DWELL_MS = 1000;   // xabar ustida shuncha turilgandan keyin tezkor reaksiya tugmasi chiqadi
const quick = () => { try { const q = toKey(localStorage.getItem(QK)); if (q && HOVER_SET.includes(q)) return q; } catch (_) {} return HOVER_SET[0]; };   // eski belgi saqlangan bo'lsa ham kalitga o'giriladi
const setQuick = e => { try { localStorage.setItem(QK, toKey(e)); } catch (_) {} };
const mineOn = row => !!byMsg.get(row?.dataset?.msgId)?.get(me());
// Chat sarlavhasi (suzuvchi) tagiga panel kirib ketmasin: pastroq chegara
const minTop = () => {
  const hdr = document.querySelector('#chatThreadModal .chat-thread-hdr');
  const bt = box ? box.getBoundingClientRect().top : 0;
  return Math.max(6, bt + 6, hdr ? hdr.getBoundingClientRect().bottom + 6 : 0);
};
const busy = () => !box || box.classList.contains('msg-selecting') || document.getElementById('msgCtx')?.classList.contains('show');

function ensureHover() {
  if (hb) return;
  hb = document.createElement('button');
  hb.type = 'button'; hb.id = 'msgHoverReact'; hb.setAttribute('aria-label', 'Reaksiya');
  hp = document.createElement('div');
  hp.id = 'msgHoverPick';
  hp.innerHTML = '<div class="hp-list"></div>';
  hb.addEventListener('click', e => { e.stopPropagation(); pickHover(quick()); });
  hb.addEventListener('mouseenter', () => { clearTimeout(hideT); clearTimeout(openT); openT = setTimeout(openPick, 140); });
  hb.addEventListener('mouseleave', () => { clearTimeout(openT); scheduleHide(); });
  hp.addEventListener('mouseenter', () => clearTimeout(hideT));
  hp.addEventListener('mouseleave', scheduleHide);
  hp.addEventListener('contextmenu', e => e.preventDefault());
  hp.addEventListener('click', e => {
    const b = e.target.closest('[data-e]');
    if (b) { e.stopPropagation(); pickHover(b.dataset.e); }
  });
  document.body.append(hb, hp);
}

function pickHover(emoji) {
  const id = hRow?.dataset.msgId;
  hideHover();
  if (!id) return;
  setQuick(emoji);
  reactToggle(id, emoji);
}

function scheduleHide() { clearTimeout(hideT); hideT = setTimeout(hideHover, 220); }

function placeHover() {
  const bub = hRow?.querySelector('.chat-bubble');
  if (!bub || !hb || !box) return;
  const r = bub.getBoundingClientRect(), b = box.getBoundingClientRect(), mt = minTop();
  if (r.bottom < mt + 8 || r.top > b.bottom - 8) { hideHover(); return; }
  const mine = hRow.classList.contains('mine');
  const left = Math.max(b.left + 2, Math.min(window.innerWidth - 36, mine ? r.left - 36 : r.right + 6));
  const top = Math.min(r.bottom, b.bottom - 6) - 30;
  hb.style.left = left + 'px';
  hb.style.top = Math.max(mt, top) + 'px';
}

function showHover(row) {
  if (!canHover() || !row?.isConnected) return;
  if (busy() || mineOn(row) || row.querySelector('.bubble-call')) { hideHover(); return; }   // men allaqachon reaksiya qo'ygan — hover panel yo'q
  ensureHover();
  clearTimeout(hideT);
  if (hRow !== row) { hidePick(); hRow = row; }
  const q = quick();
  hb.innerHTML = emojiImg(q);
  hb.classList.add('show');
  placeHover();
}

function openPick() {
  if (!hb || !hp || !hRow?.isConnected || !hb.classList.contains('show') || busy() || mineOn(hRow)) return;
  const q = quick(), mineE = byMsg.get(hRow.dataset.msgId)?.get(me());
  // column-reverse: birinchi (tezkor) emoji pastda — tugma ustida; qolganlari tepaga scroll
  hp.firstChild.innerHTML = [q, ...HOVER_SET.filter(e => e !== q)]
    .map((e, i) => `<button type="button" class="hp-e${mineE === norm(e) ? ' on' : ''}" data-e="${norm(e)}" aria-label="Reaksiya" style="--i:${i}">${emojiImg(e)}</button>`).join('');
  const r = hb.getBoundingClientRect();
  // Bo'sh joyga BUTUN emoji sig'adigan qilib balandlik: 36px emoji + 4px oraliq (kesilib qolmasin)
  const room = r.bottom + 4 - minTop() - 18;
  const n = Math.max(3, Math.min(5, Math.floor((room + 4) / 40)));
  hp.firstChild.style.maxHeight = (n * 36 + (n - 1) * 4) + 'px';
  hp.style.visibility = 'hidden';
  hp.classList.add('show');
  hp.firstChild.scrollTop = 0;
  const w = hp.offsetWidth, h = hp.offsetHeight;
  hp.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
  hp.style.top = Math.max(minTop(), r.bottom + 4 - h) + 'px';
  hp.style.visibility = '';
}

function hidePick() { clearTimeout(openT); hp?.classList.remove('show'); }

export function reactHoverHide() {
  clearTimeout(hideT);
  clearTimeout(dwellT); dwellRow = null;
  hidePick();
  hb?.classList.remove('show');
  hRow = null;
}
const hideHover = reactHoverHide;

/* ── Hayot sikli ───────────────────────────────────────────────────── */
export function reactInit(boxEl) {
  box = boxEl;
  if (bound || !box) return;
  bound = true;
  // Hover: xabar ustida — chetda tezkor reaksiya tugmasi
  box.addEventListener('mouseover', e => {
    if (!canHover()) return;
    const row = e.target.closest?.('.chat-msg[data-msg-id]:not([data-msg-id=""])');
    if (!row) { clearTimeout(dwellT); dwellRow = null; if (hRow) scheduleHide(); return; }
    if (row === hRow && hb?.classList.contains('show')) { clearTimeout(hideT); return; }
    if (hRow) scheduleHide();   // boshqa xabarga o'tildi — eskisi yopiladi
    if (row === dwellRow) return;   // shu xabar ustida turish davom etyapti
    clearTimeout(dwellT); dwellRow = row;
    dwellT = setTimeout(() => { if (dwellRow === row) { dwellRow = null; showHover(row); } }, DWELL_MS);
  });
  box.addEventListener('mouseleave', () => { clearTimeout(dwellT); dwellRow = null; if (hRow) scheduleHide(); });
  box.addEventListener('scroll', () => { if (hRow || dwellRow) reactHoverHide(); }, { passive: true });
  box.addEventListener('click', e => {
    const c = e.target.closest?.('.mr-chip');
    if (!c) return;
    const row = c.closest('.chat-msg[data-msg-id]');
    if (!row) return;
    e.preventDefault(); e.stopPropagation();
    reactToggle(row.dataset.msgId, c.dataset.re);
  });
}

/** paintMessages() dan keyin: yangi chizilgan qatorlarga chiplarni qaytaradi */
export function reactAfterPaint() {
  sync(); paintAll();
  if (hRow) { if (hRow.isConnected && !mineOn(hRow)) placeHover(); else reactHoverHide(); }
}

/** Xabarga qo'yilgan reaksiyalar: Map(uid -> emoji) (menyudagi "ko'rganlar" ro'yxati uchun) */
export function reactionsOf(msgId) {
  sync();
  return new Map(byMsg.get(msgId) || []);
}

/** Chat yopilganda */
export function reactReset() { teardown(); cur = null; byMsg.clear(); reactHoverHide(); }
