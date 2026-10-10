/**
 * Ilovalar (/apps) — foydalanuvchilar yuklagan HTML ilovalar + kategoriyalar.
 *   /apps                  hamma kategoriya va ilovalar
 *   /apps/<kategoriya>     kategoriya sahifasi
 *   /apps/<kategoriya>/<ilova>   ilovani ishga tushirish (sandbox: modules/apps/runner.js)
 * Hamma (tasdiqlangan) foydalanuvchi ko'radi va ishlatadi; tahrirlash/o'chirish faqat egasi (yoki admin).
 */
import { sb, state } from '../core/config.js';
import { esc, showConfirm } from '../core/utils.js';
import { runApp } from './runner.js';
import { extractLogo } from './logo-extract.js';
import { highlight } from './code-hl.js';
import { toast } from '../ui/toast.js';
import { safeLogo, pickRandom, appPath, appCard, launchTile, chips, grouped, railHtml, mobileHome, tabletHome } from './panels.js';

const $ = id => document.getElementById(id);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const RESERVED = ['new', 'edit', 'mine', 'all', 'create', 'categories', 'category', 'admin', 'api', 'apps'];
const LIST_COLS = 'id,slug,name,description,category_id,owner_id,logo,created_at,updated_at';

let cats = [], apps = [], owners = new Map();
let loaded = false, loadErr = '', loading = null;
let bound = false, query = '';
let runner = null, runnerId = '';   // { destroy, reload }, ishga tushgan ilova id si

const isAdmin = () => !!state.me?.isAdmin;
const canEdit = ownerId => !!state.me && (ownerId === state.me.uid || isAdmin());   // yaratgan odam yoki admin
const ownerName = id => (owners.get(id) || {}).username || '';
const catById = id => cats.find(c => c.id === id);
const ico = (p, s = 20) => `<img src="./svg/${p}.svg" alt="" class="icon" width="${s}" height="${s}">`;
const logoHtml = (a, cls) => {
  const l = safeLogo(a.logo);
  return `<span class="${cls}">${l ? `<img src="${l}" alt="">` : `<span class="apc-logo-ph">${esc((a.name || '?')[0].toUpperCase())}</span>`}</span>`;
};

/* ── Ma'lumot ───────────────────────────────────────────────────────── */

async function load(force = false) {
  if (loaded && !force) return;
  if (loading) return loading;
  loading = (async () => {
    loadErr = '';
    try {
      const [c, a] = await Promise.all([
        sb.from('app_categories').select('id,slug,name,owner_id,created_at').order('name').limit(500),
        sb.from('apps').select(LIST_COLS).order('updated_at', { ascending: false }).limit(1000),
      ]);
      if (c.error) throw c.error;
      if (a.error) throw a.error;
      cats = c.data || []; apps = a.data || [];
      const ids = [...new Set([...cats, ...apps].map(x => x.owner_id).filter(Boolean))];
      owners = new Map();
      if (ids.length) {
        const { data } = await sb.from('profiles').select('id,username,full_name,avatar').in('id', ids);
        (data || []).forEach(p => owners.set(p.id, { username: p.username, fullName: p.full_name || '', avatar: p.avatar || '' }));
      }
      loaded = true;
    } catch (e) {
      loadErr = (e && e.message) || 'Yuklab bo\'lmadi';
    } finally { loading = null; }
  })();
  return loading;
}

function parts() { return String(state.appsPath || '').split('/').filter(Boolean); }

/** Navigatsiya: URL ni url-router yangilaydi (tarixga yozadi), ko'rinishni o'zimiz chizamiz */
export function go(sub) {
  state.appsPath = sub || '';
  window.dispatchEvent(new Event('spacemr:route'));
  render();
}

/* ── Chizish ────────────────────────────────────────────────────────── */

/** phone <760, tablet 760–1199, desktop >=1200 (o'ng panel) */
export const layout = () => window.matchMedia('(min-width: 1200px)').matches ? 'desktop' : window.matchMedia('(min-width: 760px)').matches ? 'tablet' : 'phone';
const wide = () => layout() === 'desktop';
let catFilter = '', rndId = '';
const ctx = () => ({ cats, apps, owners, me: state.me, catById });
const opts = () => ({ query, catFilter, rndId });

function ensureRnd() { if (!apps.some(a => a.id === rndId)) rndId = pickRandom(ctx())?.id || ''; }

/** Desktop: o'ng float panelga 5 ta kartani chizadi (boshqa sahifalarda tozalaydi) */
function renderRail() {
  $('rightRail')?.classList.toggle('rr-apps-mode', state.view === 'apps');
  const box = $('rrApps');
  if (!box) return;
  box.innerHTML = (state.view === 'apps' && wide() && loaded) ? railHtml(ctx(), rndId) : '';
}

const listHtml = () => grouped(ctx(), opts(), layout() === 'phone' ? 'launcher' : 'cards');

function homeHtml() {
  const m = layout();
  if (m === 'phone') return mobileHome(ctx(), opts());
  if (m === 'tablet') return tabletHome(ctx(), opts());
  return `<div class="aps">
    <div class="aps-head"><h2 class="aps-title">Ilovalar</h2>
      <div class="aps-head-btns">
        <button type="button" class="aps-btn ghost" data-act="new-cat">+ Kategoriya</button>
        <button type="button" class="aps-btn" data-act="new-app">+ Ilova</button>
      </div></div>
    <div class="aps-search"><input id="apsQ" type="search" placeholder="Ilova yoki kategoriya qidirish…" autocomplete="off" value="${esc(query)}"></div>
    ${chips(ctx(), opts())}
    <div id="apsList">${listHtml()}</div></div>`;
}

function catHtml(c) {
  const list = apps.filter(a => a.category_id === c.id);
  const own = canEdit(c.owner_id), cx = ctx();
  const m = layout();
  const grid = !list.length ? '<div class="aps-empty"><b>Bu kategoriyada ilova yo\'q</b><span>"+ Ilova" bilan birinchisini qo\'shing</span></div>'
    : m === 'phone' ? `<div class="apm-grid">${list.map(a => launchTile(cx, a)).join('')}</div>`
    : `<div class="aps-grid">${list.map(a => appCard(cx, a)).join('')}</div>`;
  return `<div class="aps${m === 'phone' ? ' apm' : m === 'tablet' ? ' apt' : ''}">
    <div class="aps-head">
      <button type="button" class="aps-back" data-go="" aria-label="Orqaga">${ico('nav/chevron-left', 22)}</button>
      <h2 class="aps-title">${esc(c.name)}</h2>
      <div class="aps-head-btns"><button type="button" class="aps-btn" data-act="new-app" data-cat="${esc(c.id)}">+ Ilova</button></div>
    </div>
    <div class="aps-catbar"><span>/apps/${esc(c.slug)} · @${esc(ownerName(c.owner_id) || '?')}</span>
      ${own ? `<span class="aps-catbtns"><button type="button" class="aps-link" data-act="edit-cat" data-id="${esc(c.id)}">Tahrirlash</button><button type="button" class="aps-link danger" data-act="del-cat" data-id="${esc(c.id)}">O'chirish</button></span>` : ''}
    </div>
    ${grid}
  </div>`;
}

const notFoundHtml = (msg = 'Topilmadi') => `<div class="aps"><div class="aps-head"><button type="button" class="aps-back" data-go="" aria-label="Orqaga">${ico('nav/chevron-left', 22)}</button><h2 class="aps-title">Ilovalar</h2></div><div class="aps-empty"><b>${esc(msg)}</b><span>Manzilni tekshiring yoki ro'yxatga qayting</span></div></div>`;

export async function render() {
  const root = $('appsView');
  if (!root) return;
  const p = parts();
  if (p.length < 2) closeRunner();
  if (!loaded) {
    root.innerHTML = '<div class="spin-wrap"><div class="spinner"></div></div>';
    await load();
    if (!loaded) {
      root.innerHTML = `<div class="aps"><div class="aps-empty"><b>Yuklab bo'lmadi</b><span>${esc(loadErr)}</span><button type="button" class="aps-btn" data-act="retry">Qayta urinish</button></div></div>`;
      return;
    }
  }
  const cur = parts().join('/');
  if (cur !== p.join('/')) return render();   // yuklanish paytida manzil o'zgargan
  document.title = 'Ilovalar - SpaceMR';
  ensureRnd(); renderRail();
  if (p.length === 0) { root.innerHTML = homeHtml(); return; }
  const c = cats.find(x => x.slug === p[0]);
  if (!c) { root.innerHTML = notFoundHtml('Kategoriya topilmadi'); return; }
  if (p.length === 1) { root.innerHTML = catHtml(c); return; }
  const a = apps.find(x => x.category_id === c.id && x.slug === p[1]);
  if (!a) { root.innerHTML = notFoundHtml('Ilova topilmadi'); return; }
  if (runnerId !== a.id) openRunner(a, c);
}

/* ── Runner (ilovani ochish) ────────────────────────────────────────── */

/* Runner: kod ko'rinishi (faqat o'qish, rangli) <-> ilova ko'rinishi, sarlavhadagi bitta tugma bilan */
let runnerHtml = null;
const svgIco = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const CODE_ICO = svgIco('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>');
const VIEW_ICO = svgIco('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');
const COPY_ICO = svgIco('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
const CHECK_ICO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#1d9bf0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

function toggleCode() {
  const el = $('appRunner');
  if (!el || runnerHtml === null) return;
  const on = el.classList.toggle('code');
  const code = el.querySelector('.apr-code code');
  const ln = el.querySelector('.apr-ln');
  if (on && code && !code.dataset.ready) {
    const src = runnerHtml;
    code.innerHTML = src.length > 250000 ? esc(src) : highlight(src);
    code.dataset.ready = '1';
    if (ln) {
      const n = Math.max(1, src.split('\n').length);
      ln.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    }
  }
  const pane = el.querySelector('.apr-code');
  if (pane) { pane.scrollTop = 0; pane.scrollLeft = 0; }
  const b = el.querySelector('[data-act="run-code"]');
  if (b) {
    b.innerHTML = on ? VIEW_ICO : CODE_ICO;
    const lab = on ? "Ilovani ko'rish" : "Kodni ko'rish";
    b.setAttribute('title', lab); b.setAttribute('aria-label', lab);
  }
}

function closeRunner() {
  runnerHtml = null;
  if (runner) { try { runner.destroy(); } catch (_) {} runner = null; }
  runnerId = '';
  $('appRunner')?.remove();
}

async function openRunner(a, c) {
  closeRunner();
  runnerId = a.id;
  const own = canEdit(a.owner_id);
  const el = document.createElement('div');
  el.className = 'apr'; el.id = 'appRunner'; el.dataset.id = a.id;
  el.innerHTML = `<div class="apr-bar">
      <button type="button" class="apr-ib" data-act="run-back" aria-label="Orqaga">${ico('nav/chevron-left', 22)}</button>
      ${logoHtml(a, 'apr-logo')}
      <div class="apr-title"><b>${esc(a.name)}</b><small>${esc(c.slug)}/${esc(a.slug)} · @${esc(ownerName(a.owner_id) || '?')}</small></div>
      <button type="button" class="apr-ib" data-act="run-reload" aria-label="Qayta yuklash" title="Qayta yuklash">${ico('action/refresh', 20)}</button>
      <button type="button" class="apr-ib" data-act="run-copy" aria-label="Nusxalash" title="Nusxalash">${COPY_ICO}</button>
      <button type="button" class="apr-ib" data-act="run-code" aria-label="Kodni ko'rish" title="Kodni ko'rish">${CODE_ICO}</button>
      ${own ? `<button type="button" class="apr-ib" data-act="edit-app" data-id="${esc(a.id)}" aria-label="Tahrirlash" title="Tahrirlash">${ico('action/edit', 20)}</button>
      <button type="button" class="apr-ib danger" data-act="del-app" data-id="${esc(a.id)}" aria-label="O'chirish" title="O'chirish">${ico('action/trash', 20)}</button>` : ''}
    </div>
    <div class="apr-body"><div class="spin-wrap"><div class="spinner"></div></div></div>`;
  document.body.appendChild(el);
  const body = el.querySelector('.apr-body');
  const { data, error } = await sb.from('apps').select('html').eq('id', a.id).maybeSingle();
  if (runnerId !== a.id || !el.isConnected) return;   // bu orada yopilgan
  if (error || !data) {
    body.innerHTML = `<div class="aps-empty"><b>Ilovani yuklab bo'lmadi</b><span>${esc(error?.message || 'Topilmadi')}</span></div>`;
    try { window.__spacemrSplashHold = false; (window.__spacemrHideSplash || window.__mrspaceHideSplash)?.('app-preview'); } catch (_) {}
    return;
  }
  body.innerHTML = '<div class="apr-view"></div><div class="apr-code" tabindex="0"><pre class="apr-ln" aria-hidden="true"></pre><pre class="apr-pre"><code></code></pre></div>';
  runnerHtml = String(data.html || '');
  runner = runApp(body.querySelector('.apr-view'), { id: a.id, html: data.html });
  try { window.__spacemrSplashHold = false; (window.__spacemrHideSplash || window.__mrspaceHideSplash)?.('app-preview'); } catch (_) {}
}

/* ── Formalar ───────────────────────────────────────────────────────── */

/** Paste/save: faqat HTML qabul qilinadi. */
function isHtmlCode(src) {
  const s = String(src || '').trim();
  if (!s) return false;
  const head = s.slice(0, 500);
  // JS / module / JSON / pure CSS — HTML tegsiz
  if (/^(import\s|export\s|const\s|let\s|var\s|function\s|class\s)/i.test(head) && !/<[a-z!\/]/i.test(head)) return false;
  if (/^(\{[\s\S]*\}|\[[\s\S]*\])\s*$/.test(s) && !/<[a-z]/i.test(s)) return false;
  if (/^(body\s*\{|:root\s*\{|\*[\s{])/i.test(head) && (s.match(/\{/g) || []).length > 2 && !/<[a-z]/i.test(s)) return false;
  if (/<!doctype\s+html\b/i.test(s)) return true;
  if (/<\s*(html|head|body|div|span|p|a|script|style|section|main|header|footer|nav|ul|ol|li|table|form|input|button|img|h[1-6]|meta|link|title|canvas|svg|template|iframe)\b/i.test(s)) return true;
  if (/<\s*[a-z][\w:-]*(\s[^>]*)?\s*>/i.test(s) && /<\//.test(s)) return true;
  return false;
}

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 30);
const slugTaken = (slug, exceptId) =>
  RESERVED.includes(slug) || cats.some(c => c.slug === slug && c.id !== exceptId) || apps.some(a => a.slug === slug && a.id !== exceptId);

function slugHint(el, slug, exceptId) {
  if (!slug) { el.textContent = ''; el.className = 'apf-hint'; return false; }
  if (!SLUG_RE.test(slug)) { el.textContent = '3–30 belgi: a-z, 0-9, - va _ (kichik harf)'; el.className = 'apf-hint bad'; return false; }
  if (slugTaken(slug, exceptId)) { el.textContent = 'Bu nom band — boshqasini tanlang'; el.className = 'apf-hint bad'; return false; }
  el.textContent = 'Bo\'sh'; el.className = 'apf-hint ok'; return true;
}

function closeForm(id) { $(id)?.remove(); }

function dbErr(e) {
  const m = String(e?.message || e || '');
  if (/duplicate key|unique/i.test(m)) return 'Bu unikal nom band';
  if (/Bu nom band/i.test(m)) return 'Bu unikal nom band';
  if (/limit/i.test(m)) return m;
  if (/violates foreign key|restrict/i.test(m)) return 'Kategoriyada ilovalar bor — avval ularni o\'chiring';
  if (/row-level security|permission/i.test(m)) return 'Ruxsat yo\'q';
  return m || 'Xatolik';
}

function catOptions(sel) {
  return cats.map(c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
}

/* Maxsus dropdown: native <select> o'rnida. Select yashirin holda qiymatni saqlaydi (o'qish/yozish eskicha ishlaydi) */
const DD_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
const DD_CHEV = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

function initDropdown(sel) {
  if (!sel) return;
  sel.hidden = true;
  const dd = document.createElement('span');
  dd.className = 'apf-dd';
  dd.innerHTML = `<button type="button" class="apf-dd-btn" aria-haspopup="listbox" aria-expanded="false"><span class="apf-dd-val"></span>${DD_CHEV}</button><div class="apf-dd-list" role="listbox" hidden></div>`;
  sel.after(dd);
  const btn = dd.firstElementChild, list = btn.nextElementSibling, val = btn.firstElementChild;
  let hi = -1;
  const paint = () => {
    const cur = sel.selectedIndex;
    val.textContent = sel.options[cur]?.textContent || '';
    list.innerHTML = [...sel.options].map((o, i) => `<div class="apf-dd-opt${i === cur ? ' sel' : ''}" role="option" aria-selected="${i === cur}" data-i="${i}"><span>${esc(o.textContent)}</span>${i === cur ? DD_CHECK : ''}</div>`).join('');
  };
  const mark = i => {
    hi = i;
    [...list.children].forEach((n, k) => n.classList.toggle('hi', k === i));
    list.children[i]?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => {
    if (list.hidden) return;
    list.hidden = true; dd.classList.remove('open', 'up'); btn.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    paint();
    list.hidden = false; dd.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), room = window.innerHeight - r.bottom;
    dd.classList.toggle('up', room < 240 && r.top > room);
    mark(sel.selectedIndex);
  };
  const pick = i => {
    if (i < 0 || i >= sel.options.length) return;
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
    paint(); close(); btn.focus();
  };
  btn.addEventListener('click', () => (list.hidden ? open() : close()));
  list.addEventListener('click', e => { const o = e.target.closest('.apf-dd-opt'); if (o) pick(+o.dataset.i); });
  list.addEventListener('mousemove', e => { const o = e.target.closest('.apf-dd-opt'); if (o && +o.dataset.i !== hi) mark(+o.dataset.i); });
  dd.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return open();
      mark(Math.max(0, Math.min(sel.options.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if ((e.key === 'Enter' || e.key === ' ') && !list.hidden) { e.preventDefault(); pick(hi); }
    else if (e.key === 'Tab') close();
  });
  const onDoc = e => {
    if (!dd.isConnected) { document.removeEventListener('pointerdown', onDoc, true); return; }
    if (!dd.contains(e.target)) close();
  };
  document.addEventListener('pointerdown', onDoc, true);
  new MutationObserver(paint).observe(sel, { childList: true });   // "+ Yangi" kategoriya qo'shilganda ro'yxat yangilanadi
  paint();
}

async function openAppForm(editId, presetCat) {
  closeForm('appFormOverlay');
  let a = null;
  if (editId) {
    const base = apps.find(x => x.id === editId);
    if (!base || !canEdit(base.owner_id)) return;
    const { data } = await sb.from('apps').select('html').eq('id', editId).maybeSingle();
    a = { ...base, html: data?.html || '' };
  }
  if (!cats.length) { openCatForm(null, true); return; }
  const ov = document.createElement('div');
  ov.className = 'apf-ov'; ov.id = 'appFormOverlay';
  ov.innerHTML = `<div class="apf" role="dialog" aria-modal="true">
    <div class="apf-h"><b>${a ? 'Ilovani tahrirlash' : 'Yangi ilova'}</b><button type="button" class="apf-x" data-f="close" aria-label="Yopish"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <label class="apf-l">Nomi<input id="afName" maxlength="40" autocomplete="off" value="${esc(a?.name || '')}" placeholder="Mening o'yinim"></label>
    <label class="apf-l">Unikal nom (URL)
      <span class="apf-slug"><i>/apps/…/</i><input id="afSlug" maxlength="30" autocomplete="off" spellcheck="false" value="${esc(a?.slug || '')}" placeholder="mygame"${a ? ' readonly aria-readonly="true" tabindex="-1"' : ''}></span>
      <span class="apf-hint" id="afSlugHint">${a ? 'Unikal nom keyin o\'zgarmaydi' : ''}</span></label>
    <div class="apf-l">Kategoriya
      <span class="apf-row"><select id="afCat">${catOptions(a?.category_id || presetCat || cats[0].id)}</select>
      <button type="button" class="aps-link" data-f="new-cat">+ Yangi</button></span></div>
    <label class="apf-l">Qisqa tavsif (ixtiyoriy)<input id="afDesc" maxlength="200" autocomplete="off" value="${esc(a?.description || '')}"></label>
    <div class="apf-l">Logo
      <span class="apf-row"><span class="apf-logo" id="afLogoPrev">${safeLogo(a?.logo) ? `<img src="${safeLogo(a.logo)}" alt="">` : '<i>▣</i>'}</span>
      <span class="apf-hint" id="afLogoSrc">${a?.logo ? 'Saqlangan logo. Kod o\'zgarsa, qayta aniqlanadi' : 'HTML koddan avtomatik olinadi (favicon, logotip SVG, rasm yoki emoji)'}</span></span></div>
    <div class="apf-l">
      <div class="apf-code" id="afCodeBox">
        <pre class="apf-ln" id="afLn" aria-hidden="true">1</pre>
        <div class="apf-code-main">
          <pre class="apf-hl" aria-hidden="true"><code id="afHl"></code></pre>
          <textarea id="afHtml" class="apf-ta" aria-label="HTML kod" rows="12" wrap="off" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" placeholder="<!doctype html>">${esc(a?.html || '')}</textarea>
        </div>
      </div>
      <span class="apf-row"><input id="afHtmlFile" type="file" accept=".html,.htm,text/html"><span class="apf-hint">Bitta fayl (CSS/JS ichida), ≤ 1 MB</span></span></div>
    <div class="apf-hint bad" id="afErr"></div>
    <div class="apf-actions"><button type="button" class="aps-btn ghost" data-f="close">Bekor</button><button type="button" class="aps-btn" data-f="save" id="afSave">${a ? 'Saqlash' : 'Qo\'shish'}</button></div>
  </div>`;
  document.body.appendChild(ov);
  initDropdown($('afCat'));

  let slugEdited = !!a;
  const nameI = $('afName'), slugI = $('afSlug'), hint = $('afSlugHint'), errEl = $('afErr');
  const setErr = m => { errEl.textContent = m || ''; };
  nameI.addEventListener('input', () => { if (!slugEdited) { slugI.value = slugify(nameI.value); slugHint(hint, slugI.value, null); } });
  slugI.addEventListener('input', () => { slugEdited = true; slugI.value = slugI.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''); slugHint(hint, slugI.value, null); });
  /* Logo koddan avtomatik: kod yoki nom o'zgarsa (kechiktirib) qayta aniqlanadi */
  let logoTimer = 0, logoSeq = 0;
  const setLogoPrev = (l, src) => {
    $('afLogoPrev').innerHTML = l ? `<img src="${l}" alt="">` : '<i>▣</i>';
    $('afLogoSrc').textContent = l ? 'Koddan olindi: ' + src : 'Kodda logo topilmadi, ilova nomining bosh harfi ko\'rsatiladi';
  };
  const refreshLogo = async () => {
    const seq = ++logoSeq;
    const r = await extractLogo($('afHtml').value, nameI.value);
    if (seq !== logoSeq || !$('afLogoPrev')) return;
    setLogoPrev(r ? r.logo : null, r?.source);
  };
  const schedLogo = () => { clearTimeout(logoTimer); logoTimer = setTimeout(refreshLogo, 450); };
  const ta = $('afHtml'), hl = $('afHl'), ln = $('afLn');
  const syncCode = () => {
    const main = hl && hl.parentNode;
    if (main) { main.scrollTop = ta.scrollTop; main.scrollLeft = ta.scrollLeft; }
    if (ln) ln.scrollTop = ta.scrollTop;
  };
  let hlRaf = 0;
  const paintNow = () => {
    if (!$('afHl')) return;
    const v = ta.value;
    hl.innerHTML = (v.length > 250000 ? esc(v) : highlight(v)) + '\n';
    if (ln) {
      const n = Math.max(1, v.split('\n').length);
      ln.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    }
    syncCode();
  };
  const paintCode = () => { cancelAnimationFrame(hlRaf); if (ta.value.length < 60000) paintNow(); else hlRaf = requestAnimationFrame(paintNow); };
  ta.addEventListener('input', paintCode);
  ta.addEventListener('scroll', syncCode);
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
    ta.selectionStart = ta.selectionEnd = s + 2;
    paintCode();
  });
  /* Paste: darhol analyze — HTML bo'lmasa rad */
  ta.addEventListener('paste', e => {
    const clip = e.clipboardData?.getData('text/plain') ?? '';
    if (!clip.trim()) return;
    if (!isHtmlCode(clip)) {
      e.preventDefault();
      setErr("Bu HTML kod emas — faqat HTML qabul qilinadi");
      return;
    }
    setErr('');
    // paste odatdagidek, keyin qayta tekshir
    setTimeout(() => {
      if (!isHtmlCode(ta.value)) {
        setErr("Bu HTML kod emas — rad etildi");
      } else {
        setErr('');
        paintCode();
        schedLogo();
      }
    }, 0);
  });
  paintNow();
$('afHtml').addEventListener('input', schedLogo);
  nameI.addEventListener('input', schedLogo);
  $('afHtmlFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 1000000) { setErr('HTML 1 MB dan kichik bo\'lsin'); e.target.value = ''; return; }
    const txt = await f.text();
    if (!isHtmlCode(txt)) { setErr("Fayl HTML emas — rad etildi"); e.target.value = ''; return; }
    $('afHtml').value = txt; paintNow(); setErr(''); refreshLogo();
    if (!nameI.value.trim()) { const t = /<title[^>]*>([^<]{1,40})/i.exec($('afHtml').value); if (t) { nameI.value = t[1].trim(); nameI.dispatchEvent(new Event('input')); } }
  });

  /* Ctrl/Cmd+S: hammasi to'liq bo'lsa saqlaydi va yopadi (description ixtiyoriy) */
  ov.addEventListener('keydown', e => {
    if (!(e.key === 's' || e.key === 'S') || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const btn = $('afSave');
    if (btn && !btn.disabled) btn.click();
  });
  ov.addEventListener('click', async e => {
    if (e.target === ov) return closeForm('appFormOverlay');
    const f = e.target.closest('[data-f]')?.dataset.f; if (!f) return;
    if (f === 'close') return closeForm('appFormOverlay');
    if (f === 'new-cat') return openCatForm(null, false, id => { const s = $('afCat'); if (s) { s.innerHTML = catOptions(id); } });
    if (f !== 'save') return;
    const name = nameI.value.trim(), slug = slugI.value.trim(), desc = $('afDesc').value.trim(), html = $('afHtml').value, category_id = $('afCat').value;
    if (!name) return setErr('Nomini yozing');
    if (!a && !slugHint(hint, slug, null)) return setErr('Unikal nomni to\'g\'rilang');
    if (!html.trim()) return setErr('HTML kodni kiriting');
    if (!isHtmlCode(html)) return setErr('Bu HTML kod emas — faqat HTML qabul qilinadi');
    if (new Blob([html]).size > 1000000) return setErr('HTML 1 MB dan oshmasin');
    const btn = $('afSave'); btn.disabled = true; setErr('');
    /* Logo: koddan; topilmasa va kod o\'zgarmagan bo\'lsa eskisi qoladi */
    const found = await extractLogo(html, name);
    const logo = found ? found.logo : (a && a.html === html ? (a.logo || null) : null);
    let res;
    if (a) {
      const upd = { name, description: desc, category_id, html };
      upd.logo = logo;
      res = await sb.from('apps').update(upd).eq('id', a.id).select('id').maybeSingle();
    } else {
      res = await sb.from('apps').insert({ slug, name, description: desc, category_id, owner_id: state.me.uid, html, logo }).select('id').maybeSingle();
    }
    btn.disabled = false;
    if (res.error || !res.data) return setErr(dbErr(res.error) || 'Saqlanmadi (ruxsat yo\'q?)');
    closeForm('appFormOverlay');
    const keepPath = a ? parts().join('/') : null;
    loaded = false; await load(true);
    closeRunner();
    const c = catById(category_id);
    go(a && keepPath ? (c ? `${c.slug}/${a.slug}` : '') : `${c.slug}/${slug}`);
  });
  nameI.focus();
}

function openCatForm(editId, fromEmpty, onDone) {
  closeForm('appCatOverlay');
  const c = editId ? cats.find(x => x.id === editId) : null;
  if (editId && (!c || !canEdit(c.owner_id))) return;
  const ov = document.createElement('div');
  ov.className = 'apf-ov'; ov.id = 'appCatOverlay';
  ov.innerHTML = `<div class="apf" role="dialog" aria-modal="true">
    <div class="apf-h"><b>${c ? 'Kategoriyani tahrirlash' : 'Yangi kategoriya'}</b><button type="button" class="apf-x" data-f="close" aria-label="Yopish"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <label class="apf-l">Nomi<input id="acName" maxlength="40" autocomplete="off" value="${esc(c?.name || '')}" placeholder="Maktab"></label>
    <label class="apf-l">Unikal nom (URL)
      <span class="apf-slug"><i>/apps/</i><input id="acSlug" maxlength="30" autocomplete="off" spellcheck="false" value="${esc(c?.slug || '')}" placeholder="school"${c ? ' readonly aria-readonly="true" tabindex="-1"' : ''}></span>
      <span class="apf-hint" id="acHint">${c ? 'Unikal nom keyin o\'zgarmaydi' : ''}</span></label>
    <div class="apf-hint bad" id="acErr"></div>
    <div class="apf-actions"><button type="button" class="aps-btn ghost" data-f="close">Bekor</button><button type="button" class="aps-btn" data-f="save" id="acSave">${c ? 'Saqlash' : 'Yaratish'}</button></div>
  </div>`;
  document.body.appendChild(ov);
  let edited = !!c;
  const nameI = $('acName'), slugI = $('acSlug'), hint = $('acHint'), errEl = $('acErr');
  nameI.addEventListener('input', () => { if (!edited) { slugI.value = slugify(nameI.value); slugHint(hint, slugI.value, null); } });
  slugI.addEventListener('input', () => { edited = true; slugI.value = slugI.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''); slugHint(hint, slugI.value, null); });
  ov.addEventListener('click', async e => {
    if (e.target === ov) return closeForm('appCatOverlay');
    const f = e.target.closest('[data-f]')?.dataset.f; if (!f) return;
    if (f === 'close') return closeForm('appCatOverlay');
    if (f !== 'save') return;
    const name = nameI.value.trim(), slug = slugI.value.trim();
    if (!name) { errEl.textContent = 'Nomini yozing'; return; }
    if (!c && !slugHint(hint, slug, null)) { errEl.textContent = 'Unikal nomni to\'g\'rilang'; return; }
    const btn = $('acSave'); btn.disabled = true; errEl.textContent = '';
    const res = c
      ? await sb.from('app_categories').update({ name }).eq('id', c.id).select('id').maybeSingle()
      : await sb.from('app_categories').insert({ slug, name, owner_id: state.me.uid }).select('id').maybeSingle();
    btn.disabled = false;
    if (res.error || !res.data) { errEl.textContent = dbErr(res.error) || 'Saqlanmadi'; return; }
    closeForm('appCatOverlay');
    loaded = false; await load(true);
    if (onDone) onDone(res.data.id);
    else if (fromEmpty) { openAppForm(null, res.data.id); }
    render();
  });
  nameI.focus();
}

/* ── Amallar ────────────────────────────────────────────────────────── */

function delApp(id) {
  const a = apps.find(x => x.id === id);
  if (!a || !canEdit(a.owner_id)) return;
  showConfirm(`"${a.name}" ilovasi butunlay o'chiriladi.`, async () => {
    const { error } = await sb.from('apps').delete().eq('id', id);
    if (error) { alert(dbErr(error)); return; }
    const c = catById(a.category_id);
    closeRunner(); loaded = false; await load(true);
    go(c ? c.slug : '');
  }, 'Ilovani o\'chirish', 'O\'chirish');
}

function delCat(id) {
  const c = cats.find(x => x.id === id);
  if (!c || !canEdit(c.owner_id)) return;
  if (apps.some(a => a.category_id === id)) { alert('Kategoriyada ilovalar bor — avval ularni o\'chiring.'); return; }
  showConfirm(`"${c.name}" kategoriyasi o'chiriladi.`, async () => {
    const { error } = await sb.from('app_categories').delete().eq('id', id);
    if (error) { alert(dbErr(error)); return; }
    loaded = false; await load(true); go('');
  }, 'Kategoriyani o\'chirish', 'O\'chirish');
}

/** Sahifa va o'ng panel uchun umumiy hodisa boshqaruvchisi (data-act / data-user / data-go) */
function handle(e, scope) {
  if (!scope) return false;
  const t = e.target;
  const act = t.closest('[data-act]');
  if (act && scope.contains(act)) {
    const k = act.dataset.act;
    if (k === 'new-app') { openAppForm(null, act.dataset.cat || ''); return true; }
    if (k === 'new-cat') { openCatForm(null, false); return true; }
    if (k === 'edit-cat') { openCatForm(act.dataset.id); return true; }
    if (k === 'del-cat') { delCat(act.dataset.id); return true; }
    if (k === 'retry') { loaded = false; render(); return true; }
    if (k === 'chip') { catFilter = act.dataset.cat || ''; render(); return true; }
    if (k === 'rnd-next') { rndId = pickRandom(ctx(), rndId)?.id || ''; if (wide()) renderRail(); else render(); return true; }
    if (k === 'rnd-open') { const a = apps.find(x => x.id === rndId); if (a) go(appPath(ctx(), a)); return true; }
    if (k === 'rnd-go') { const a = pickRandom(ctx()); if (a) go(appPath(ctx(), a)); return true; }
  }
  const u = t.closest('[data-user]');
  if (u && scope.contains(u)) {
    import('../profile/profile.js').then(m => m.openUserProfileModal?.(u.dataset.user)).catch(() => {});
    return true;
  }
  const g = t.closest('[data-go]');
  if (g && scope.contains(g)) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return false;
    e.preventDefault();
    go(g.dataset.go);
    return true;
  }
  return false;
}

const onClick = e => handle(e, $('appsView'));

function onSearch(e) {
  if (e.target.id !== 'apsQ') return;
  query = e.target.value;
  if (wide()) { const l = $('apsList'); if (l) l.innerHTML = listHtml(); return; }
  render().then(() => { const i = $('apsQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
}

function onRunnerClick(e) {
  const b = e.target.closest('#appRunner [data-act]');
  if (!b) return;
  const k = b.dataset.act;
  if (k === 'run-back') { const p = parts(); return go(p[0] || ''); }
  if (k === 'run-code') return toggleCode();
  if (k === 'run-copy') {
    const txt = runnerHtml || '';
    const btn = b;
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(() => {
      if (btn) {
        btn.innerHTML = CHECK_ICO;
        btn.style.color = '#1d9bf0';
        clearTimeout(btn._ck);
        btn._ck = setTimeout(() => { btn.innerHTML = COPY_ICO; btn.style.color = ''; }, 3000);
      }
    }, () => toast("Nusxalab bo'lmadi", 'error'));
    return;
  }
  if (k === 'run-reload') return runner?.reload();
  if (k === 'edit-app') return openAppForm(b.dataset.id);
  if (k === 'del-app') return delApp(b.dataset.id);
}

export function mountApps() {
  if (!bound) {
    bound = true;
    const root = $('appsView');
    root?.addEventListener('click', onClick);
    root?.addEventListener('input', onSearch);
    $('rrApps')?.addEventListener('click', e => handle(e, $('rrApps')));
    const onBp = () => { if (state.view === 'apps') render(); };
    window.matchMedia('(min-width: 1200px)').addEventListener?.('change', onBp);
    window.matchMedia('(min-width: 760px)').addEventListener?.('change', onBp);
    document.addEventListener('click', onRunnerClick);
    window.addEventListener('apps:path', () => { if (state.view === 'apps') render(); });
  }
  render();
}

export function unmountApps() {
  closeRunner(); closeForm('appFormOverlay'); closeForm('appCatOverlay');
  const box = $('rrApps'); if (box) box.innerHTML = '';
  $('rightRail')?.classList.remove('rr-apps-mode');
}
