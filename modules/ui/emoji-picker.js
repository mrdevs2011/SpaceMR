import { onEsc } from './esc-stack.js';
/* emoji-picker.js — telefon klaviaturasi (Gboard) uslubidagi emoji paneli.
   Tepada: qidiruv tugmasi + kategoriya ikonlari (SVG). Pastda: "Oxirgilar" va kategoriyalar
   bo'yicha sahifalar: tablar orasida gorizontal surish, sahifa ichida vertikal skroll. Ma'lumot mahalliy (emoji-data.js), birinchi ochilganda yuklanadi. */

const RECENT_KEY = 'spacemr_emoji_recent';
const RECENT_MAX = 24;

const ICONS = {
  recent: '<img src="./svg/emoji/recent.svg" alt="" class="icon" width="20" height="20">',
  smileys: '<img src="./svg/emoji/smileys.svg" alt="" class="icon" width="20" height="20">',
  people: '<img src="./svg/emoji/people.svg" alt="" class="icon" width="20" height="20">',
  animals: '<img src="./svg/emoji/animals.svg" alt="" class="icon" width="20" height="20">',
  food: '<img src="./svg/emoji/food.svg" alt="" class="icon" width="20" height="20">',
  activities: '<img src="./svg/emoji/activities.svg" alt="" class="icon" width="20" height="20">',
  travel: '<img src="./svg/emoji/travel.svg" alt="" class="icon" width="20" height="20">',
  objects: '<img src="./svg/emoji/objects.svg" alt="" class="icon" width="20" height="20">',
  symbols: '<img src="./svg/emoji/symbols.svg" alt="" class="icon" width="20" height="20">',
  flags: '<img src="./svg/emoji/flags.svg" alt="" class="icon" width="20" height="20">',
  search: '<img src="./svg/emoji/search.svg" alt="" class="icon" width="20" height="20">',
  close:      '<img src="./svg/extra/icon-0c873cf7ce23.svg" alt="" class="icon" width="14" height="14">',
};

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY) || localStorage.getItem('mrspace_emoji_recent');
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
function saveRecent(list) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch {} }

const grid = list => list.map(e => `<button type="button" class="ep-e" data-e="${esc(e)}">${e}</button>`).join('');

export function initEmojiPicker({ btn, pop, input }) {
  if (!btn || !pop || !input) return;
  let built = false, cats = [], recent = loadRecent();
  let tabs, body, searchRow, searchInp, tabRow;

  async function build() {
    if (built) return; built = true;
    pop.innerHTML = '<div class="ep-loading">Yuklanmoqda…</div>';
    try { ({ EMOJI_CATS: cats } = await import('./emoji-data.js')); }
    catch { pop.innerHTML = '<div class="ep-loading">Emoji yuklanmadi</div>'; built = false; return; }

    const tabDefs = [{ id: 'recent' }, ...cats.map(c => ({ id: c.id, name: c.name }))];
    pop.innerHTML = `
      <div class="ep-top">
        <button type="button" class="ep-tab ep-search-btn" data-act="search" title="Qidirish">${ICONS.search}</button>
        <div class="ep-tabs">${tabDefs.map(t => `<button type="button" class="ep-tab" data-tab="${t.id}" title="${esc(t.name || 'Oxirgilar')}">${ICONS[t.id]}</button>`).join('')}</div>
      </div>
      <div class="ep-search" hidden>
        <div class="ep-search-wrap">
          <input type="text" class="ep-search-inp" placeholder="Qidirish (inglizcha: heart, cat...)" autocomplete="off" spellcheck="false">
          <button type="button" class="ep-clear" data-act="closesearch" title="Yopish">${ICONS.close}</button>
        </div>
      </div>
      <div class="ep-body">
        <section data-sec="recent"><h4>Oxirgilar</h4><div class="ep-grid" data-grid="recent"></div></section>
        ${cats.map(c => `<section data-sec="${c.id}"><h4>${esc(c.name)}</h4><div class="ep-grid">${grid(c.list.map(x => x[0]))}</div></section>`).join('')}
        <section data-sec="results" hidden><h4>Natijalar</h4><div class="ep-grid" data-grid="results"></div></section>
      </div>`;
    tabs = [...pop.querySelectorAll('[data-tab]')];
    body = pop.querySelector('.ep-body');
    searchRow = pop.querySelector('.ep-search');
    searchInp = pop.querySelector('.ep-search-inp');
    tabRow = pop.querySelector('.ep-top');
    paintRecent();
    body.addEventListener('scroll', spy, { passive: true });
    initSwipe();
    searchInp.addEventListener('input', onSearch);
    setActive(recent.length ? 'recent' : cats[0].id);
  }

  function paintRecent() {
    const sec = pop.querySelector('[data-sec="recent"]');
    sec.hidden = !recent.length;
    sec.querySelector('.ep-grid').innerHTML = grid(recent);
    const t = pop.querySelector('[data-tab="recent"]'); if (t) t.hidden = !recent.length;
  }
  function setActive(id) {
    tabs.forEach(t => t.classList.toggle('on', t.dataset.tab === id));
    const t = tabs.find(x => x.dataset.tab === id), row = t && t.parentElement;
    if (row && row.scrollWidth > row.clientWidth) {
      const tr = t.getBoundingClientRect(), rr = row.getBoundingClientRect();
      row.scrollBy({ left: (tr.left - rr.left) - (rr.width - tr.width) / 2, behavior: 'smooth' });
    }
  }
  /* Gorizontal scroll (surish) bo'yicha qaysi sahifa ochiqligini aniqlaydi va tab ikonkasini yangilaydi */
  function spy() {
    if (searchRow && !searchRow.hidden && searchInp.value) return;
    const secs = [...body.querySelectorAll('section[data-sec]:not([hidden]):not([data-sec="results"])')];
    const i = Math.round(body.scrollLeft / (body.clientWidth || 1));
    if (secs[i]) setActive(secs[i].dataset.sec);
  }
  function goTo(id) {
    const s = body.querySelector(`[data-sec="${id}"]`);
    if (s) body.scrollTo({ left: s.offsetLeft, behavior: 'smooth' });
  }
  /* Surish: sezgirlik past — sahifa almashishi uchun kenglikning ~30% qadar surish (yoki tez flick) kerak.
     Telefon: barmoq bilan (sekin ergashadi). Desktop: touchpad 2 barmoq (yig'ilgan deltaX > WHEEL_MIN). */
  const SWIPE_FRAC = 0.3, WHEEL_MIN = 160;
  const curIdx = () => Math.round(body.scrollLeft / (body.clientWidth || 1));
  function step(dir, base = curIdx()) {
    if (searchRow && !searchRow.hidden && searchInp.value) return;
    const ps = [...body.querySelectorAll('section[data-sec]:not([hidden]):not([data-sec="results"])')];
    if (!ps.length) return;
    const t = ps[Math.max(0, Math.min(ps.length - 1, base + dir))];
    body.scrollTo({ left: t.offsetLeft, behavior: 'smooth' });
    setActive(t.dataset.sec);
  }
  function initSwipe() {
    let sx = null, sy = 0, sl = 0, t0 = 0, axis = null, base = 0;
    body.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { sx = null; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; sl = body.scrollLeft; t0 = Date.now(); axis = null; base = curIdx();
    }, { passive: true });
    body.addEventListener('touchmove', e => {
      if (sx == null) return;
      const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
      if (axis === 'x') body.scrollLeft = sl - dx * 0.5;
    }, { passive: true });
    const end = e => {
      if (sx == null) return;
      const dx = (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : sx) - sx;
      const dt = Math.max(Date.now() - t0, 1), was = axis;
      sx = null; axis = null;
      if (was !== 'x') return;
      const fast = Math.abs(dx) / dt > 0.8 && Math.abs(dx) > 60;
      step((Math.abs(dx) > (body.clientWidth || 1) * SWIPE_FRAC || fast) ? (dx < 0 ? 1 : -1) : 0, base);
    };
    body.addEventListener('touchend', end, { passive: true });
    body.addEventListener('touchcancel', end, { passive: true });
    let acc = 0, lastT = 0, locked = false;
    body.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now(), gap = now - lastT; lastT = now;
      if (locked) { if (gap > 120) { locked = false; acc = 0; } else return; }
      if (gap > 200) acc = 0;
      acc += e.deltaX;
      if (Math.abs(acc) > WHEEL_MIN) { step(acc > 0 ? 1 : -1); acc = 0; locked = true; }
    }, { passive: false });
  }
  function onSearch() {
    const q = searchInp.value.trim().toLowerCase();
    const res = pop.querySelector('[data-sec="results"]');
    const others = body.querySelectorAll('section[data-sec]:not([data-sec="results"])');
    if (!q) { res.hidden = true; others.forEach(s => { if (s.dataset.sec !== 'recent') s.hidden = false; }); paintRecent(); body.scrollLeft = 0; return; }
    const words = q.split(/\s+/);
    const hits = [];
    for (const c of cats) for (const [e, kw] of c.list) if (words.every(w => kw.includes(w))) hits.push(e);
    others.forEach(s => { s.hidden = true; });
    res.hidden = false;
    res.querySelector('.ep-grid').innerHTML = hits.length ? grid(hits.slice(0, 200)) : '<div class="ep-empty">Topilmadi</div>';
    body.scrollLeft = 0; res.scrollTop = 0;
  }
  function toggleSearch(on) {
    searchRow.hidden = !on; tabRow.hidden = on;
    if (on) searchInp.focus();
    else { searchInp.value = ''; onSearch(); }
  }
  function insert(emoji) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    const caret = start + emoji.length;
    input.focus(); input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    recent = [emoji, ...recent.filter(x => x !== emoji)].slice(0, RECENT_MAX);
    saveRecent(recent);
    if (searchRow?.hidden !== false) paintRecent();
  }

  /* Panel input qatori tepasida (mobil va desktop). Mobil (<1100px): klaviatura o'rnida ochiladi (Telegram kabi) — tizim klaviaturasi chiqmaydi,
     panel xabarlar ustida suzib turadi — xabarlar joyidan siljimaydi. */
  const isMobile = () => window.matchMedia('(max-width: 1099px)').matches;
  function dock(open) {
    if (isMobile()) {
      if (open) { input.setAttribute('inputmode', 'none'); input.blur(); input.focus({ preventScroll: true }); }
      else input.removeAttribute('inputmode');
    } else if (open) input.focus({ preventScroll: true });
  }
  const closePanel = () => { if (pop.classList.contains('show')) { pop.classList.remove('show'); pinned = false; dock(false); } };
  input.addEventListener('focus', () => { if (isMobile() && !pop.classList.contains('show')) input.removeAttribute('inputmode'); });
  input.addEventListener('pointerdown', () => { if (isMobile() && pop.classList.contains('show')) closePanel(); });

  /* Desktop: tugma ustiga kursor olib kelinsa panel yumshoq ochiladi, kursor ketsa yopiladi.
     Tugmani bosish yoki panel ichini bosish panelni "qotiradi" (tashqariga bosilgunча / Esc gacha ochiq turadi). */
  const canHover = () => !isMobile() && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let pinned = false, hoverT = null, leaveT = null;
  async function openPanel(focus) {
    pop.classList.add('show');
    await build(); recent = loadRecent(); if (built && body) paintRecent();
    if (focus) dock(true);
  }

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    clearTimeout(hoverT); clearTimeout(leaveT);
    const isOpen = pop.classList.contains('show');
    if (isOpen && canHover() && !pinned) { pinned = true; return; } // hover bilan ochilgan — bosish qotiradi
    if (isOpen) { pop.classList.remove('show'); pinned = false; dock(false); return; }
    pinned = true;
    await openPanel(true);
  });
  pop.addEventListener('mousedown', e => { if (!e.target.closest('.ep-search-inp')) e.preventDefault(); });

  const wrap = btn.closest('.chat-emoji-wrap') || btn.parentElement;
  wrap.addEventListener('mouseenter', () => {
    if (!canHover()) return;
    clearTimeout(leaveT);
    if (pop.classList.contains('show')) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => { pinned = false; openPanel(false); }, 120); // tasodifan o'tib ketganda ochilmasin
  });
  wrap.addEventListener('mouseleave', () => {
    clearTimeout(hoverT);
    if (!canHover() || pinned) return;
    clearTimeout(leaveT);
    leaveT = setTimeout(() => { if (!pinned) pop.classList.remove('show'); }, 350); // tugmadan panelga o'tish uchun kichik muhlat
  });
  pop.addEventListener('mousedown', () => { if (canHover() && pop.classList.contains('show')) pinned = true; });

  /* Hover 3 soniya — emoji nomi (o'zbekcha, Unicode CLDR) tooltip ko'rinishida. Ma'lumot (emoji-uz.js) birinchi marta lazy yuklanadi. */
  const TIP_DELAY = 3000;
  let tipTimer = null, tipEl = null, uzMap = null;
  const hideTip = () => { clearTimeout(tipTimer); tipTimer = null; if (tipEl) { tipEl.remove(); tipEl = null; } };
  async function showTip(cell) {
    if (!cell.isConnected || !cell.matches(':hover')) return;
    if (!uzMap) { try { ({ EMOJI_UZ: uzMap } = await import('./emoji-uz.js')); } catch { return; } }
    if (!cell.isConnected || !cell.matches(':hover')) return;
    const name = uzMap[(cell.dataset.e || '').replace(/\uFE0F/g, '')];
    if (!name) return;
    hideTip();
    tipEl = document.createElement('div');
    tipEl.className = 'ep-tip';
    tipEl.textContent = name;
    pop.appendChild(tipEl);
    const pr = pop.getBoundingClientRect(), cr = cell.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let left = cr.left - pr.left + cr.width / 2 - tw / 2;
    left = Math.max(4, Math.min(pr.width - tw - 4, left));
    let top = cr.top - pr.top - th - 6;
    if (top < 4) top = cr.bottom - pr.top + 6;
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
  }
  pop.addEventListener('mouseover', e => {
    const cell = e.target.closest('.ep-e');
    if (!cell || cell === e.relatedTarget?.closest?.('.ep-e')) return;
    hideTip();
    tipTimer = setTimeout(() => showTip(cell), TIP_DELAY);
  });
  pop.addEventListener('mouseout', e => { if (e.target.closest('.ep-e') && !e.relatedTarget?.closest?.('.ep-e')) hideTip(); else if (e.target.closest('.ep-e')) hideTip(); });
  pop.addEventListener('mousedown', hideTip);
  pop.addEventListener('scroll', hideTip, true);
  pop.addEventListener('click', (e) => {
    const em = e.target.closest('.ep-e'); if (em) { insert(em.dataset.e); return; }
    const tab = e.target.closest('[data-tab]'); if (tab) { goTo(tab.dataset.tab); setActive(tab.dataset.tab); return; }
    const act = e.target.closest('[data-act]');
    if (act?.dataset.act === 'search') toggleSearch(true);
    else if (act?.dataset.act === 'closesearch') toggleSearch(false);
  });
  document.addEventListener('click', (e) => {
    if (!pop.classList.contains('show')) return;
    if (btn.contains(e.target) || pop.contains(e.target)) return;
    if (input.contains(e.target)) return; // mobil: input bosilsa pointerdown yopadi; desktop: yozayotganda panel ochiq qoladi
    closePanel();
  });
  onEsc(366, () => { if (!pop.classList.contains('show')) return false; closePanel(); return true; });
}
