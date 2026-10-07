/**
 * password-confirm.js — xavfli amallardan oldin joriy parolni so'rovchi umumiy oyna.
 * askPassword({title, sub, okLabel}) -> Promise<boolean> (true = parol to'g'ri).
 * Tekshiruv vaqtinchalik klientda (verifyPassword) — joriy sessiya buzilmaydi.
 */
import { sb, state, verifyPassword } from '../core/config.js';

export function askPassword({
  title = 'Parolni kiriting',
  sub = 'Davom etish uchun joriy parolingizni tasdiqlang.',
  okLabel = 'Tasdiqlash',
} = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.id = 'pwConfirmOverlay';
    ov.className = 'overlay show';
    ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-title"></div>
      <div class="fs-14px c-text2-theme mb-20px tac"></div>
      <input class="field" type="password" id="pwcInp" placeholder="Joriy parol" autocomplete="current-password">
      <div class="fs-13px c-red-theme" id="pwcErr" style="min-height:18px;margin:6px 0"></div>
      <div class="modal-btn-row">
        <button class="btn-ghost" id="pwcCancel">Bekor qilish</button>
        <button class="btn-danger" id="pwcOk"></button>
      </div>
    </div>`;
    ov.querySelector('.sheet-title').textContent = title;
    ov.querySelector('.tac').textContent = sub;
    ov.querySelector('#pwcOk').textContent = okLabel;
    document.body.appendChild(ov);
    const inp = ov.querySelector('#pwcInp');
    const err = ov.querySelector('#pwcErr');
    const ok  = ov.querySelector('#pwcOk');
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('#pwcCancel').onclick = () => done(false);
    setTimeout(() => inp.focus(), 50);
    const submit = async () => {
      const pwd = inp.value;
      if (!pwd) { err.textContent = 'Parolni kiriting'; return; }
      ok.disabled = true; err.textContent = '';
      try {
        let email = state.me?.email;
        if (!email) email = (await sb.auth.getUser())?.data?.user?.email;
        if (!email) throw new Error('Hisob emaili topilmadi');
        await verifyPassword(email, pwd);
        done(true);
      } catch (e) {
        ok.disabled = false;
        err.textContent = e.code === 'wrong-password' ? "Parol noto'g'ri" : (e.message || 'Xato');
        inp.select();
      }
    };
    ok.onclick = submit;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}
