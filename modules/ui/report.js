/** Shikoyat — SpaceMR guruhiga yuboriladi. Dark (#000) modal. */
import { sb, state } from '../core/config.js';
import { toast } from './toast.js';

/** SpaceMR dagi haqiqiy shikoyat turlari (reklama yo'q — platformada reklama yo'q) */
const REASONS = [
  { id: 'abuse',   label: 'Haqorat yoki tahdid' },
  { id: 'fake',    label: 'Soxta hisob yoki o\'g\'irlash' },
  { id: 'nsfw',    label: 'Nomunosib kontent' },
  { id: 'spam',    label: 'Spam / keraksiz xabar' },
  { id: 'privacy', label: 'Maxfiylik buzilishi' },
  { id: 'rules',   label: 'Qoida buzish' },
  { id: 'bug',     label: 'Xato / nosozlik' },
  { id: 'other',   label: 'Boshqa' },
];

const KINDS = [
  { id: 'other', label: 'Umumiy muammo' },
  { id: 'user',  label: 'Foydalanuvchi' },
  { id: 'post',  label: 'Post' },
  { id: 'group', label: 'Guruh' },
];

let _ctx = null;
let _kindLocked = false; // post/user menyudan ochilganda tur o'zgarmaydi

function _esc(s) {
  return String(s || '')
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}

function _ensureDom() {
  let el = document.getElementById('reportSheet');
  // Eski native <select> versiyasi — yangilab qayta chizamiz
  if (el && !el.querySelector('#reportKindBtn')) {
    el.remove();
    el = null;
  }
  if (el) return el;

  el = document.createElement('div');
  el.id = 'reportSheet';
  el.className = 'report-sheet';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="report-sheet-backdrop" data-report-close></div>
    <div class="report-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
      <div class="report-sheet-hdr">
        <h2 id="reportTitle">Shikoyat</h2>
        <button type="button" class="report-sheet-x" data-report-close aria-label="Yopish">
          <img src="./svg/action/close.svg" alt="" class="icon" width="18" height="18">
        </button>
      </div>
      <p class="report-sheet-lead">Muammo haqida yozing — xabar <strong>SpaceMR</strong> guruhiga yuboriladi.</p>

      <div class="report-kind-lbl" id="reportKindLbl">Shikoyat turi</div>
      <div class="report-kind-wrap" id="reportKindWrap">
        <button type="button" class="report-kind-btn" id="reportKindBtn"
          aria-haspopup="listbox" aria-expanded="false" aria-labelledby="reportKindLbl">
          <span class="report-kind-val" id="reportKindVal">Umumiy muammo</span>
          <span class="report-kind-chev" aria-hidden="true">▾</span>
        </button>
        <ul class="report-kind-menu" id="reportKindMenu" role="listbox" hidden>
          ${KINDS.map(k => `<li role="option" class="report-kind-opt" data-kind="${k.id}" tabindex="-1">${_esc(k.label)}</li>`).join('')}
        </ul>
        <input type="hidden" id="reportKind" value="other">
      </div>

      <div class="report-target" id="reportTarget" hidden></div>

      <div class="report-sec-lbl">Sabab</div>
      <div class="report-reasons" id="reportReasons" role="listbox" aria-label="Sabab"></div>

      <label class="report-note-lbl" for="reportNote">Qo'shimcha (ixtiyoriy)</label>
      <textarea id="reportNote" class="report-note" rows="3" maxlength="500"
        placeholder="Qisqa izoh, vaqt, skrinshot haqida..."></textarea>

      <button type="button" class="report-submit" id="reportSubmit">SpaceMR guruhiga yuborish</button>
      <p class="report-foot">Shikoyatlar faqat SpaceMR guruhi orqali ko'rib chiqiladi.</p>
    </div>`;
  document.body.appendChild(el);

  const reasons = el.querySelector('#reportReasons');
  REASONS.forEach(r => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'report-reason';
    b.dataset.reason = r.id;
    b.textContent = r.label;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    b.addEventListener('click', () => {
      reasons.querySelectorAll('.report-reason').forEach(x => {
        x.classList.remove('is-on');
        x.setAttribute('aria-selected', 'false');
      });
      b.classList.add('is-on');
      b.setAttribute('aria-selected', 'true');
      el.querySelector('#reportSubmit')?.removeAttribute('disabled');
    });
    reasons.appendChild(b);
  });

  _bindKindDropdown(el);

  el.addEventListener('click', e => {
    if (e.target.closest('[data-report-close]')) closeReportPage();
  });
  el.querySelector('#reportSubmit')?.addEventListener('click', _submit);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.classList.contains('is-open')) {
      e.preventDefault();
      closeReportPage();
    }
  });

  return el;
}


function _kindLabel(id) {
  return KINDS.find(k => k.id === id)?.label || 'Umumiy muammo';
}

function _setKind(el, kind, { silent } = {}) {
  const id = kind || 'other';
  const hidden = el.querySelector('#reportKind');
  const val = el.querySelector('#reportKindVal');
  const menu = el.querySelector('#reportKindMenu');
  if (hidden) hidden.value = id;
  if (val) val.textContent = _kindLabel(id);
  menu?.querySelectorAll('.report-kind-opt').forEach(o => {
    const on = o.dataset.kind === id;
    o.classList.toggle('is-on', on);
    o.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (!silent) {
    if (!_ctx) _ctx = { kind: id };
    else _ctx.kind = id;
    _paintTarget(el);
  }
}

function _closeKindMenu(el) {
  const wrap = el.querySelector('#reportKindWrap');
  const btn = el.querySelector('#reportKindBtn');
  const menu = el.querySelector('#reportKindMenu');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
  wrap?.classList.remove('is-open');
}

function _openKindMenu(el) {
  if (_kindLocked) return;
  const wrap = el.querySelector('#reportKindWrap');
  const btn = el.querySelector('#reportKindBtn');
  const menu = el.querySelector('#reportKindMenu');
  if (!menu) return;
  menu.hidden = false;
  if (btn) btn.setAttribute('aria-expanded', 'true');
  wrap?.classList.add('is-open');
}

function _bindKindDropdown(el) {
  if (el._kindBound) return;
  el._kindBound = true;
  const btn = el.querySelector('#reportKindBtn');
  const menu = el.querySelector('#reportKindMenu');
  const wrap = el.querySelector('#reportKindWrap');

  btn?.addEventListener('click', e => {
    e.stopPropagation();
    if (_kindLocked) return;
    if (menu?.hidden) _openKindMenu(el);
    else _closeKindMenu(el);
  });

  menu?.addEventListener('click', e => {
    const opt = e.target.closest('.report-kind-opt');
    if (!opt || _kindLocked) return;
    e.stopPropagation();
    _setKind(el, opt.dataset.kind);
    _closeKindMenu(el);
  });

  // panel ichida boshqa joy / backdrop
  el.addEventListener('click', e => {
    if (!wrap?.contains(e.target)) _closeKindMenu(el);
  });
}

function _paintTarget(el) {
  const box = el.querySelector('#reportTarget');
  if (!box) return;
  const html = _targetHtml(_ctx);
  if (html) {
    box.innerHTML = html;
    box.hidden = false;
  } else {
    box.innerHTML = '';
    box.hidden = true;
  }
}

function _targetHtml(ctx) {
  if (!ctx) return '';
  if (ctx.kind === 'post') {
    const preview = (ctx.text || '').trim().slice(0, 100);
    return `<div class="report-target-inner">
      <div class="report-target-k">Post</div>
      ${ctx.id ? `<code>${_esc(String(ctx.id).slice(0, 16))}</code>` : ''}
      ${preview ? `<div class="report-prev">${_esc(preview)}</div>` : ''}
    </div>`;
  }
  if (ctx.kind === 'user') {
    return `<div class="report-target-inner">
      <div class="report-target-k">Foydalanuvchi</div>
      ${ctx.name ? `<span>${_esc(ctx.name)}</span>` : ''}
      ${ctx.username ? `<span class="report-at">@${_esc(ctx.username)}</span>` : ''}
    </div>`;
  }
  if (ctx.kind === 'group') {
    return `<div class="report-target-inner">
      <div class="report-target-k">Guruh</div>
      ${ctx.name ? `<span>${_esc(ctx.name)}</span>` : ''}
    </div>`;
  }
  return '';
}

function _origin() {
  try { return location.origin || ''; } catch (_) { return ''; }
}

function _buildMessage(ctx, reasonId, note) {
  const reason = REASONS.find(r => r.id === reasonId)?.label || reasonId || '-';
  const kindLabel = KINDS.find(k => k.id === (ctx?.kind || 'other'))?.label || 'Umumiy';
  const origin = _origin();
  const lines = ['**[Shikoyat]**'];
  lines.push('**Turi:** ' + kindLabel);
  if (ctx?.kind === 'post') {
    if (ctx.id) {
      const url = origin + '/p/' + encodeURIComponent(ctx.id);
      lines.push('**Post:** [Ochish](' + url + ')');
      lines.push(url);
    }
    if (ctx.username) lines.push('**Muallif:** @' + ctx.username);
    else if (ctx.uid) lines.push('**Muallif:** `' + ctx.uid + '`');
    if (ctx.text) lines.push('**Matn:** ' + String(ctx.text).slice(0, 120));
  } else if (ctx?.kind === 'user') {
    if (ctx.username) {
      lines.push('**Foydalanuvchi:** @' + ctx.username);
      if (origin) lines.push(origin + '/u/' + encodeURIComponent(ctx.username));
    }
    if (ctx.name) lines.push('**Ism:** ' + ctx.name);
    if (ctx.uid) lines.push('**UID:** `' + ctx.uid + '`');
  } else if (ctx?.kind === 'group' && ctx.name) {
    lines.push('**Guruh:** ' + ctx.name);
  }
  lines.push('**Sabab:** ' + reason);
  if (note) lines.push('**Izoh:** ' + note);
  if (state.me?.uid) {
    lines.push('**Yuboruvchi:** ' + (state.me.username ? '@' + state.me.username : '`' + state.me.uid + '`'));
  }
  return lines.join('\n');
}

async function _submit() {
  const el = document.getElementById('reportSheet');
  if (!el) return;
  const reasonBtn = el.querySelector('.report-reason.is-on');
  if (!reasonBtn) {
    toast('Sababni tanlang', 'error');
    el.querySelector('.report-reasons')?.classList.add('report-reasons--need');
    setTimeout(() => el.querySelector('.report-reasons')?.classList.remove('report-reasons--need'), 1200);
    return;
  }
  const note = (el.querySelector('#reportNote')?.value || '').trim();
  const kindHidden = el.querySelector('#reportKind');
  if (_ctx && kindHidden && !_kindLocked) _ctx.kind = kindHidden.value || _ctx.kind;
  const msg = _buildMessage(_ctx, reasonBtn.dataset.reason, note);

  const btn = el.querySelector('#reportSubmit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Yuborilmoqda…';
  }

  try {
    localStorage.setItem('spacemr_report_draft', msg);
  } catch (_) {}

  try {
    if (state.me?.uid) {
      await sb.from('content_reports').insert({
        reporter_id: state.me.uid,
        target_type: _ctx?.kind || 'other',
        target_id: _ctx?.id || null,
        target_uid: _ctx?.uid || null,
        reason: reasonBtn.dataset.reason || 'other',
        note: note || null,
      });
    }
  } catch (_) {}

  closeReportPage();

  try {
    await import('../url-router.js').then(m => m.applyPath('/chats/g/spacemr'));
  } catch (_) {
    location.hash = '#/chats/g/spacemr';
  }

  const tryFill = (n) => {
    const inp = document.getElementById('chatThreadInput');
    if (inp) {
      inp.value = msg;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      try { inp.focus({ preventScroll: true }); } catch (_) {}
      return;
    }
    if (n < 25) setTimeout(() => tryFill(n + 1), 120);
  };
  setTimeout(() => tryFill(0), 350);
  toast('Matn tayyor — SpaceMR guruhiga yuboring', 'info');
}

/**
 * @param {{ kind?: 'post'|'user'|'other'|'group', id?: string, uid?: string, text?: string, name?: string, username?: string }} ctx
 */
export function openReportPage(ctx = {}) {
  const kind = ctx.kind || 'other';
  _kindLocked = !!(ctx.kind && ctx.kind !== 'other' && (ctx.id || ctx.uid || ctx.name));
  _ctx = {
    kind,
    id: ctx.id || null,
    uid: ctx.uid || null,
    text: ctx.text || null,
    name: ctx.name || null,
    username: ctx.username || null,
  };

  const el = _ensureDom();
  const kindId = KINDS.some(k => k.id === _ctx.kind) ? _ctx.kind : 'other';
  _setKind(el, kindId, { silent: true });
  const wrap = el.querySelector('#reportKindWrap');
  const btn = el.querySelector('#reportKindBtn');
  wrap?.classList.toggle('is-locked', _kindLocked);
  if (btn) {
    btn.disabled = _kindLocked;
    btn.setAttribute('aria-disabled', _kindLocked ? 'true' : 'false');
  }
  _closeKindMenu(el);
  _paintTarget(el);
  el.querySelector('#reportNote').value = '';
  el.querySelectorAll('.report-reason').forEach(b => {
    b.classList.remove('is-on');
    b.setAttribute('aria-selected', 'false');
  });
  const sub = el.querySelector('#reportSubmit');
  if (sub) {
    sub.disabled = false;
    sub.textContent = 'SpaceMR guruhiga yuborish';
  }
  el.classList.add('is-open');
  el.setAttribute('aria-hidden', 'false');
  document.body.classList.add('report-open');
  // URL /report (tab kabi, float emas)
  if (!ctx.fromUrl) {
    try {
      if (location.pathname.replace(/\/+$/, '') !== '/report') {
        history.pushState({ i: (history.state?.i || 0) + 1, prev: location.pathname }, '', '/report');
      }
    } catch (_) {}
  }
  try { window.dispatchEvent(new CustomEvent('spacemr:route')); } catch (_) {}
  setTimeout(() => {
    try { el.querySelector('.report-reason')?.focus({ preventScroll: true }); } catch (_) {}
  }, 50);
}

export function closeReportPage() {
  const el = document.getElementById('reportSheet');
  if (!el) return;
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('report-open');
  _ctx = null;
  _kindLocked = false;
  try {
    if (location.pathname.replace(/\/+$/, '') === '/report' || location.pathname.replace(/\/+$/, '') === '/shikoyat') {
      const prev = history.state?.prev;
      if (prev && prev !== '/report') history.pushState({ i: (history.state?.i || 0) + 1, prev: null }, '', prev);
      else history.pushState({ i: (history.state?.i || 0) + 1, prev: null }, '', '/home');
    }
  } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('spacemr:route')); } catch (_) {}
}

window._openReportPage = openReportPage;
