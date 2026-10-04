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
    <svg class="opacity-30 mb-8px" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
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
}

async function fillMyAvi(targetId) {
  const el = $(targetId);
  if (!el || !state.me) return;
  try {
    const { data } = await sb.from('profiles').select('full_name,avatar').eq('id', state.me.uid).maybeSingle();
    const av = data?.avatar || defAvi(data?.full_name || 'U');
    el.innerHTML = `<img class="w-full h-full object-cover brr-50pct" src="${esc(av)}" onerror="this.classList.add('d-none')">`;
  } catch (_) {}
}

/* ── Open: routes mobile → inline, desktop → right rail ───────────────── */
export async function openCmtModal(postId) {
  // Hide old bottom-sheet modal always
  $('cmtModal')?.classList.remove('show');

  if (isDesktopCmt()) {
    await openRailCmt(postId);
  } else {
    await openInlineCmt(postId);
  }
}

/* ── Mobile: inline under post ────────────────────────────────────────── */
async function openInlineCmt(postId) {
  const post = document.querySelector(`.post[data-id="${postId}"]`);
  if (!post) return;

  // Toggle: same post already open → close
  const existing = post.querySelector('.post-cmt-panel');
  if (existing) {
    existing.remove();
    if (state.cmtPostId === postId) {
      state.cmtPostId = null;
      _mode = null;
    }
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
  list.innerHTML = cmts.map(c => `<div class="cmt-row" data-cmt-id="${c.id}">
      <div class="cmt-avi user-avi-btn" data-uid="${c.userId}">
        <img src="${esc(aMap[c.userId])}" onerror="this.style.display='none'">
      </div>
      <div class="cmt-body">
        <div class="cmt-head"><span class="cmt-name">${esc(c.userName)}</span><span class="cmt-time">· ${fmt(c.createdAt)}</span></div>
        <div class="cmt-text">${renderMarkdown(c.text)}</div>
      </div>
      ${(state.me?.uid === c.userId || isAdmin())
        ? `<button class="cmt-del" data-post="${postId}" data-cmt="${c.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/>
            </svg></button>`
        : ''}
    </div>`).join('');

    list.querySelectorAll('.cmt-del').forEach(b => b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        const { error: delErr } = await sb.from('comments').delete().eq('id', b.dataset.cmt);
        if (delErr) throw delErr;
        toast('Izoh o\'chirildi', 'success');
        const _left = cmts.filter(x => String(x.id) !== String(b.dataset.cmt));
        _cmtCache = { postId, listId, cmts: _left, aMap };
        _paintCmts(postId, listId, _left, aMap);
        _cmtCount(postId, _left.length);
        busEmit('cmt', { op: 'del', postId, id: b.dataset.cmt, n: _left.length });
      } catch (e) {
        console.error('Comment delete failed:', e);
        toast('Izohni o\'chirib bo\'lmadi', 'error');
        b.disabled = false;
      }
    }));

    list.querySelectorAll('.user-avi-btn').forEach(b => b.addEventListener('click', async () => {
      if (b.dataset.uid !== state.me?.uid) {
        if (_mode === 'inline') closeAllInline();
        if (_mode === 'rail') closeRailCmt();
        const { openUserProfileModal } = await import('../profile/profile.js');
        openUserProfileModal(b.dataset.uid);
      }
    }));

    list.scrollTop = list.scrollHeight;
}

async function loadComments(postId, listId) {
  if (_loading) return;
  _loading = true;
  _cmtLive(postId, listId);

  const list = $(listId);
  if (!list) { _loading = false; return; }

  try {
    const { data: _cRows, error: _cErr } = await sb.from('comments').select('*')
      .eq('post_id', postId).order('created_at', { ascending: true });
    if (_cErr) throw _cErr;
    const cmts = (_cRows || []).map(r => ({
      id: r.id, userId: r.user_id, userName: r.user_name, text: r.text, createdAt: r.created_at,
    }));

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
    c.cmts = [...c.cmts, o.row];
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

  if (sendBtn) sendBtn.disabled = true;

  try {
    if (!_myName) {
      const { data: ud } = await sb.from('profiles').select('full_name').eq('id', state.me.uid).maybeSingle();
      _myName = ud?.full_name || state.me.displayName || 'Foydalanuvchi';
    }
    const postId = state.cmtPostId;

    const { data: row, error: insErr } = await sb.from('comments').insert({
      post_id:   postId,
      user_id:   state.me.uid,
      user_name: _myName,
      text,
    }).select('*').maybeSingle();
    if (insErr) throw insErr;

    if (inp) { inp.value = ''; inp.style.height = ''; }
    const cnt = $(charId);
    if (cnt) {
      cnt.textContent = '300';
      cnt.className = 'cmt-char-count';
    }

    // Ro'yxatga shu zahoti qo'shamiz (qayta yuklamasdan) va hammaga yuboramiz
    const mine = { id: row?.id ?? ('tmp-' + Date.now()), userId: state.me.uid, userName: _myName, text, createdAt: row?.created_at || new Date().toISOString() };
    if (!(_cmtCache && _cmtCache.postId === postId)) {
      // Ro'yxat hali yuklanmagan — to'liq yuklaymiz (eski yo'l)
      busEmit('cmt', { op: 'add', postId, n: (state.allPosts.find(p => p.id === postId)?.commentCount || 0) + 1, row: mine });
      toast('Izoh qo\'shildi', 'success');
      await loadComments(postId, listId);
      return;
    }
    const base = _cmtCache;
    const av = state._userCache?.[state.me.uid]?.avatar || base.aMap[state.me.uid] || defAvi(_myName);
    const cmts = base.cmts.some(x => String(x.id) === String(mine.id)) ? base.cmts : [...base.cmts, mine];
    _cmtCache = { postId, listId, cmts, aMap: { ...base.aMap, [state.me.uid]: av } };
    _paintCmts(postId, listId, cmts, _cmtCache.aMap);
    _cmtCount(postId, cmts.length);
    busEmit('cmt', { op: 'add', postId, n: cmts.length, avatar: av, row: mine });

    toast('Izoh qo\'shildi', 'success');

  } catch (e) {
    console.error('Comment send failed:', e);
    toast('Izohni yuborib bo\'lmadi', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = !inp?.value?.trim();
  }
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
