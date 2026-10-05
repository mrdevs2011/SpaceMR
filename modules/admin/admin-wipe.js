/**
 * admin-wipe.js — test ma'lumotlarini tozalash (admin paneli).
 * 4 bo'lim: Accounts / Content / Chats / All.
 * Oqim: 3 marta tasdiq → admin login+parol → fayllar Storage API bilan o'chadi → jadvallar RPC bilan.
 * Server tomoni: supabase/migrations/059_admin_gate_and_wipe.sql
 */
import { sb, MEDIA_BUCKET } from '../core/config.js';
import { showConfirm } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { askAdmin } from './admin-gate.js';

const SCOPES = {
  accounts: { label: 'Accounts', what: "admindan boshqa barcha akkauntlar va ularning hamma ma'lumotlari" },
  content:  { label: 'Content',  what: "barcha postlar, izohlar, like'lar, saqlanganlar va story'lar" },
  chats:    { label: 'Chats',    what: "barcha shaxsiy chatlar, guruhlar, xabarlar va qo'ng'iroqlar" },
  all:      { label: 'All',      what: "HAMMA narsa: akkauntlar, kontent, chatlar va barcha fayllar (storage 0 B)" },
};

const confirmStep = (msg, title, okLabel) => new Promise(res => {
  showConfirm(msg, () => res(true), title, okLabel, () => res(false));
});

async function run(scope, onDone) {
  const s = SCOPES[scope];
  if (!(await confirmStep(`${s.label}: ${s.what} o'chiriladi.`, `${s.label} tozalansinmi?`, 'Ha, tozalash'))) return;
  if (!(await confirmStep("Ishonchingiz komilmi? Bu amalni qaytarib bo'lmaydi.", 'Ishonchingiz komilmi?', 'Ha, ishonchim komil'))) return;
  if (!(await confirmStep(`Oxirgi ogohlantirish: ${s.what} butunlay o'chadi.`, 'Oxirgi tasdiq', "O'chirish"))) return;
  const password = await askAdmin({
    title: `${s.label} — tozalash`,
    sub: 'Tasdiqlash uchun admin parolini qayta kiriting.',
    okLabel: "O'chirish",
    danger: true,
  });
  if (!password) return;

  toast('Tozalanmoqda…');
  try {
    // 1) Fayllar — Storage API (fayl o'zi ham o'chadi, faqat jadval qatori emas)
    const { data: paths, error: pe } = await sb.rpc('admin_wipe_paths', { p_scope: scope, p_password: password });
    if (pe) throw pe;
    const list = (paths || []).filter(Boolean);
    const bucket = sb.storage.from(MEDIA_BUCKET);
    let removed = 0, failed = 0;
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const { data: rm, error } = await bucket.remove(chunk);
      if (error) {
        console.warn('[wipe] storage', error.message);
        failed += chunk.length;
      } else {
        removed += Array.isArray(rm) ? rm.length : chunk.length;
      }
    }
    // 2) Jadvallar (+ storage.objects qatorlari RPC ichida)
    const { data, error } = await sb.rpc('admin_wipe', { p_scope: scope, p_password: password });
    if (error) throw error;
    const total = Object.values(data || {}).reduce((a, n) => a + (Number(n) || 0), 0);
    const msg = failed
      ? `${s.label}: ${removed} fayl o'chirildi, ${failed} xato; ${total} qator`
      : `${s.label} tozalandi: ${removed} fayl, ${total} qator`;
    toast(msg, failed ? 'error' : 'success');
    onDone?.();
    // Storage hisobini darhol yangilash
    try {
      const st = await import('./admin-storage.js');
      await st.refreshStorageUsage();
    } catch (_) {}
  } catch (e) {
    console.error('[wipe]', e);
    toast('Tozalab bo\'lmadi: ' + (e?.message || 'xato'), 'error');
  }
}

/** Admin panelida "Storage tozalash" bo'limi */
export function renderWipePanel(anchor, onDone) {
  if (!anchor || document.getElementById('actionsWipe')) return;
  const box = document.createElement('section');
  box.id = 'actionsWipe';
  box.className = 'adm-wipe';
  box.innerHTML = `
    <button type="button" class="adm-wipe-head" id="actionsWipeToggle" aria-expanded="false" aria-controls="actionsWipeBody">
      <span class="adm-wipe-title">Storage tozalash</span>
      <img src="./svg/nav/chevron-down.svg" alt="" class="icon adm-wipe-chev" width="18" height="18">
    </button>
    <div class="adm-wipe-body" id="actionsWipeBody" hidden>
      <div class="adm-wipe-sub">Test ma'lumotlarini o'chirish. Har biri 3 marta tasdiq va admin parolini so'raydi.</div>
      <div class="adm-wipe-grid">
        ${Object.entries(SCOPES).map(([k, v]) => `<button type="button" class="adm-wipe-btn${k === 'all' ? ' is-all' : ''}" data-scope="${k}">${v.label}</button>`).join('')}
      </div>
    </div>`;
  let _asking = false;
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('#actionsWipeToggle');
    if (t) {
      if (_asking) return;
      const willOpen = !box.classList.contains('open');
      // Ochishdan oldin admin parolini so'raymiz (yopish — parolsiz)
      if (willOpen) {
        _asking = true;
        let ok;
        try {
          ok = await askAdmin({
            title: 'Storage tozalash',
            sub: 'Bo\'limni ochish uchun admin parolini kiriting.',
            okLabel: 'Ochish',
          });
        } finally { _asking = false; }
        if (!ok) return;
      }
      box.classList.toggle('open', willOpen);
      t.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      box.querySelector('#actionsWipeBody').hidden = !willOpen;
      return;
    }
    const b = e.target.closest('[data-scope]');
    if (b) run(b.dataset.scope, onDone);
  });
  anchor.insertAdjacentElement('afterend', box);
}

export function removeWipePanel() {
  document.getElementById('actionsWipe')?.remove();
}
