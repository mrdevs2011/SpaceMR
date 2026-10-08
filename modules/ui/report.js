/** Shikoyat sahifasi (ROADMAP 7) — post/profil/umumiy.
 *  Yuborish: matn tayyorlanadi va SpaceMR guruhiga o'tiladi (alohida backend forma yo'q). */
import { sb, state } from '../core/config.js';
import { toast } from './toast.js';

const REASONS = [
  { id: 'spam', label: 'Spam yoki reklama' },
  { id: 'abuse', label: 'Haqorat yoki tahdid' },
  { id: 'fake', label: 'Soxta yoki aldov' },
  { id: 'nsfw', label: 'Nomunosib kontent' },
  { id: 'other', label: 'Boshqa' },
];

let _ctx = null; // { kind: 'post'|'user'|'other', id?, uid?, text? }

function _ensureDom() {
  let el = document.getElementById('reportSheet');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'reportSheet';
  el.className = 'report-sheet';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="report-sheet-backdrop" data-report-close></div>
    <div class="report-sheet-panel" role="dialog" aria-labelledby="reportTitle">
      <div class="report-sheet-hdr">
        <h2 id="reportTitle">Shikoyat</h2>
        <button type="button" class="report-sheet-x" data-report-close aria-label="Yopish">✕</button>
      </div>
      <p class="report-sheet-lead" id="reportLead">Muammo haqida yozing — xabar SpaceMR guruhiga yuboriladi.</p>
      <div class="report-target" id="reportTarget"></div>
      <div class="report-reasons" id="reportReasons" role="listbox" aria-label="Sabab"></div>
      <label class="report-note-lbl" for="reportNote">Qo'shimcha (ixtiyoriy)</label>
      <textarea id="reportNote" class="report-note" rows="3" maxlength="500" placeholder="Qisqa izoh yoki skrinshot haqida..."></textarea>
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
    b.addEventListener('click', () => {
      reasons.querySelectorAll('.report-reason').forEach(x => x.classList.remove('is-on'));
      b.classList.add('is-on');
    });
    reasons.appendChild(b);
  });

  el.addEventListener('click', e => {
    if (e.target.closest('[data-report-close]')) closeReportPage();
  });
  el.querySelector('#reportSubmit')?.addEventListener('click', _submit);
  return el;
}

function _targetHtml(ctx) {
  if (!ctx) return '';
  if (ctx.kind === 'post') {
    const preview = (ctx.text || '').trim().slice(0, 80);
    return `<div class="report-target-inner"><strong>Post</strong>${ctx.id ? ` · <code>${_esc(String(ctx.id).slice(0, 12))}</code>` : ''}${preview ? `<div class="report-prev">${_esc(preview)}</div>` : ''}</div>`;
  }
  if (ctx.kind === 'user') {
    return `<div class="report-target-inner"><strong>Foydalanuvchi</strong>${ctx.name ? ` · ${_esc(ctx.name)}` : ''}${ctx.username ? ` · @${_esc(ctx.username)}` : ''}</div>`;
  }
  return `<div class="report-target-inner"><strong>Umumiy muammo</strong></div>`;
}

function _esc(s) {
  return String(s || '').replace(/&/g, '&' + 'amp;').replace(/</g, '&' + 'lt;').replace(/>/g, '&' + 'gt;').replace(/"/g, '&' + 'quot;');
}

function _buildMessage(ctx, reasonId, note) {
  /* SpaceMR renderMarkdown bilan ishlaydigan oddiy markdown — alohida parser yo'q */
  const reason = REASONS.find(r => r.id === reasonId)?.label || reasonId || '—';
  const lines = ['**[Shikoyat]**'];
  if (ctx?.kind === 'post') {
    lines.push('**Turi:** post');
    if (ctx.id) lines.push('**Post ID:** `' + ctx.id + '`');
    if (ctx.uid) lines.push('**Muallif UID:** `' + ctx.uid + '`');
    if (ctx.text) lines.push('**Matn:** ' + String(ctx.text).slice(0, 120));
  } else if (ctx?.kind === 'user') {
    lines.push('**Turi:** foydalanuvchi');
    if (ctx.uid) lines.push('**UID:** `' + ctx.uid + '`');
    if (ctx.username) lines.push('@' + ctx.username);
    if (ctx.name) lines.push('**Ism:** ' + ctx.name);
  } else {
    lines.push('**Turi:** umumiy');
  }
  lines.push('**Sabab:** ' + reason);
  if (note) lines.push('**Izoh:** ' + note);
  if (state.me?.uid) lines.push('**Yuboruvchi:** ' + (state.me.username ? '@' + state.me.username : '`' + state.me.uid + '`'));
  return lines.join('\n');
}

async function _submit() {
  const el = document.getElementById('reportSheet');
  if (!el) return;
  const reasonBtn = el.querySelector('.report-reason.is-on');
  if (!reasonBtn) {
    toast('Sababni tanlang', 'error');
    return;
  }
  const note = (el.querySelector('#reportNote')?.value || '').trim();
  const msg = _buildMessage(_ctx, reasonBtn.dataset.reason, note);

  try {
    localStorage.setItem('spacemr_report_draft', msg);
  } catch (_) {}

  // Serverga yozish (content_reports) — muvaffaqiyatsiz bo'lsa ham guruhga o'tamiz
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

  // Chat inputga matnni qo'yish (guruh ochilgach)
  const tryFill = (n) => {
    const inp = document.getElementById('chatThreadInput');
    if (inp) {
      inp.value = msg;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      try { inp.focus({ preventScroll: true }); } catch (_) {}
      return;
    }
    if (n < 20) setTimeout(() => tryFill(n + 1), 150);
  };
  setTimeout(() => tryFill(0), 400);
  toast('SpaceMR guruhiga yozing — matn tayyor', 'info');
}

/**
 * @param {{ kind?: 'post'|'user'|'other', id?: string, uid?: string, text?: string, name?: string, username?: string }} ctx
 */
export function openReportPage(ctx = {}) {
  _ctx = {
    kind: ctx.kind || 'other',
    id: ctx.id || null,
    uid: ctx.uid || null,
    text: ctx.text || null,
    name: ctx.name || null,
    username: ctx.username || null,
  };
  const el = _ensureDom();
  el.querySelector('#reportTarget').innerHTML = _targetHtml(_ctx);
  el.querySelector('#reportNote').value = '';
  el.querySelectorAll('.report-reason').forEach(b => b.classList.remove('is-on'));
  el.classList.add('is-open');
  el.setAttribute('aria-hidden', 'false');
  document.body.classList.add('report-open');
}

export function closeReportPage() {
  const el = document.getElementById('reportSheet');
  if (!el) return;
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('report-open');
  _ctx = null;
}

window._openReportPage = openReportPage;
