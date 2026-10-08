import { sb, state, isAdmin, getMediaUrl, mapProfile } from '../core/config.js';
import { $, esc, renderMarkdown, defAvi, fmtCount, fmt }     from '../core/utils.js';
import { toast }                   from '../ui/toast.js';
import { rateOk }                   from '../core/rate-limit.js';
import { busEmit, busOn }          from '../core/rt-bus.js';

/* ── Duplicate load oldini olish ──────────────────────────────────────── */
let _loading = false;
let _myName = null;
let _mode = null; // 'inline' | 'rail'

function isDesktopCmt() {
  return window.matchMedia('(min-width: 1200px)').matches;
}

/* Yuborish tugmasi: matn bo'sh bo'lsa o'chiq (X kabi 50%) */
function syncSend(inp, btn) {
  if (btn) btn.disabled = !inp?.value?.trim();
}

/* ── Shared: yuklanish spinneri ───────────────────────────────────────── */
function loadingHtml() {
  return '<div class="spin-wrap"><div class="spinner"></div></div>';
}

function emptyHtml() {
  return `<div class="cmt-empty">
    <img src="./svg/extra/icon-838eb192325a.svg" alt="" class="icon opacity-30 mb-8px" width="28" height="28">
    Hali izoh yo'q
  </div>`;
}

/* ── Close any open inline panels ─────────────────────────────────────── */
function closeAllInline() {
  document.querySelectorAll('.post-cmt-panel').forEach(el => el.remove());
}

/* ── Right rail: ensure comments container exists ─────────────────────── */
function ensureRailCmt() {
  const rail = $('rightRail');
  if (!rail) return null;
  let panel = $('rrCmtPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'rrCmtPanel';
    panel.className = 'rr-cmt-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="rr-cmt-hdr">
        <button type="button" class="rr-cmt-back" id="rrCmtBack" title="Orqaga" aria-label="Orqaga">
          <img src="./svg/extra/icon-de6761387092.svg" alt="" class="icon" width="18" height="18">
        </button>
        <span class="rr-cmt-title">Izohlar</span>
      </div>
      <div class="rr-cmt-input-row cmt-input-row">
        <div class="cmt-my-avi" id="rrCmtMyAvi"></div>
        <textarea class="cmt-input" id="rrCmtInput" rows="1" placeholder="Izoh qoldirish..." maxlength="300"></textarea>
        <span class="cmt-char-count" id="rrCmtCharCount">300</span>
        <button class="cmt-send" id="rrCmtSend" type="button" disabled>Yuborish</button>
      </div>
      <div class="rr-cmt-list cmt-modal-list" id="rrCmtList"></div>
    `;
    rail.appendChild(panel);

    $('rrCmtBack')?.addEventListener('click', closeRailCmt);
    $('rrCmtSend')?.addEventListener('click', () => sendComment('rail'));
    $('rrCmtInput')?.addEventListener('input', () => {
      syncSend($('rrCmtInput'), $('rrCmtSend'));
      const len = $('rrCmtInput').value.length;
      const cnt = $('rrCmtCharCount');
      if (!cnt) return;
      cnt.textContent = 300 - len;
      cnt.className = 'cmt-char-count' + (len >= 270 ? (len >= 300 ? ' over' : ' warn') : '');
    });
    $('rrCmtInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendComment('rail');
      }
    });
  }
  return panel;
}

function showRailDefault(show) {
  const rail = $('rightRail');
  if (!rail) return;
  rail.querySelectorAll('.rr-card').forEach(c => {
    c.hidden = !show;
  });
}

function closeRailCmt() {
  const panel = $('rrCmtPanel');
  if (panel) panel.hidden = true;
  showRailDefault(true);
  if (_mode === 'rail') {
    state.cmtPostId = null;
    _mode = null;
  }
  _routeKick();
}

async function fillMyAvi(targetId) {
  const el = $(targetId);
  if (!el || !state.me) return;
  try {
    const { data } = await sb.from('profiles').select('full_name,avatar').eq('id', state.me.uid).maybeSingle();
    if (data?.full_name) _myName = data.full_name;
    const av = data?.avatar || defAvi(data?.full_name || 'U');
    el.innerHTML = `<img class="w-full h-full object-cover brr-50pct" src="${esc(av)}" onerror="this.classList.add('d-none')">`;
  } catch (_) {}
}

/** Shu postning izohlari hozir ochiqmi (inline panel yoki o'ng rail) */
export function isCmtOpen(postId) {
  if (document.querySelector(`.post[data-id="${postId}"] .post-cmt-panel`)) return true;
  const rp = $('rrCmtPanel');
  return state.cmtPostId === postId && _mode === 'rail' && !!rp && !rp.hidden;
}
/* URL (/p/<id>/comments) izohlar ochilishi/yopilishiga moslashsin */
const _routeKick = () => { try { window.dispatchEvent(new Event('spacemr:route')); } catch (_) {} };

/* Bir post bir nechta view'da bo'lishi mumkin (bosh sahifa lentasi yashirin turibdi, Saqlanganlar ochiq).
 * Birinchi topilgani yashirin lentadagi nusxa bo'lib qolmasin — faqat KO'RINIB turganini olamiz. */
function findVisiblePost(postId) {
  const all = document.querySelectorAll(`.post[data-id="${postId}"]`);
  for (const el of all) if (el.getClientRects().length > 0) return el;
  return null;
}

/* Post lentada ko'rinmasa (masalan profil gridi → detail modal) — pastdan chiqadigan eski izohlar oynasi */
async function openSheetCmt(postId) {
  closeAllInline();
  closeRailCmt();
  state.cmtPostId = postId;
  _mode = 'modal';
  const m = $('cmtModal');
  if (!m) return;
  const inp = $('cmtModalInput');
  if (inp) { inp.value = ''; inp.style.height = ''; syncSend(inp, $('cmtModalSend')); }
  const list = $('cmtModalList');
  if (list) list.innerHTML = loadingHtml();
  m.classList.add('show');
  _routeKick();
  await loadComments(postId, 'cmtModalList');
}

/* ── Open: routes mobile → inline, desktop → right rail ───────────────── */
export async function openCmtModal(postId) {
  // Hide old bottom-sheet modal always
  $('cmtModal')?.classList.remove('show');

  // Desktop/right-rail mavjud bo'lsa — rail; aks holda mobile kabi inline (parity)
  if (isDesktopCmt() && document.getElementById('rightRail') && !document.getElementById('rightRail').hidden) {
    await openRailCmt(postId);
  } else {
    await openInlineCmt(postId);
  }
}

/* ── Mobile: inline under post ────────────────────────────────────────── */
async function openInlineCmt(postId) {
  const post = findVisiblePost(postId);
  if (!post) return openSheetCmt(postId);

  // Toggle: same post already open → close
  const existing = post.querySelector('.post-cmt-panel');
  if (existing) {
    existing.remove();
    if (state.cmtPostId === postId) {
      state.cmtPostId = null;
      _mode = null;
    }
    _routeKick();
    return;
  }

  closeAllInline();
  closeRailCmt();

  state.cmtPostId = postId;
  _mode = 'inline';

  const panel = document.createElement('div');
  panel.className = 'post-cmt-panel';
  panel.dataset.postId = postId;
  panel.innerHTML = `
    <div class="post-cmt-input-row cmt-input-row">
      <div class="cmt-my-avi" id="inlineCmtMyAvi"></div>
      <textarea class="cmt-input" id="inlineCmtInput" rows="1" placeholder="Izoh qoldirish..." maxlength="300"></textarea>
      <span class="cmt-char-count" id="inlineCmtCharCount">300</span>
      <button class="cmt-send" id="inlineCmtSend" type="button" disabled>Yuborish</button>
    </div>
    <div class="post-cmt-list" id="inlineCmtList">${loadingHtml()}</div>
  `;

  // Insert after post-actions (inside post-main if present)
  const actions = post.querySelector('.post-actions');
  if (actions && actions.parentNode) {
    actions.insertAdjacentElement('afterend', panel);
  } else {
    post.appendChild(panel);
  }

  fillMyAvi('inlineCmtMyAvi');

  $('inlineCmtSend')?.addEventListener('click', () => sendComment('inline'));
  $('inlineCmtInput')?.addEventListener('input', () => {
    syncSend($('inlineCmtInput'), $('inlineCmtSend'));
    const len = $('inlineCmtInput').value.length;
    const cnt = $('inlineCmtCharCount');
    if (!cnt) return;
    cnt.textContent = 300 - len;
    cnt.className = 'cmt-char-count' + (len >= 270 ? (len >= 300 ? ' over' : ' warn') : '');
  });
  $('inlineCmtInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendComment('inline');
    }
  });

  // Focus input
  setTimeout(() => $('inlineCmtInput')?.focus(), 50);
  _routeKick();

  await loadComments(postId, 'inlineCmtList');
}

/* ── Desktop: right rail ──────────────────────────────────────────────── */
async function openRailCmt(postId) {
  closeAllInline();

  // Toggle same post
  if (_mode === 'rail' && state.cmtPostId === postId) {
    closeRailCmt();
    return;
  }

  state.cmtPostId = postId;
  _mode = 'rail';

  const panel = ensureRailCmt();
  if (!panel) return;

  showRailDefault(false);
  panel.hidden = false;

  const list = $('rrCmtList');
  if (list) list.innerHTML = loadingHtml();

  const inp = $('rrCmtInput');
  if (inp) {
    inp.value = '';
    inp.style.height = '';
    $('rrCmtCharCount').textContent = '300';
    $('rrCmtCharCount').className = 'cmt-char-count';
  }
  syncSend(inp, $('rrCmtSend'));

  fillMyAvi('rrCmtMyAvi');
  setTimeout(() => inp?.focus(), 50);
  _routeKick();

  await loadComments(postId, 'rrCmtList');
}

/* ── Load comments into a list element ────────────────────────────────── */
export async function loadCmtModal(postId) {
  // Back-compat: refresh whichever is open
  if (_mode === 'inline') await loadComments(postId, 'inlineCmtList');
  else if (_mode === 'rail') await loadComments(postId, 'rrCmtList');
  else await loadComments(postId, 'cmtModalList');
}

/* ── Jonli izohlar: ochiq postning izohlari o'zgarsa ro'yxat shu zahoti yangilanadi ── */
let _cmtCh = null, _cmtLivePost = null, _cmtLiveList = null;
function _cmtLive(postId, listId) {
  _cmtLiveList = listId;
  if (_cmtCh && _cmtLivePost === postId) return;
  if (_cmtCh) { try { sb.removeChannel(_cmtCh); } catch (_) {} _cmtCh = null; }
  _cmtLivePost = postId;
  const reload = () => { loadComments(postId, _cmtLiveList); };
  _cmtCh = sb.channel('cmt-live-' + postId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, () => {
      const l = _cmtLiveList && document.getElementById(_cmtLiveList);
      if (!l || !l.isConnected || l.getClientRects().length === 0) {
        // izohlar oynasi yopilgan — kanalni yopamiz
        try { sb.removeChannel(_cmtCh); } catch (_) {}
        _cmtCh = null; _cmtLivePost = null;
        return;
      }
      reload();
    })
    .subscribe();
}

/* Uyg'onish / internet qaytishi: ochiq izohlar qayta yuklanadi */
window.addEventListener('spacemr:resync', () => {
  const l = _cmtLiveList && document.getElementById(_cmtLiveList);
  if (_cmtLivePost && l && l.isConnected && l.getClientRects().length) loadComments(_cmtLivePost, _cmtLiveList);
});

/* ── Izohlar ro'yxatini chizish (keshdan — tarmoqsiz) ───────────────────── */
let _cmtCache = null;   // { postId, listId, cmts, aMap } — ochiq ro'yxatning joriy holati
function _cmtCount(postId, n) {
  const ccSpan = document.getElementById(`cc-${postId}`);
  if (ccSpan) ccSpan.textContent = fmtCount(n);
  const rcc = document.querySelector(`.rcmt-${postId}`);
  if (rcc) rcc.textContent = `${n}`;
  const post = state.allPosts.find(p => p.id === postId);
  if (post) post.commentCount = n;
}
function _paintCmts(postId, listId, cmts, aMap) {
  const list = $(listId);
  if (!list) return;
  if (!cmts.length) { list.innerHTML = emptyHtml(); return; }
  // Qayta chizishdan oldin: foydalanuvchi pastdami yoki yuqorida o'qiyaptimi
  const _hadRows = !!list.querySelector('.cmt-row');
  const _prevTop = list.scrollTop;
  const _wasBottom = !_hadRows || (list.scrollHeight - list.scrollTop - list.clientHeight < 60);
  list.innerHTML = cmts.map(c => `<div class="cmt-row" data-cmt-id="${c.id}">
      <div class="cmt-avi user-avi-btn" data-uid="${c.userId}">
        <img src="${esc(aMap[c.userId])}" onerror="this.style.display='none'">
      </div>
      <div class="cmt-body">
        <div class="cmt-head"><span class="cmt-name">${esc(c.userName)}</span><span class="cmt-time">· ${fmt(c.createdAt)}</span></div>
        <div class="cmt-text">${renderMarkdown(c.text)}</div>
      </div>
      <button class="cmt-del cmt-more" data-cmt="${c.id}" data-can-del="${(state.me?.uid === c.userId || isAdmin()) ? '1' : ''}" title="Yana" aria-label="Yana" aria-haspopup="menu">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
    </div>`).join('');

    const deleteCmt = async (cmtId) => {
      try {
        const { data: _delRows, error: delErr } = await sb.from('comments').delete().eq('id', cmtId).select('id');
        if (delErr) throw delErr;
        if (!(_delRows || []).length) throw new Error('0 qator o\'chirildi (RLS)');   // jim rad etilsa izoh qayta chiqib qolardi
        toast('Izoh o\'chirildi', 'success');
        const _left = cmts.filter(x => String(x.id) !== String(cmtId));
        _cmtCache = { postId, listId, cmts: _left, aMap };
        _paintCmts(postId, listId, _left, aMap);
        _cmtCount(postId, _left.length);
        busEmit('cmt', { op: 'del', postId, id: cmtId, n: _left.length });
      } catch (e) {
        console.error('Comment delete failed:', e);
        toast('Izohni o\'chirib bo\'lmadi', 'error');
      }
    };

    list.querySelectorAll('.cmt-more').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const c = cmts.find(x => String(x.id) === b.dataset.cmt);
      if (!c) return;
      const { showMenu, copyText, copyCommentLink } = await import('./feed.js');
      const items = [
        { label: 'Matnni nusxalash', run: () => copyText(c.text) },
        { label: 'Izoh havolasini nusxalash', run: () => copyCommentLink(postId, c.id) },
      ];
      if (b.dataset.canDel) items.push({ label: 'Izohni o\'chirish', danger: true, run: () => deleteCmt(c.id) });
      showMenu(b, items);
    }));

    list.querySelectorAll('.user-avi-btn').forEach(b => b.addEventListener('click', async () => {
      if (b.dataset.uid) {
        if (_mode === 'inline') closeAllInline();
        if (_mode === 'rail') closeRailCmt();
        const { openUserProfileModal } = await import('../profile/profile.js');
        openUserProfileModal(b.dataset.uid);
      }
    }));

    // Eng yangi yuqorida: tepada bo'lsa tepada qoladi; pastga o'qiyotgan joyini saqlaydi
    const _wasTop = !_hadRows || _prevTop < 48;
    list.scrollTop = _wasTop ? 0 : _prevTop;
}

async function loadComments(postId, listId) {
  if (_loading) return;
  _loading = true;
  _cmtLive(postId, listId);

  const list = $(listId);
  if (!list) { _loading = false; return; }

  try {
    const { data: _cRows, error: _cErr } = await sb.from('comments').select('*')
      .eq('post_id', postId).order('created_at', { ascending: false });
    if (_cErr) throw _cErr;
    const cmts = (_cRows || []).map(r => ({
      id: r.id, userId: r.user_id, userName: r.user_name, text: r.text, createdAt: r.created_at,
    }));

    for (const pc of _pendingCmts.values()) {
      if (pc.postId === postId && !cmts.some(x => String(x.id) === String(pc.row.id))) cmts.unshift(pc.row);
    }

    const ccSpanFeed = document.getElementById(`cc-${postId}`);
    if (ccSpanFeed) ccSpanFeed.textContent = fmtCount(cmts.length);

    const post = state.allPosts.find(p => p.id === postId);
    if (post) post.commentCount = cmts.length;

    if (!cmts.length) {
      list.innerHTML = emptyHtml();
      return;
    }

    const uids = [...new Set(cmts.map(c => c.userId))];
    const { data: _uRows } = await sb.from('profiles').select('id,full_name,avatar').in('id', uids);
    const _uById = new Map((_uRows || []).map(r => [r.id, mapProfile(r)]));
    const aMap = {};
    uids.forEach(u => {
      const d = _uById.get(u) || {};
      aMap[u] = d.avatar || defAvi(d.fullName);
    });

    _cmtCache = { postId, listId, cmts, aMap };
    _paintCmts(postId, listId, cmts, aMap);

  } catch (e) {
    console.error('Izohlar load failed:', e);
    list.innerHTML = `<div class="cmt-empty">Izohlar yuklanmadi. Qayta urinib ko'ring.</div>`;
  } finally {
    _loading = false;
  }
}

/* ── Tezkor shina: boshqa foydalanuvchining izohi ro'yxatga shu zahoti qo'shiladi ── */
busOn('cmt', o => {
  const c = _cmtCache;
  if (!c || c.postId !== o.postId) return;
  const l = $(c.listId);
  if (!l || !l.isConnected || l.getClientRects().length === 0) return;
  if (o.op === 'add' && o.row?.id) {
    if (c.cmts.some(x => String(x.id) === String(o.row.id))) return;
    c.cmts = [o.row, ...c.cmts];
    if (o.avatar) c.aMap = { ...c.aMap, [o.row.userId]: o.avatar };
    else if (!c.aMap[o.row.userId]) c.aMap = { ...c.aMap, [o.row.userId]: defAvi(o.row.userName) };
  } else if (o.op === 'del') {
    c.cmts = c.cmts.filter(x => String(x.id) !== String(o.id));
  } else return;
  _paintCmts(c.postId, c.listId, c.cmts, c.aMap);
  _cmtCount(c.postId, c.cmts.length);
});

/* ── Send comment ─────────────────────────────────────────────────────── */
export async function sendCmtModal() {
  // Back-compat for old modal send
  return sendComment(_mode || 'modal');
}

/* Yuborilmoqda turgan izohlar (server tasdiqlamaguncha ro'yxatda ko'rinib turadi) */
const _pendingCmts = new Map(); // id -> { postId, row }

function _uuid4() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function _dropPending(id, postId, listId) {
  _pendingCmts.delete(id);
  const c = _cmtCache;
  if (c && c.postId === postId) {
    c.cmts = c.cmts.filter(x => String(x.id) !== String(id));
    if ($(listId)) _paintCmts(postId, c.listId, c.cmts, c.aMap);
    _cmtCount(postId, c.cmts.length);
  }
}

async function sendComment(mode) {
  let inp, sendBtn, listId, charId;
  if (mode === 'inline') {
    inp = $('inlineCmtInput');
    sendBtn = $('inlineCmtSend');
    listId = 'inlineCmtList';
    charId = 'inlineCmtCharCount';
  } else if (mode === 'rail') {
    inp = $('rrCmtInput');
    sendBtn = $('rrCmtSend');
    listId = 'rrCmtList';
    charId = 'rrCmtCharCount';
  } else {
    inp = $('cmtModalInput');
    sendBtn = $('cmtModalSend');
    listId = 'cmtModalList';
    charId = 'cmtCharCount';
  }

  const text = inp?.value?.trim();
  if (!text || !state.cmtPostId || !state.me) return;
  if (!rateOk('cmt', 10, 60000)) return;

  const postId = state.cmtPostId;
  const uid = state.me.uid;
  const name = _myName || state.me.displayName || 'Foydalanuvchi';
  const id = _uuid4();                      // id mijozda yaratiladi — server qaytargan qator bilan bir xil
  const mine = { id, userId: uid, userName: name, text, createdAt: new Date().toISOString() };
  _pendingCmts.set(id, { postId, row: mine });

  /* 1) UI — shu zahoti (tarmoq kutilmaydi): input tozalanadi, izoh ro'yxatga tushadi, muvaffaqiyat xabari */
  if (inp) { inp.value = ''; inp.style.height = ''; }
  const cnt = $(charId);
  if (cnt) { cnt.textContent = '300'; cnt.className = 'cmt-char-count'; }
  if (sendBtn) sendBtn.disabled = true;

  let av = state._userCache?.[uid]?.avatar || defAvi(name);
  const base = (_cmtCache && _cmtCache.postId === postId) ? _cmtCache : null;
  if (base) {
    av = state._userCache?.[uid]?.avatar || base.aMap[uid] || av;
    const cmts = [mine, ...base.cmts];  // eng yangi yuqorida
    _cmtCache = { postId, listId, cmts, aMap: { ...base.aMap, [uid]: av } };
    _paintCmts(postId, listId, cmts, _cmtCache.aMap);
    _cmtCount(postId, cmts.length);
  } else {
    _cmtCount(postId, (state.allPosts.find(p => p.id === postId)?.commentCount || 0) + 1);
  }
  toast('Izoh qo\'shildi', 'success');

  /* 2) Orqa fonda yuboriladi; muvaffaqiyatda boshqalarga ham tarqatiladi, xato bo'lsa qaytariladi */
  (async () => {
    try {
      const { error } = await sb.from('comments').insert({ id, post_id: postId, user_id: uid, user_name: name, text });
      if (error) throw error;
      _pendingCmts.delete(id);
      const n = (_cmtCache && _cmtCache.postId === postId) ? _cmtCache.cmts.length
        : (state.allPosts.find(p => p.id === postId)?.commentCount || 0);
      busEmit('cmt', { op: 'add', postId, n, avatar: av, row: mine });
      if (!base && $(listId)) loadComments(postId, listId);
    } catch (e) {
      console.error('Comment send failed:', e);
      _dropPending(id, postId, listId);
      const again = $(listId === 'inlineCmtList' ? 'inlineCmtInput' : listId === 'rrCmtList' ? 'rrCmtInput' : 'cmtModalInput');
      if (again && !again.value) { again.value = text; syncSend(again, sendBtn); }
      toast('Izohni yuborib bo\'lmadi — matn qaytarildi', 'error');
    }
  })();
}

/* ── Izoh textarea: matn bo'yicha balandligi o'sadi ───────────────────── */
document.addEventListener('input', e => {
  const t = e.target;
  if (!t || t.tagName !== 'TEXTAREA' || !t.classList.contains('cmt-input')) return;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
});

/* ── Legacy modal listeners (fallback, rarely used) ───────────────────── */
if ($('cmtModalSend')) $('cmtModalSend').onclick = () => sendComment('modal');
if ($('cmtModalInput')) {
  $('cmtModalInput').addEventListener('input', () => {
    const len = $('cmtModalInput').value.length;
    const cnt = $('cmtCharCount');
    if (!cnt) return;
    cnt.textContent = 300 - len;
    cnt.className = 'cmt-char-count' + (len >= 270 ? (len >= 300 ? ' over' : ' warn') : '');
  });
}
if ($('cmtModalClose')) $('cmtModalClose').onclick = () => $('cmtModal')?.classList.remove('show');
if ($('cmtModal')) {
  $('cmtModal').addEventListener('click', e => {
    if (e.target === $('cmtModal')) $('cmtModal').classList.remove('show');
  });
}

// Resize: if switching breakpoints while open, re-route
window.addEventListener('resize', () => {
  if (!state.cmtPostId || !_mode) return;
  const wantRail = isDesktopCmt();
  if (wantRail && _mode === 'inline') {
    const id = state.cmtPostId;
    closeAllInline();
    openRailCmt(id);
  } else if (!wantRail && _mode === 'rail') {
    const id = state.cmtPostId;
    closeRailCmt();
    openInlineCmt(id);
  }
});
