/**
 * Chats — desktop'da X.com uslubidagi ikki panelli ko'rinish:
 *  chap: suhbatlar ro'yxati (+ filtr), o'ng: "Suhbatni boshlang" bo'sh holati
 *  (suhbat ochilganda uning ustini chatThreadModal yopadi — CSS'da).
 * Mobil'da (<768px) hech narsa o'zgarmaydi: CSS bu elementlarni yashiradi.
 */
import { $ } from '../core/utils.js';
import { onEsc } from '../ui/esc-stack.js';

const view = $('chatsView');
const wrap = $('chatsListWrap');

if (view && wrap) {
  /* ── O'ng panel: bo'sh holat ─────────────────────────────────────── */
  const pane = document.createElement('div');
  pane.className = 'chats-x-pane';
  pane.innerHTML = `
    <div class="chats-x-pane-in">
      <div class="chats-x-pane-ico">
        <img src="./svg/extra/icon-c0aeb9caa2ca.svg" alt="" class="icon" width="46" height="46">
      </div>
      <div class="chats-x-pane-title">Suhbatni boshlang</div>
      <div class="chats-x-pane-sub">Mavjud suhbatlardan birini tanlang<br>yoki yangisini boshlang.</div>
      <button type="button" class="chats-x-newbtn" id="chatsXNew">Yangi chat</button>
    </div>`;
  view.appendChild(pane);

  /* "Yangi chat" — username bo'yicha qidiruv maydoniga o'tadi */
  $('chatsXNew')?.addEventListener('click', () => {
    /* "Yangi guruh" formasi ochiq bo'lsa — avval yopamiz (URL ham /chats ga qaytadi) */
    const gc = $('grpCreateFormOverlay');
    if (gc?.classList.contains('show') && !gc.dataset.addMode) $('grpFormCancelBtn')?.click();
    $('chatSearchInput')?.focus();
  });

  /* ── Chap panel: ro'yxat bo'sh bo'lsa ────────────────────────────── */
  const empty = document.createElement('div');
  empty.className = 'chats-x-empty';
  empty.innerHTML = `
    <div class="chats-x-empty-title">Inbox bo'sh</div>
    <div class="chats-x-empty-sub">Kimgadir xabar yozing</div>`;
  view.appendChild(empty);

  const syncEmpty = () => {
    const rows = [...wrap.querySelectorAll('.chat-row')];
    const hasVisible = rows.some(r => r.offsetParent !== null);
    const loading = !!wrap.querySelector('.spinner');
    empty.classList.toggle('show', !hasVisible && !loading);
  };
  new MutationObserver(syncEmpty).observe(wrap, { childList: true, subtree: true });
  syncEmpty();

  /* ── Filtr: Hammasi / Shaxsiy / Guruhlar ─────────────────────────── */
  const FILTERS = [
    { id: 'all',    label: 'Hammasi'  },
    { id: 'dm',     label: 'Shaxsiy'  },
    { id: 'groups', label: 'Guruhlar' },
  ];
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };

  function setFilter(id) {
    const f = FILTERS.find(x => x.id === id) || FILTERS[0];
    if (f.id === 'all') delete wrap.dataset.filter; else wrap.dataset.filter = f.id;
    $('chatsFilterLabel').textContent = f.label;
    syncEmpty();
  }

  function openMenu() {
    const btn = $('chatsFilterBtn');
    const r = btn.getBoundingClientRect();
    const cur = wrap.dataset.filter || 'all';
    menu = document.createElement('div');
    menu.className = 'chats-x-menu';
    menu.innerHTML = FILTERS.map(f =>
      `<button type="button" class="chats-x-item${f.id === cur ? ' on' : ''}" data-f="${f.id}">${f.label}</button>`
    ).join('');
    document.body.appendChild(menu);
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, r.left) + 'px';
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      setFilter(b.dataset.f);
      closeMenu();
    });
  }

  $('chatsFilterBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (menu) closeMenu(); else openMenu();
  });
  document.addEventListener('click', e => { if (menu && !menu.contains(e.target)) closeMenu(); });
  onEsc(700, () => { if (!menu) return false; closeMenu(); return true; });
  window.addEventListener('resize', closeMenu);
}
