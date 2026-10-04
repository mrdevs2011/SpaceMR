/**
 * Sidebar pastidagi akkaunt bloki (avatar + ism + @username).
 * state.me auth.js tomonidan o'rnatiladi va profil tahrirlanganda
 * o'zgaradi — shuning uchun engil imzo-tekshiruv bilan yangilanadi.
 */
import { state } from '../core/config.js';
import { $, esc, defAvi } from '../core/utils.js';
import { onEsc } from './esc-stack.js';
import { navigateTo } from '../router.js';

let _sig = '';

function render() {
  const me = state.me;
  const box = $('sbAccount');
  if (!box) return;
  box.hidden = !me?.uid;
  if (!me?.uid) { _sig = ''; return; }

  const name = me.displayName || me.username || 'Profil';
  const user = me.username ? '@' + me.username : '';
  const av   = me.photoURL || defAvi(name);
  const sig  = [me.uid, name, user, av].join('|');
  if (sig === _sig) return;
  _sig = sig;

  $('sbAccAvi').innerHTML = `<img src="${esc(av)}" alt="" onerror="this.style.display='none'">`;
  $('sbAccName').textContent = name;
  $('sbAccUser').textContent = user;
  box.title = name;
}

/* ── 3 nuqta bosilsa — Sozlamalar + Chiqish menyusi ──────────────────── */
let _menu = null;

function closeMenu() {
  if (_menu) { _menu.remove(); _menu = null; }
}

function openMenu() {
  const box = $('sbAccount');
  if (!box) return;
  const r = box.getBoundingClientRect();
  const wide = window.matchMedia('(min-width: 1100px)').matches;

  _menu = document.createElement('div');
  _menu.className = 'sb-acc-menu';
  const uname = state.me?.username ? ' @' + state.me.username : '';
  _menu.innerHTML = `
    <button type="button" class="sb-acc-item" data-act="settings">Sozlamalar</button>
    <div class="sb-acc-sep"></div>
    <button type="button" class="sb-acc-item sb-acc-logout" data-act="logout">Chiqish${esc(uname)}</button>
  `;
  document.body.appendChild(_menu);

  _menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  if (wide) {
    _menu.style.left = (r.left + 8) + 'px';
    _menu.style.minWidth = Math.max(r.width - 16, 200) + 'px';
  } else {
    _menu.style.left = (r.right + 8) + 'px';
  }

  _menu.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const act = btn.dataset.act;
      closeMenu();
      if (act === 'logout') {
        try {
          const { logOut } = await import('../auth/auth.js');
          await logOut();
        } catch (err) {
          console.error('[logout]', err);
          location.replace('/');
        }
        return;
      }
      if (act === 'settings') {
        document.getElementById('settingsBtn')?.click()
          || document.getElementById('settingsOverlay')?.classList.add('show');
        return;
      }
    });
  });
}

// Username card (avatar + ism) bosilsa — profil + sozlamalar panelini ochish
// 3 nuqta bosilsa — Sozlamalar/Chiqish menyusi
// Mobil (dots yashirin) da butun blok menyuni ochadi
function openBasicAccordion() {
  const acc = document.querySelector('#settingsOverlay [data-pe-acc="basic"]');
  if (!acc) return;
  acc.classList.add('open');
  acc.querySelector('.pe-acc-toggle')?.setAttribute('aria-expanded', 'true');
}

export function openProfileSettings() {
  closeMenu();
  navigateTo('profile');
  const open = () => {
    const ov = document.getElementById('settingsOverlay');
    if (!ov) return;
    if (!ov.classList.contains('show')) {
      import('../auth/auth.js').then(m => { try { m.populateProfileForm?.(); } catch(_){} }).catch(()=>{});
      ov.classList.add('show');
    }
    openBasicAccordion();
    if (window.matchMedia('(min-width: 1200px)').matches) {
      document.body.classList.add('desktop-settings-pinned');
    } else {
      document.body.style.overflow = 'hidden';
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(open));
  setTimeout(open, 80);
}

$('sbAccount')?.addEventListener('click', e => {
  e.stopPropagation();
  const dots = e.target.closest('.sb-acc-dots');
  const wide = window.matchMedia('(min-width: 1100px)').matches;

  // Desktop: 3 nuqta → menyu, qolgan joy → profil + settings
  if (wide) {
    if (dots) {
      if (_menu) closeMenu(); else openMenu();
    } else {
      openProfileSettings();
    }
    return;
  }

  // Mobil / planshet: account → profil/sozlamalar + Asosiy ma'lumotlar
  openProfileSettings();
});

document.addEventListener('click', e => {
  if (_menu && !_menu.contains(e.target)) closeMenu();
});
onEsc(700, () => { if (!_menu) return false; closeMenu(); return true; });
window.addEventListener('resize', closeMenu);

render();
// state.me o'zgaganda yangilash (polling o'rniga event)
document.addEventListener('profilesPreloaded', () => { _sig = ''; render(); });
document.addEventListener('meUpdated', () => { _sig = ''; render(); });
// Zaxira: juda sekin (batareya/CPU tejash)
setInterval(() => { _sig = ''; render(); }, 30000);
export function refreshSidebarAccount() { _sig = ''; render(); }
