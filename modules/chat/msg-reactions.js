/* msg-reactions.js — xabarga reaksiya (Telegram uslubida), DM va guruh uchun bir xil.
   - Kontekst menyu tepasida tezkor reaksiyalar qatori + chevron (msg-menu.js shuni chizadi)
   - Chevron bosilsa menyu ichida belgilangan balandlikdagi emoji paneli ochiladi (scroll + qidiruv)
   - Reaksiyalar xabar pufakchasi tagida chip bo'lib ko'rinadi (bosilsa — o'zimning reaksiyam almashadi/olinadi)
   - Saqlash: public.message_reactions (063 SQL), bir foydalanuvchi — bir xabarga bitta reaksiya.
   - Jonli: postgres_changes (thread_id bo'yicha). DOM: paintMessages() dan keyin reactAfterPaint() chiplarni qayta qo'yadi. */
import { sb, state } from '../core/config.js';
import { esc, defAvi } from '../core/utils.js';
import { toast } from '../ui/toast.js';

export const QUICK = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁'];
const TABLE = 'message_reactions';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHEV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

let box = null, cur = null, ch = null, seq = 0, bound = false;
const byMsg = new Map();   // msgId -> Map(uid -> emoji)
const prof = new Map();    // uid -> { name, avatar } (keshda yo'q bo'lsa)
const me = () => state.me?.uid;

function threadNow() {
  const dm = !state.currentChatKind || state.currentChatKind === 'dm';
  const id = dm ? state.currentChatId : document.getElementById('chatThreadModal')?.dataset?.gid;
  return id && UUID_RE.test(String(id)) ? { kind: dm ? 'dm' : 'group', id: String(id) } : null;
}

const put = r => {
  let m = byMsg.get(r.message_id);
  if (!m) byMsg.set(r.message_id, m = new Map());
  m.set(r.user_id, r.emoji);
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
    return `<button type="button" class="mr-chip${mineE === e ? ' mine' : ''}${few ? ' few' : ''}" data-re="${esc(e)}"><span class="mr-e">${esc(e)}</span>${tail}</button>`;
  }).join('');
}

function paintMsg(id, force) {
  if (!box || !id) return;
  const row = box.querySelector(`.chat-msg[data-msg-id="${CSS.escape(String(id))}"]`);
  const bub = row?.querySelector('.chat-bubble');
  if (!bub) return;
  let el = bub.querySelector(':scope > .msg-reacts');
  const m = byMsg.get(id);
  if (!m || !m.size) { el?.remove(); return; }
  const html = chipsHtml(m);
  if (el && !force && el._html === html) return;
  if (!el) { el = document.createElement('div'); el.className = 'msg-reacts'; bub.appendChild(el); }
  el._html = html;
  el.innerHTML = html;
  el.querySelectorAll('.mr-av').forEach(im => im.addEventListener('error', () => { im.onerror = null; im.src = defAvi('U'); }, { once: true }));
}

function paintAll(force) {
  if (!box) return;
  box.querySelectorAll('.chat-msg[data-msg-id]:not([data-msg-id=""])').forEach(r => paintMsg(r.dataset.msgId, force));
}

/* ── Amal ──────────────────────────────────────────────────────────── */
export async function reactToggle(msgId, emoji) {
  sync();
  const t = cur, uid = me();
  if (!t || !uid || !msgId) return;
  const prev = byMsg.get(msgId)?.get(uid);
  const remove = prev === emoji;
  const rollback = () => { if (prev) put({ message_id: msgId, user_id: uid, emoji: prev }); else drop({ message_id: msgId, user_id: uid }); paintMsg(msgId); };
  if (remove) drop({ message_id: msgId, user_id: uid }); else put({ message_id: msgId, user_id: uid, emoji });
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
  return `<div class="mc-react">${QUICK.map(e => `<button type="button" class="mc-r${mine === e ? ' on' : ''}" data-r="${e}" aria-label="${e}">${e}</button>`).join('')}<button type="button" class="mc-r-more" data-rmore aria-label="Ko‘proq reaksiya" aria-expanded="false">${CHEV}</button></div>`;
}

let _pickHtml = null, _all = null, _uz = null;
const btn = e => `<button type="button" class="mc-r" data-r="${e}">${e}</button>`;

/** Kengaytirilgan panel (qidiruv + scrollli emoji ro'yxati). Ma'lumot birinchi marta lazy yuklanadi. */
export async function reactPickerHtml() {
  if (!_pickHtml) {
    const { EMOJI_CATS } = await import('../ui/emoji-data.js');
    _all = EMOJI_CATS.flatMap(c => c.list);
    _pickHtml = EMOJI_CATS.map(c => `<div class="mr-cat">${esc(c.name)}</div><div class="mr-grid">${c.list.map(([e]) => btn(e)).join('')}</div>`).join('');
  }
  return `<div class="mr-pick"><div class="mr-search"><input type="text" placeholder="Qidirish..." autocomplete="off" spellcheck="false" aria-label="Emoji qidirish"></div><div class="mr-scroll">${_pickHtml}</div></div>`;
}

export function reactBindPicker(menuEl) {
  const inp = menuEl.querySelector('.mr-search input'), sc = menuEl.querySelector('.mr-scroll');
  if (!inp || !sc) return;
  inp.addEventListener('input', async () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { sc.innerHTML = _pickHtml; sc.scrollTop = 0; return; }
    if (!_uz) { try { ({ EMOJI_UZ: _uz } = await import('../ui/emoji-uz.js')); } catch (_) { _uz = {}; } }
    if (inp.value.trim().toLowerCase() !== q) return;
    const hit = _all.filter(([e, k]) => k.includes(q) || (_uz[e.replace(/\uFE0F/g, '')] || '').toLowerCase().includes(q)).slice(0, 140);
    sc.innerHTML = hit.length ? `<div class="mr-grid">${hit.map(([e]) => btn(e)).join('')}</div>` : '<div class="mr-none">Topilmadi</div>';
    sc.scrollTop = 0;
  });
  inp.addEventListener('keydown', e => e.stopPropagation());
}

/* ── Hayot sikli ───────────────────────────────────────────────────── */
export function reactInit(boxEl) {
  box = boxEl;
  if (bound || !box) return;
  bound = true;
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
export function reactAfterPaint() { sync(); paintAll(); }

/** Chat yopilganda */
export function reactReset() { teardown(); cur = null; byMsg.clear(); }
