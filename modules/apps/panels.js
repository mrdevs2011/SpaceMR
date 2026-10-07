/**
 * Ilovalar sahifasi paneli — 5 ta blok (Mening ilovalarim, Yangi qo'shilganlar, Kategoriyalar,
 * Tasodifiy ilova, Top mualliflar). Bir xil ma'lumot, ikki xil ko'rinish:
 *   - Desktop (>=1200px): o'ng float panelda (railHtml)
 *   - Mobil/planshet: sahifaning o'zida, telefon "launcher" uslubida (mobileHome)
 * Toza funksiyalar: HTML qaytaradi, DOM'ga tegmaydi. Hodisalarni apps.js boshqaradi (data-act / data-go / data-user).
 */
import { esc, defAvi } from '../core/utils.js';

export const safeLogo = l => (typeof l === 'string' && /^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/.test(l)) ? l : '';

const DICE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

/* ── Ma'lumot ───────────────────────────────────────────────────────── */
const byUpdated = (a, b) => new Date(b.updated_at) - new Date(a.updated_at);
export const myApps = c => c.me ? c.apps.filter(a => a.owner_id === c.me.uid).sort(byUpdated) : [];
export const newest = (c, n = 6) => [...c.apps].sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at)).slice(0, n);
export function topAuthors(c, n = 5) {
  const m = new Map();
  c.apps.forEach(a => m.set(a.owner_id, (m.get(a.owner_id) || 0) + 1));
  return [...m].map(([id, cnt]) => ({ id, cnt, o: c.owners.get(id) || {} }))
    .sort((x, y) => y.cnt - x.cnt || String(x.o.username || '').localeCompare(String(y.o.username || ''))).slice(0, n);
}
export function pickRandom(c, exceptId) {
  const l = c.apps.filter(a => a.id !== exceptId);
  return l.length ? l[Math.floor(Math.random() * l.length)] : (c.apps[0] || null);
}
export const appPath = (c, a) => { const k = c.catById(a.category_id); return k ? `${k.slug}/${a.slug}` : ''; };
const ownerOf = (c, id) => (c.owners.get(id) || {}).username || '?';
const aviOf = o => esc(o.avatar || defAvi(o.fullName || o.username || '?'));

function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return 'hozir';
  if (s < 3600) return Math.round(s / 60) + ' daq';
  if (s < 86400) return Math.round(s / 3600) + ' soat';
  if (s < 86400 * 30) return Math.round(s / 86400) + ' kun';
  return Math.round(s / 86400 / 30) + ' oy';
}

/* ── Umumiy bo'laklar ───────────────────────────────────────────────── */
export function logoBox(a, cls) {
  const l = safeLogo(a.logo);
  return `<span class="${cls}">${l ? `<img src="${l}" alt="">` : `<span class="apc-logo-ph">${esc((a.name || '?')[0].toUpperCase())}</span>`}</span>`;
}

export function appCard(c, a) {
  const p = appPath(c, a);
  return `<a class="apc" href="/apps/${esc(p || '_')}" data-go="${esc(p)}">
    ${logoBox(a, 'apc-logo')}
    <span class="apc-meta"><b>${esc(a.name)}</b>${a.description ? `<small>${esc(a.description)}</small>` : ''}<code class="apc-slug">${esc(p)}</code><em>@${esc(ownerOf(c, a.owner_id))}</em></span>
  </a>`;
}

export const launchTile = (c, a) => `<a class="apm-tile" href="/apps/${esc(appPath(c, a) || '_')}" data-go="${esc(appPath(c, a))}">${logoBox(a, 'apm-tile-logo')}<span class="apm-tile-n">${esc(a.name)}</span></a>`;

export function chips(c, o) {
  return `<div class="aps-chips" role="tablist">
    <button type="button" class="aps-chip${o.catFilter ? '' : ' on'}" data-act="chip" data-cat="">Hammasi <b>${c.apps.length}</b></button>
    ${c.cats.map(k => `<button type="button" class="aps-chip${o.catFilter === k.id ? ' on' : ''}" data-act="chip" data-cat="${esc(k.id)}">${esc(k.name)} <b>${c.apps.filter(a => a.category_id === k.id).length}</b></button>`).join('')}
    <button type="button" class="aps-chip add" data-act="new-cat">+ Kategoriya</button>
  </div>`;
}

/** Kategoriyalar bo'yicha guruhlangan ro'yxat. mode: 'cards' (desktop) | 'launcher' (mobil) */
export function grouped(c, o, mode) {
  const q = (o.query || '').trim().toLowerCase();
  const match = a => !q || a.name.toLowerCase().includes(q) || a.slug.includes(q) || (a.description || '').toLowerCase().includes(q);
  let out = '';
  for (const k of c.cats) {
    if (o.catFilter && o.catFilter !== k.id) continue;
    const all = c.apps.filter(a => a.category_id === k.id);
    const hit = q && (k.name.toLowerCase().includes(q) || k.slug.includes(q));
    const list = hit ? all : all.filter(match);
    if (q && !list.length && !hit) continue;
    const body = !list.length ? '<div class="aps-none">Hozircha ilova yo\'q</div>'
      : mode === 'launcher' ? `<div class="apm-grid">${list.map(a => launchTile(c, a)).join('')}</div>`
      : `<div class="aps-grid">${list.map(a => appCard(c, a)).join('')}</div>`;
    out += `<section class="aps-sec">
      <a class="aps-sec-h" href="/apps/${esc(k.slug)}" data-go="${esc(k.slug)}"><span class="aps-sec-ic">${esc((k.name || '?')[0].toUpperCase())}</span><span class="aps-sec-n">${esc(k.name)}</span><em>${all.length} ta</em><i class="aps-sec-ch">›</i></a>
      ${body}</section>`;
  }
  return out || `<div class="aps-empty"><b>${q ? 'Hech narsa topilmadi' : 'Hali ilova yo\'q'}</b><span>${q ? 'Boshqa so\'z bilan qidiring' : 'Birinchi kategoriya va ilovani siz qo\'shing'}</span></div>`;
}

/* ── DESKTOP: o'ng panel (5 ta karta) ───────────────────────────────── */
const rrTitle = (t, right = '') => `<h3 class="rr-title rr-ap-title"><span>${t}</span>${right}</h3>`;
const rrRow = (c, a, sub) => `<button type="button" class="rr-row" data-go="${esc(appPath(c, a))}">${logoBox(a, 'rr-logo')}<span class="rr-meta"><div class="rr-name">${esc(a.name)}</div><div class="rr-sub">${sub}</div></span></button>`;

export function railHtml(c, rndId) {
  const mine = myApps(c), nw = newest(c, 5), au = topAuthors(c, 5), rnd = c.apps.find(a => a.id === rndId);
  const cMine = `<section class="rr-card rr-apps-card">
    ${rrTitle('Mening ilovalarim', `<button type="button" class="rr-plus" data-act="new-app" aria-label="Yangi ilova" title="Yangi ilova">${PLUS}</button>`)}
    <div class="rr-list">${mine.length
      ? mine.slice(0, 5).map(a => rrRow(c, a, `${esc(appPath(c, a))}`)).join('') + (mine.length > 5 ? `<div class="rr-more">va yana ${mine.length - 5} ta</div>` : '')
      : `<div class="rr-empty">Hali ilovangiz yo'q.</div><div class="rr-cta"><button type="button" class="aps-btn" data-act="new-app">+ Ilova qo'shish</button></div>`}</div></section>`;
  const cNew = `<section class="rr-card rr-apps-card">
    ${rrTitle('Yangi qo\'shilganlar')}
    <div class="rr-list">${nw.length ? nw.map(a => rrRow(c, a, `${esc(appPath(c, a))} · @${esc(ownerOf(c, a.owner_id))} · ${ago(a.created_at || a.updated_at)}`)).join('') : '<div class="rr-empty">Hozircha ilova yo\'q</div>'}</div></section>`;
  const cCats = `<section class="rr-card rr-apps-card">
    ${rrTitle('Kategoriyalar', `<button type="button" class="rr-plus" data-act="new-cat" aria-label="Yangi kategoriya" title="Yangi kategoriya">${PLUS}</button>`)}
    <div class="rr-list">${c.cats.length ? c.cats.map(k => `<button type="button" class="rr-row" data-go="${esc(k.slug)}"><span class="rr-cat-ic">${esc((k.name || '?')[0].toUpperCase())}</span><span class="rr-meta"><div class="rr-name">${esc(k.name)}</div><div class="rr-sub">/apps/${esc(k.slug)}</div></span><span class="rr-cnt">${c.apps.filter(a => a.category_id === k.id).length}</span></button>`).join('') : '<div class="rr-empty">Hali kategoriya yo\'q</div>'}</div></section>`;
  const cRnd = `<section class="rr-card rr-apps-card">
    ${rrTitle('Tasodifiy ilova', `<button type="button" class="rr-plus" data-act="rnd-next" aria-label="Boshqasi" title="Boshqasini ko'rsat">${DICE}</button>`)}
    ${rnd ? `<div class="rr-rnd">${logoBox(rnd, 'rr-rnd-logo')}<div class="rr-rnd-t"><b>${esc(rnd.name)}</b><small>${esc(rnd.description || appPath(c, rnd))}</small></div>
      <button type="button" class="aps-btn" data-act="rnd-open">Ochish</button></div>` : '<div class="rr-empty">Ilova qo\'shilgach shu yerda chiqadi</div>'}</section>`;
  const cTop = `<section class="rr-card rr-apps-card">
    ${rrTitle('Top mualliflar')}
    <div class="rr-list">${au.length ? au.map((x, i) => `<button type="button" class="rr-row" data-user="${esc(x.id)}"><span class="rr-rank">${i + 1}</span><span class="rr-avi"><img src="${aviOf(x.o)}" alt=""></span><span class="rr-meta"><div class="rr-name">${esc(x.o.fullName || x.o.username || 'Foydalanuvchi')}</div><div class="rr-sub">@${esc(x.o.username || '?')}</div></span><span class="rr-cnt">${x.cnt} ta</span></button>`).join('') : '<div class="rr-empty">Hozircha muallif yo\'q</div>'}</div></section>`;
  return cMine + cNew + cCats + cRnd + cTop;
}

/* ── MOBIL: sahifa ichida (launcher uslubi) ─────────────────────────── */
const secH = (t, right = '') => `<div class="apm-h"><h3>${t}</h3>${right}</div>`;

export function mobileHome(c, o) {
  const mine = myApps(c), nw = newest(c, 8), au = topAuthors(c, 10), rnd = c.apps.find(a => a.id === o.rndId);
  const dash = (o.query || o.catFilter) ? '' : `
    <section class="apm-sec">${secH('Mening ilovalarim')}
      <div class="apm-row">
        <button type="button" class="apm-tile apm-tile-add" data-act="new-app"><span class="apm-tile-logo">${PLUS}</span><span class="apm-tile-n">Yangi</span></button>
        ${mine.map(a => launchTile(c, a)).join('')}
      </div></section>
    <section class="apm-sec">${secH('Yangi qo\'shilganlar')}
      <div class="apm-stack">${nw.length ? nw.map(a => appCard(c, a)).join('') : '<div class="aps-none">Hozircha ilova yo\'q</div>'}</div></section>
    <section class="apm-sec">${secH('Tasodifiy ilova')}
      ${rnd ? `<div class="apm-rnd"><button type="button" class="apm-rnd-main" data-go="${esc(appPath(c, rnd))}">${logoBox(rnd, 'apm-rnd-logo')}<span class="apm-rnd-t"><b>${esc(rnd.name)}</b><small>${esc(rnd.description || appPath(c, rnd))}</small></span></button>
        <button type="button" class="apm-ib" data-act="rnd-next" aria-label="Boshqasi">${DICE}</button></div>` : '<div class="aps-none">Ilova qo\'shilgach shu yerda chiqadi</div>'}</section>
    <section class="apm-sec">${secH('Top mualliflar')}
      <div class="apm-row">${au.length ? au.map(x => `<button type="button" class="apm-auth" data-user="${esc(x.id)}"><span class="apm-auth-a"><img src="${aviOf(x.o)}" alt=""><i>${x.cnt}</i></span><span class="apm-auth-n">${esc(x.o.username || '?')}</span></button>`).join('') : '<div class="aps-none">Hozircha muallif yo\'q</div>'}</div></section>`;
  return `<div class="aps apm">
    <div class="apm-head"><h2 class="aps-title">Ilovalar</h2>
      <button type="button" class="apm-ib" data-act="rnd-go" aria-label="Tasodifiy ilovani ochish" title="Tasodifiy ilova">${DICE}</button>
      <button type="button" class="apm-ib solid" data-act="new-app" aria-label="Yangi ilova">${PLUS}</button></div>
    <div class="aps-search"><input id="apsQ" type="search" placeholder="Ilova yoki kategoriya qidirish…" autocomplete="off" value="${esc(o.query || '')}"></div>
    ${chips(c, o)}${dash}
    <section class="apm-sec">${(o.query || o.catFilter) ? '' : secH('Barcha ilovalar')}<div id="apsList">${grouped(c, o, 'launcher')}</div></section>
  </div>`;
}

/* ── PLANSHET: ikki ustun — markaz kartalar, o'ng yon panel sahifa ichida ── */
export function tabletHome(c, o) {
  const mine = myApps(c), nw = newest(c, 6), au = topAuthors(c, 8), rnd = c.apps.find(a => a.id === o.rndId);
  const filtering = !!(o.query || o.catFilter);
  const dash = filtering ? '' : `
    <section class="apt-block">
      ${secH('Mening ilovalarim', `<button type="button" class="aps-link" data-act="new-app">+ Yangi</button>`)}
      <div class="apt-icons">
        <button type="button" class="apm-tile apm-tile-add" data-act="new-app"><span class="apm-tile-logo">${PLUS}</span><span class="apm-tile-n">Qo'shish</span></button>
        ${mine.slice(0, 8).map(a => launchTile(c, a)).join('') || '<div class="aps-none">Hali ilovangiz yo\'q — birinchisini qo\'shing</div>'}
      </div></section>
    <section class="apt-block">
      ${secH("Yangi qo'shilganlar")}
      <div class="apt-cards">${nw.length ? nw.map(a => appCard(c, a)).join('') : '<div class="aps-none">Hozircha ilova yo\'q</div>'}</div></section>`;
  const side = filtering ? '' : `
    <aside class="apt-side">
      <section class="apt-card">
        ${secH('Tasodifiy', `<button type="button" class="apm-ib" data-act="rnd-next" aria-label="Boshqasi">${DICE}</button>`)}
        ${rnd ? `<button type="button" class="apt-rnd" data-go="${esc(appPath(c, rnd))}">${logoBox(rnd, 'apm-rnd-logo')}<span class="apm-rnd-t"><b>${esc(rnd.name)}</b><small>${esc(rnd.description || ('@' + ownerOf(c, rnd.owner_id)))}</small></span></button>` : '<div class="aps-none">Ilova qo\'shilgach shu yerda chiqadi</div>'}
      </section>
      <section class="apt-card">
        ${secH('Kategoriyalar', `<button type="button" class="apm-ib" data-act="new-cat" aria-label="Yangi kategoriya">${PLUS}</button>`)}
        <div class="apt-cats">${c.cats.length ? c.cats.map(k => `<button type="button" class="apt-cat" data-go="${esc(k.slug)}"><span class="rr-cat-ic">${esc((k.name || '?')[0].toUpperCase())}</span><span><b>${esc(k.name)}</b><small>/apps/${esc(k.slug)}</small></span><em>${c.apps.filter(a => a.category_id === k.id).length}</em></button>`).join('') : '<div class="aps-none">Hali kategoriya yo\'q</div>'}</div>
      </section>
      <section class="apt-card">
        ${secH('Top mualliflar')}
        <div class="apt-auths">${au.length ? au.map((x, i) => `<button type="button" class="apt-auth" data-user="${esc(x.id)}"><i>${i + 1}</i><img src="${aviOf(x.o)}" alt=""><span><b>${esc(x.o.fullName || x.o.username || 'Foydalanuvchi')}</b><small>@${esc(x.o.username || '?')}</small></span><em>${x.cnt}</em></button>`).join('') : '<div class="aps-none">Hozircha muallif yo\'q</div>'}</div>
      </section>
    </aside>`;
  return `<div class="aps apt">
    <div class="apt-head">
      <div class="aps-head"><h2 class="aps-title">Ilovalar</h2>
        <div class="aps-head-btns">
          <button type="button" class="aps-btn ghost" data-act="new-cat">+ Kategoriya</button>
          <button type="button" class="aps-btn" data-act="new-app">+ Ilova</button>
        </div></div>
      <div class="aps-search"><input id="apsQ" type="search" placeholder="Ilova yoki kategoriya qidirish…" autocomplete="off" value="${esc(o.query || '')}"></div>
      ${chips(c, o)}
    </div>
    <div class="apt-layout">
      <div class="apt-main">${dash}<section class="apt-block apt-all">${filtering ? '' : secH('Barcha ilovalar')}<div id="apsList">${grouped(c, o, 'cards')}</div></section></div>
      ${side}
    </div></div>`;
}
