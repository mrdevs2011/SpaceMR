import { sb } from '../core/config.js';
/* gif-panel.js — emoji panelidagi "GIF" bo'limi: qidiruv + 2 ustunli ro'yxat + cheksiz skroll.
   Ma'lumot /api/gifs (Klipy proksi) dan keladi. Tanlangan GIF onPick({ u, w, h }) ga uzatiladi. */

const HOSTS = /^https:\/\/static\.klipy\.com\//;
export const isGifUrl = u => typeof u === 'string' && HOSTS.test(u);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createGifPanel(root, onPick) {
  root.innerHTML = `
    <div class="gp-search"><input type="text" class="gp-search-inp" placeholder="GIF qidirish" autocomplete="off" spellcheck="false"></div>
    <div class="gp-body"><div class="gp-cols"><div class="gp-col"></div><div class="gp-col"></div><div class="gp-col"></div></div><div class="gp-msg" hidden></div></div>`;
  const inp = root.querySelector('.gp-search-inp');
  const body = root.querySelector('.gp-body');
  const cols = [...root.querySelectorAll('.gp-col')];
  const msg = root.querySelector('.gp-msg');
  const items = new Map();
  let q = '', page = 1, next = 1, busy = false, loaded = false, seq = 0, timer = null, heights = [0, 0, 0];

  const say = t => { msg.textContent = t || ''; msg.hidden = !t; };
  function reset() { cols.forEach(c => { c.innerHTML = ''; }); heights = [0, 0, 0]; items.clear(); next = 1; page = 1; body.scrollTop = 0; say(''); }
  function add(list) {
    for (const g of list) {
      if (items.has(g.id)) continue;
      items.set(g.id, g);
      const i = heights.indexOf(Math.min(...heights));   // eng qisqa ustunga
      heights[i] += (g.sm.h || 1) / (g.sm.w || 1);
      cols[i].insertAdjacentHTML('beforeend',
        `<button type="button" class="gp-item" data-id="${esc(g.id)}" title="${esc(g.t)}" style="aspect-ratio:${g.sm.w || 1}/${g.sm.h || 1}"><img src="${esc(g.sm.u)}" alt="" loading="lazy" decoding="async"></button>`);
    }
  }
  async function load() {
    if (busy || !next) return;
    busy = true; const my = seq; page = next;
    if (page === 1) say('Yuklanmoqda…');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`/api/gifs?page=${page}&q=${encodeURIComponent(q)}`, { headers: { Authorization: 'Bearer ' + (session?.access_token || '') } });
      if (my !== seq) return;
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      say('');
      add(j.items || []);
      next = j.next || 0;
      if (!items.size) say('Topilmadi');
    } catch { if (my === seq) say(page === 1 ? 'GIF yuklanmadi' : ''); next = page === 1 ? 1 : next; }
    finally { if (my === seq) busy = false; }
    if (my === seq && next && body.scrollHeight <= body.clientHeight + 40) load();   // panel to'lmagan bo'lsa davom
  }
  function search() { seq++; busy = false; reset(); load(); }
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { const v = inp.value.trim(); if (v === q) return; q = v; search(); }, 350);
  });
  body.addEventListener('scroll', () => { if (body.scrollTop + body.clientHeight > body.scrollHeight - 240) load(); }, { passive: true });
  root.addEventListener('click', e => {
    const b = e.target.closest('.gp-item'); if (!b) return;
    const g = items.get(b.dataset.id);
    if (g && isGifUrl(g.md.u)) onPick({ u: g.md.u, w: g.md.w, h: g.md.h });
  });
  return { open() { if (!loaded) { loaded = true; load(); } }, focusSearch: () => inp.focus() };
}
