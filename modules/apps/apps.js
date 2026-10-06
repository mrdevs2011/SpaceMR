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

const $ = id => document.getElementById(id);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const RESERVED = ['new', 'edit', 'mine', 'all', 'create', 'categories', 'category', 'admin', 'api', 'apps'];
const LIST_COLS = 'id,slug,name,description,category_id,owner_id,logo,updated_at';

let cats = [], apps = [], owners = new Map();
let loaded = false, loadErr = '', loading = null;
let bound = false, query = '';
let runner = null, runnerId = '';   // { destroy, reload }, ishga tushgan ilova id si

const isAdmin = () => !!state.me?.isAdmin;
const canEdit = ownerId => !!state.me && (ownerId === state.me.uid || isAdmin());
const ownerName = id => owners.get(id) || '';
const catById = id => cats.find(c => c.id === id);
const safeLogo = l => (typeof l === 'string' && /^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/.test(l)) ? l : '';
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
        const { data } = await sb.from('profiles').select('id,username').in('id', ids);
        (data || []).forEach(p => owners.set(p.id, p.username));
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

function card(a) {
  const c = catById(a.category_id);
  const href = `/apps/${c ? c.slug : '_'}/${a.slug}`;
  return `<a class="apc" href="${href}" data-go="${c ? esc(c.slug) + '/' + esc(a.slug) : ''}">
    ${logoHtml(a, 'apc-logo')}
    <span class="apc-meta"><b>${esc(a.name)}</b>${a.description ? `<small>${esc(a.description)}</small>` : ''}<code class="apc-slug">${c ? esc(c.slug) + '/' : ''}${esc(a.slug)}</code><em>@${esc(ownerName(a.owner_id) || '?')}</em></span>
  </a>`;
}

function listHtml() {
  const q = query.trim().toLowerCase();
  const match = a => !q || a.name.toLowerCase().includes(q) || a.slug.includes(q) || (a.description || '').toLowerCase().includes(q);
  let out = '';
  for (const c of cats) {
    const all = apps.filter(a => a.category_id === c.id);
    const catHit = q && (c.name.toLowerCase().includes(q) || c.slug.includes(q));
    const list = catHit ? all : all.filter(match);
    if (q && !list.length && !catHit) continue;
    out += `<section class="aps-sec">
      <a class="aps-sec-h" href="/apps/${esc(c.slug)}" data-go="${esc(c.slug)}"><span class="aps-sec-ic">${esc((c.name || '?')[0].toUpperCase())}</span><span class="aps-sec-n">${esc(c.name)}</span><em>${all.length} ta</em><i class="aps-sec-ch">›</i></a>
      ${list.length ? `<div class="aps-grid">${list.map(card).join('')}</div>` : '<div class="aps-none">Hozircha ilova yo\'q</div>'}
    </section>`;
  }
  return out || `<div class="aps-empty"><b>${q ? 'Hech narsa topilmadi' : 'Hali ilova yo\'q'}</b><span>${q ? 'Boshqa so\'z bilan qidiring' : 'Birinchi kategoriya va ilovani siz qo\'shing'}</span></div>`;
}

function homeHtml() {
  return `<div class="aps">
    <div class="aps-head"><h2 class="aps-title">Ilovalar</h2>
      <div class="aps-head-btns">
        <button type="button" class="aps-btn ghost" data-act="new-cat">+ Kategoriya</button>
        <button type="button" class="aps-btn" data-act="new-app">+ Ilova</button>
      </div></div>
    <div class="aps-search"><input id="apsQ" type="search" placeholder="Ilova yoki kategoriya qidirish…" autocomplete="off" value="${esc(query)}"></div>
    <div id="apsList">${listHtml()}</div></div>`;
}

function catHtml(c) {
  const list = apps.filter(a => a.category_id === c.id);
  const own = canEdit(c.owner_id);
  return `<div class="aps">
    <div class="aps-head">
      <button type="button" class="aps-back" data-go="" aria-label="Orqaga">${ico('nav/chevron-left', 22)}</button>
      <h2 class="aps-title">${esc(c.name)}</h2>
      <div class="aps-head-btns"><button type="button" class="aps-btn" data-act="new-app" data-cat="${esc(c.id)}">+ Ilova</button></div>
    </div>
    <div class="aps-catbar"><span>/apps/${esc(c.slug)} · @${esc(ownerName(c.owner_id) || '?')}</span>
      ${own ? `<span class="aps-catbtns"><button type="button" class="aps-link" data-act="edit-cat" data-id="${esc(c.id)}">Tahrirlash</button><button type="button" class="aps-link danger" data-act="del-cat" data-id="${esc(c.id)}">O'chirish</button></span>` : ''}
    </div>
    ${list.length ? `<div class="aps-grid">${list.map(card).join('')}</div>` : '<div class="aps-empty"><b>Bu kategoriyada ilova yo\'q</b><span>"+ Ilova" bilan birinchisini qo\'shing</span></div>'}
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
  if (p.length === 0) { root.innerHTML = homeHtml(); return; }
  const c = cats.find(x => x.slug === p[0]);
  if (!c) { root.innerHTML = notFoundHtml('Kategoriya topilmadi'); return; }
  if (p.length === 1) { root.innerHTML = catHtml(c); return; }
  const a = apps.find(x => x.category_id === c.id && x.slug === p[1]);
  if (!a) { root.innerHTML = notFoundHtml('Ilova topilmadi'); return; }
  if (runnerId !== a.id) openRunner(a, c);
}

/* ── Runner (ilovani ochish) ────────────────────────────────────────── */

function closeRunner() {
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
      ${own ? `<button type="button" class="apr-ib" data-act="edit-app" data-id="${esc(a.id)}" aria-label="Tahrirlash" title="Tahrirlash">${ico('action/edit', 20)}</button>
      <button type="button" class="apr-ib danger" data-act="del-app" data-id="${esc(a.id)}" aria-label="O'chirish" title="O'chirish">${ico('action/trash', 20)}</button>` : ''}
    </div>
    <div class="apr-note">Bu ilova foydalanuvchi tomonidan yuklangan va SpaceMR'dan alohida (sandbox) ishlaydi — u SpaceMR ma'lumotlariga kira olmaydi. Parol yoki shaxsiy ma'lumot kiritmang.</div>
    <div class="apr-body"><div class="spin-wrap"><div class="spinner"></div></div></div>`;
  document.body.appendChild(el);
  const body = el.querySelector('.apr-body');
  const { data, error } = await sb.from('apps').select('html').eq('id', a.id).maybeSingle();
  if (runnerId !== a.id || !el.isConnected) return;   // bu orada yopilgan
  if (error || !data) {
    body.innerHTML = `<div class="aps-empty"><b>Ilovani yuklab bo'lmadi</b><span>${esc(error?.message || 'Topilmadi')}</span></div>`;
    return;
  }
  body.innerHTML = '';
  runner = runApp(body, { id: a.id, html: data.html });
}

/* ── Formalar ───────────────────────────────────────────────────────── */

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

/** Logo faylni data URL ga aylantiradi: SVG o'z holida (<=60KB), PNG/JPG/WEBP 128x128 ga kichraytiriladi */
async function fileToLogo(file) {
  if (!file) return null;
  if (file.type === 'image/svg+xml') {
    if (file.size > 60 * 1024) throw new Error('SVG 60 KB dan kichik bo\'lsin');
    const txt = await file.text();
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(txt)));
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Faqat SVG, PNG yoki JPG');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Rasm o\'qilmadi')); i.src = url; });
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d'), m = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
    let out = cv.toDataURL('image/png');
    if (out.length > 110000) out = cv.toDataURL('image/jpeg', 0.85);
    return out;
  } finally { URL.revokeObjectURL(url); }
}

function catOptions(sel) {
  return cats.map(c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
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
    <div class="apf-h"><b>${a ? 'Ilovani tahrirlash' : 'Yangi ilova'}</b><button type="button" class="apf-x" data-f="close" aria-label="Yopish">✕</button></div>
    <label class="apf-l">Nomi<input id="afName" maxlength="40" autocomplete="off" value="${esc(a?.name || '')}" placeholder="Mening o'yinim"></label>
    <label class="apf-l">Unikal nom (URL)
      <span class="apf-slug"><i>/apps/…/</i><input id="afSlug" maxlength="30" autocomplete="off" spellcheck="false" value="${esc(a?.slug || '')}" placeholder="mygame"${a ? ' readonly' : ''}></span>
      <span class="apf-hint" id="afSlugHint">${a ? 'Unikal nom keyin o\'zgarmaydi' : ''}</span></label>
    <label class="apf-l">Kategoriya
      <span class="apf-row"><select id="afCat">${catOptions(a?.category_id || presetCat || cats[0].id)}</select>
      <button type="button" class="aps-link" data-f="new-cat">+ Yangi</button></span></label>
    <label class="apf-l">Qisqa tavsif (ixtiyoriy)<input id="afDesc" maxlength="200" autocomplete="off" value="${esc(a?.description || '')}"></label>
    <div class="apf-l">Logo (SVG, PNG yoki JPG)
      <span class="apf-row"><span class="apf-logo" id="afLogoPrev">${safeLogo(a?.logo) ? `<img src="${safeLogo(a.logo)}" alt="">` : '<i>▣</i>'}</span>
      <input id="afLogoFile" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp">
      <button type="button" class="aps-link danger" data-f="logo-clear">Olib tashlash</button></span></div>
    <div class="apf-l">HTML kod
      <textarea id="afHtml" spellcheck="false" placeholder="<!doctype html>…">${esc(a?.html || '')}</textarea>
      <span class="apf-row"><input id="afHtmlFile" type="file" accept=".html,.htm,text/html"><span class="apf-hint">Bitta fayl (CSS/JS ichida), ≤ 1 MB</span></span></div>
    <div class="apf-hint bad" id="afErr"></div>
    <div class="apf-actions"><button type="button" class="aps-btn ghost" data-f="close">Bekor</button><button type="button" class="aps-btn" data-f="save" id="afSave">${a ? 'Saqlash' : 'Qo\'shish'}</button></div>
  </div>`;
  document.body.appendChild(ov);

  let logo = a?.logo || null, logoDirty = false, slugEdited = !!a;
  const nameI = $('afName'), slugI = $('afSlug'), hint = $('afSlugHint'), errEl = $('afErr');
  const setErr = m => { errEl.textContent = m || ''; };
  nameI.addEventListener('input', () => { if (!slugEdited) { slugI.value = slugify(nameI.value); slugHint(hint, slugI.value, null); } });
  slugI.addEventListener('input', () => { slugEdited = true; slugI.value = slugI.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''); slugHint(hint, slugI.value, null); });
  $('afLogoFile').addEventListener('change', async e => {
    try { logo = await fileToLogo(e.target.files[0]); logoDirty = true; setErr(''); $('afLogoPrev').innerHTML = logo ? `<img src="${logo}" alt="">` : '<i>▣</i>'; }
    catch (er) { setErr(er.message); e.target.value = ''; }
  });
  $('afHtmlFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 1000000) { setErr('HTML 1 MB dan kichik bo\'lsin'); e.target.value = ''; return; }
    $('afHtml').value = await f.text(); setErr('');
    if (!nameI.value.trim()) { const t = /<title[^>]*>([^<]{1,40})/i.exec($('afHtml').value); if (t) { nameI.value = t[1].trim(); nameI.dispatchEvent(new Event('input')); } }
  });

  ov.addEventListener('click', async e => {
    if (e.target === ov) return closeForm('appFormOverlay');
    const f = e.target.closest('[data-f]')?.dataset.f; if (!f) return;
    if (f === 'close') return closeForm('appFormOverlay');
    if (f === 'logo-clear') { logo = null; logoDirty = true; $('afLogoPrev').innerHTML = '<i>▣</i>'; $('afLogoFile').value = ''; return; }
    if (f === 'new-cat') return openCatForm(null, false, id => { const s = $('afCat'); if (s) { s.innerHTML = catOptions(id); } });
    if (f !== 'save') return;
    const name = nameI.value.trim(), slug = slugI.value.trim(), desc = $('afDesc').value.trim(), html = $('afHtml').value, category_id = $('afCat').value;
    if (!name) return setErr('Nomini yozing');
    if (!a && !slugHint(hint, slug, null)) return setErr('Unikal nomni to\'g\'rilang');
    if (!html.trim()) return setErr('HTML kodni kiriting');
    if (new Blob([html]).size > 1000000) return setErr('HTML 1 MB dan oshmasin');
    const btn = $('afSave'); btn.disabled = true; setErr('');
    let res;
    if (a) {
      const upd = { name, description: desc, category_id, html };
      if (logoDirty) upd.logo = logo;
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
    <div class="apf-h"><b>${c ? 'Kategoriyani tahrirlash' : 'Yangi kategoriya'}</b><button type="button" class="apf-x" data-f="close" aria-label="Yopish">✕</button></div>
    <label class="apf-l">Nomi<input id="acName" maxlength="40" autocomplete="off" value="${esc(c?.name || '')}" placeholder="Maktab"></label>
    <label class="apf-l">Unikal nom (URL)
      <span class="apf-slug"><i>/apps/</i><input id="acSlug" maxlength="30" autocomplete="off" spellcheck="false" value="${esc(c?.slug || '')}" placeholder="school"${c ? ' readonly' : ''}></span>
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

function onClick(e) {
  const t = e.target;
  const act = t.closest('[data-act]');
  if (act) {
    const k = act.dataset.act;
    if (k === 'new-app') return openAppForm(null, act.dataset.cat || '');
    if (k === 'new-cat') return openCatForm(null, false);
    if (k === 'edit-cat') return openCatForm(act.dataset.id);
    if (k === 'del-cat') return delCat(act.dataset.id);
    if (k === 'retry') { loaded = false; return render(); }
  }
  const go_ = t.closest('[data-go]');
  if (go_ && $('appsView')?.contains(go_)) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    return go(go_.dataset.go);
  }
}

function onRunnerClick(e) {
  const b = e.target.closest('#appRunner [data-act]');
  if (!b) return;
  const k = b.dataset.act;
  if (k === 'run-back') { const p = parts(); return go(p[0] || ''); }
  if (k === 'run-reload') return runner?.reload();
  if (k === 'edit-app') return openAppForm(b.dataset.id);
  if (k === 'del-app') return delApp(b.dataset.id);
}

export function mountApps() {
  if (!bound) {
    bound = true;
    const root = $('appsView');
    root?.addEventListener('click', onClick);
    root?.addEventListener('input', e => { if (e.target.id === 'apsQ') { query = e.target.value; const l = $('apsList'); if (l) l.innerHTML = listHtml(); } });
    document.addEventListener('click', onRunnerClick);
    window.addEventListener('apps:path', () => { if (state.view === 'apps') render(); });
  }
  render();
}

export function unmountApps() {
  closeRunner(); closeForm('appFormOverlay'); closeForm('appCatOverlay');
}
