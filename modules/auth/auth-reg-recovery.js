/**
 * auth-reg-recovery.js — ro'yxatdan o'tganda zaxira email maslahati
 */
import { sb } from '../core/config.js';
import { $, defAvi, uToEmail } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { validateStrictEmail } from './auth.js';

let _sbErrUz = (err) => err?.message || 'Xato';

export function initRegRecovery({ sbErrUz } = {}) {
  if (typeof sbErrUz === 'function') _sbErrUz = sbErrUz;
}

/* ── Ro'yxatdan o'tishda zaxira email maslahati va kiritish ────────── */
let _pendingRegData = null;

export function openRegRecoveryModal(regData) {
  _pendingRegData = regData;
  const tipStep = $('regRecoveryStepTip');
  const inputStep = $('regRecoveryStepInput');
  const emailInp = $('regRecoveryEmailInput');
  const errEl = $('regRecoveryEmailErr');

  if (tipStep) tipStep.style.display = 'block';
  if (inputStep) inputStep.style.display = 'none';
  if (emailInp) {
    emailInp.value = '';
    emailInp.classList.remove('input-error');
  }
  if (errEl) errEl.textContent = '';

  // Alohida modal emas — login kartaning o'zida (forma yashiriladi, zaxira email bosqichi ko'rinadi)
  const modal = $('regRecoveryModal');
  if (modal) {
    modal.classList.add('show');
    modal.closest('.auth-card')?.classList.add('rc-mode');
  }
}

export function hideRegRecoveryModal() {
  const modal = $('regRecoveryModal');
  if (modal) {
    modal.classList.remove('show');
    modal.closest('.auth-card')?.classList.remove('rc-mode');
  }
}

async function completeSignUp(recoveryEmail = '') {
  if (!_pendingRegData) return;
  const { cleaned, fn, p } = _pendingRegData;
  _pendingRegData = null;
  hideRegRecoveryModal();

  const authBtn = $('authBtn');
  if (authBtn) {
    authBtn.disabled = true;
    authBtn.textContent = 'Hisob yaratilmoqda...';
  }

  try {
    sessionStorage.setItem('spacemr_new_signup', '1');
    const { data, error } = await sb.auth.signUp({
      email: uToEmail(cleaned),
      password: p,
      options: {
        data: {
          username: cleaned,
          full_name: fn,
          avatar: defAvi(fn),
          recovery_email: recoveryEmail || '',
        }
      },
    });
    if (error) throw error;
    if (!data.session) {
      throw new Error('Supabase: Authentication → Email → "Confirm email" ni o\'chiring');
    }
  } catch (err) {
    console.error('Sign up error:', err);
    sessionStorage.removeItem('spacemr_new_signup');
    sessionStorage.removeItem('mrspace_new_signup');
    if (authBtn) {
      authBtn.disabled = false;
      authBtn.textContent = "Ro'yxatdan o'tish";
    }
    const known = _sbErrUz(err);
    const errEl = $('authErr');
    if (errEl) errEl.textContent = known;
    toast(known, 'error');
  }
}

const regRecoverySkipBtn = $('regRecoverySkipBtn');
if (regRecoverySkipBtn) {
  regRecoverySkipBtn.onclick = () => {
    completeSignUp('');
  };
}

const regRecoveryAddBtn = $('regRecoveryAddBtn');
if (regRecoveryAddBtn) {
  regRecoveryAddBtn.onclick = () => {
    const tipStep = $('regRecoveryStepTip');
    const inputStep = $('regRecoveryStepInput');
    const emailInp = $('regRecoveryEmailInput');
    if (tipStep) tipStep.style.display = 'none';
    if (inputStep) inputStep.style.display = 'block';
    if (emailInp) emailInp.focus();
  };
}

const regRecoveryBackBtn = $('regRecoveryBackBtn');
if (regRecoveryBackBtn) {
  regRecoveryBackBtn.onclick = () => {
    const tipStep = $('regRecoveryStepTip');
    const inputStep = $('regRecoveryStepInput');
    const errEl = $('regRecoveryEmailErr');
    const emailInp = $('regRecoveryEmailInput');
    if (errEl) errEl.textContent = '';
    if (emailInp) emailInp.classList.remove('input-error');
    if (inputStep) inputStep.style.display = 'none';
    if (tipStep) tipStep.style.display = 'block';
  };
}

const regRecoverySubmitBtn = $('regRecoverySubmitBtn');
if (regRecoverySubmitBtn) {
  regRecoverySubmitBtn.onclick = () => {
    const emailInp = $('regRecoveryEmailInput');
    const errEl = $('regRecoveryEmailErr');
    const val = emailInp?.value || '';

    const res = validateStrictEmail(val);
    if (!res.ok) {
      if (errEl) errEl.textContent = res.error;
      if (emailInp) {
        emailInp.classList.add('input-error');
        emailInp.focus();
      }
      if ('vibrate' in navigator) navigator.vibrate([14, 6, 14]);
      return;
    }

    if (errEl) errEl.textContent = '';
    if (emailInp) emailInp.classList.remove('input-error');
    completeSignUp(res.email);
  };
}

const regRecoveryEmailInput = $('regRecoveryEmailInput');
if (regRecoveryEmailInput) {
  regRecoveryEmailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('regRecoverySubmitBtn')?.click();
    }
  });
  regRecoveryEmailInput.addEventListener('input', () => {
    regRecoveryEmailInput.classList.remove('input-error');
    const errEl = $('regRecoveryEmailErr');
    if (errEl) errEl.textContent = '';
  });
}

