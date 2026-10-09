import { sb } from '../core/config.js';
/* gif-panel.js — emoji panelidagi "GIF" bo'limi: qidiruv + 2 ustunli ro'yxat + cheksiz skroll.
   Ma'lumot /api/gifs (Klipy proksi) dan keladi. Tanlangan GIF onPick({ u, w, h }) ga uzatiladi.
   2 martadan ko'p ishlatilgan GIF recent ga tushadi, eng ko'p ishlatilgani chapdagi birinchi katak. */

const HOSTS = /^https:\/\/static\.klipy\.com\//;
export const isGifUrl = u => typeof u === 'string' && HOSTS.test(u);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"' }[c]));
const RECENT_KEY = 'smr_gif_recent';

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '{}') || {}; } catch { return {}; }
}
function writeRecent(map) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(map)); } catch (_) {}
}
function bumpGif(g) {
  if (!g?.u) return;
  const map = readRecent();
  const prev = map[g.u] || { u: g.u, w: g.w || 1, h: g.h || 1, n: 0 };
  prev.n = (prev.n || 0) + 1;
  prev.w = g.w || prev.w;
  prev.h = g.h || prev.h;
  map[g.u] = prev;
  const ranked = Object.values(map).sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, 24);
  writeRecent(Object.fromEntries(ranked.map(x => [x.u, x])));
}
function recentList() {
  return Object.values(readRecent())
    .filter(g => g && g.u && (g.n || 0) > 2)
    .sort((a, b) => (b.n || 0) - (a.n || 0));
}

export function createGifPanel(root, onPick) {
  root.innerHTML = `
    <div class="gp-search"><input type="text" class="gp-search-inp" placeholder="GIF qidirish" autocomplete="off" spellcheck="false"></div>
    <div class="gp-body">
      <div class="gp-recent" hidden>
        <div class="gp-recent-label">Recent</div>
        <div class="gp-recent-grid"></div>
      </div>
      <div class="gp-cols"><div class="gp-col"></div><div class="gp-col"></div><div class="gp-col"></div></div>
      <div class="gp-msg" hidden></div>
    </div>`;
  const inp = root.querySelector('.gp-search-inp');
  const body = root.querySelector('.gp-body');
  const recentBox = root.querySelector('.gp-recent');
  const recentGrid = root.querySelector('.gp-recent-grid');
  const cols = [...root.querySelectorAll('.gp-col')];
  const msg = root.querySelector('.gp-msg');
  const items = new Map();
  let q = '', page = 1, next = 1, busy = false, loaded = false, seq = 0, timer = null, heights = [0, 0, 0];

  const say = t => { msg.textContent = t || ''; msg.hidden = !t; };
  function paintRecent() {
    if (q) { recentBox.hidden = true; recentGrid.innerHTML = ''; return; }
    const list = recentList();
    if (!list.length) { recentBox.hidden = true; recentGrid.innerHTML = ''; return; }
    recentBox.hidden = false;
    recentGrid.innerHTML = list.map(g =>
      `<button type="button" class="gp-item gp-recent-item" data-u="${esc(g.u)}" data-w="${g.w || 1}" data-h="${g.h || 1}" title="${g.n} marta"><img src="${esc(g.u)}" alt="" loading="eager" decoding="async" fetchpriority="high"></button>`
    ).join('');
  }
  function reset() { cols.forEach(c => { c.innerHTML = ''; }); heights = [0, 0, 0]; items.clear(); next = 1; page = 1; body.scrollTop = 0; say(''); paintRecent(); }
  function add(list) {
    for (const g of list) {
      if (items.has(g.id)) continue;
      items.set(g.id, g);
      const i = heights.indexOf(Math.min(...heights));
      heights[i] += (g.sm.h || 1) / (g.sm.w || 1);
      cols[i].insertAdjacentHTML('beforeend',
        `<button type="button" class="gp-item" data-id="${esc(g.id)}" title="${esc(g.t)}" style="aspect-ratio:${g.sm.w || 1}/${g.sm.h || 1}"><img src="${esc(g.sm.u)}" alt="" loading="eager" decoding="async"></button>`);
    }
  }
  // Bo'sh qidiruv: kundalik mashhur reaction/emoji GIF lar
  const POPULAR_Q = 'reaction';
  let failUntil = 0; // 429/tarmoq xatosidan keyin qayta urinish vaqti (ms)
  async function load() {
    if (busy || !next) return;
    if (Date.now() < failUntil) return; // rate-limit / xato cooldown
    busy = true; const my = seq; page = next;
    if (page === 1) say('');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const qq = q || (page === 1 ? POPULAR_Q : '');
      const r = await fetch(`/api/gifs?page=${page}&q=${encodeURIComponent(qq)}`, { headers: { Authorization: 'Bearer ' + (session?.access_token || '') } });
      if (my !== seq) return;
      if (!r.ok) {
        // 429/5xx: to'xtat — aks holda scrollHeight kichik bo'lib cheksiz so'rov ketadi
        next = 0;
        failUntil = Date.now() + (r.status === 429 ? 60000 : 15000);
        if (page === 1) say(r.status === 429 ? "Ko'p so'rov — keyinroq" : "GIF yuklanmadi");
        return;
      }
      const j = await r.json();
      say('');
      add(j.items || []);
      next = j.next || 0;
      if (!items.size) say('Topilmadi');
    } catch {
      if (my === seq) {
        next = 0; // qayta urinish loop YO'Q
        failUntil = Date.now() + 15000;
        if (page === 1) say('GIF yuklanmadi');
      }
    } finally {
      if (my === seq) busy = false;
    }
    // Faqat muvaffaqiyatli yuklashdan keyin bo'sh joyni to'ldirish
    if (my === seq && next && items.size && body.scrollHeight <= body.clientHeight + 40) load();
  }
  function search() { seq++; busy = false; failUntil = 0; reset(); load(); }
  function applyQuery(raw, { instant = false } = {}) {
    const v = String(raw ?? '').trim();
    if (v === q && items.size && loaded) return;
    const run = () => {
      if (v === q && items.size && loaded) return;
      q = v;
      search();
    };
    clearTimeout(timer);
    if (instant) run();
    else timer = setTimeout(run, 120);
  }
  inp.addEventListener('input', () => applyQuery(inp.value));
  body.addEventListener('scroll', () => { if (body.scrollTop + body.clientHeight > body.scrollHeight - 240) load(); }, { passive: true });
  root.addEventListener('click', e => {
    const recent = e.target.closest('.gp-recent-item');
    if (recent && isGifUrl(recent.dataset.u)) {
      const picked = { u: recent.dataset.u, w: Number(recent.dataset.w) || 1, h: Number(recent.dataset.h) || 1 };
      bumpGif(picked);
      paintRecent();
      onPick(picked); // sinxron — hech qanday await
      return;
    }
    const b = e.target.closest('.gp-item');
    if (!b) return;
    const g = items.get(b.dataset.id);
    if (!g) return;
    // Panelda allaqachon yuklangan sm URL tezroq; md sifatliroq — ikkalasi ham Klipy
    const src = (g.md && isGifUrl(g.md.u) ? g.md : g.sm);
    if (src && isGifUrl(src.u)) {
      const picked = { u: src.u, w: src.w || g.sm?.w || 1, h: src.h || g.sm?.h || 1 };
      bumpGif(picked);
      onPick(picked); // darhol yuborish
    }
  });
  // Avto-yuklash YO'Q: login/boot da 429 to'foni bo'lmasin. Faqat open() da.
  loaded = false;
  return {
    open() {
      paintRecent();
      if (!loaded) loaded = true;
      // 429 dan keyin next=0 bo'lishi mumkin — cooldown tugagach qayta urinish
      if (!items.size && Date.now() >= failUntil) { next = next || 1; load(); }
    },
    focusSearch() { try { inp.focus({ preventScroll: true }); } catch { inp.focus(); } },
    setQuery(raw, opts) {
      const v = String(raw ?? '');
      if (inp.value !== v) inp.value = v;
      applyQuery(v, opts);
    },
    getQuery() { return inp.value; },
  };
}
