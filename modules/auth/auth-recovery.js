/**
 * auth-recovery.js — parolni unutish / tiklash (kod + yangi parol)
 * auth.js dan ehtiyotkor ajratilgan.
 */
import { sb } from '../core/config.js';
import { $, esc } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { bindEye, bindMeter, shake } from './pwd-ui.js';
import { markPasswordLogin } from './device-sessions.js';

const cleanUsername = u => String(u || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

/* ── Parolni unutdingizmi? (8 xonali vaqtinchalik parol) ───────────── */
let _lastTestedUsername = '';
let _lastRecoveryInfo = null;

export function showForgotPasswordBtn(username, recInfo) {
  _lastTestedUsername = username;
  _lastRecoveryInfo = recInfo;
  const wrap = $('forgotPasswordWrap');
  if (wrap) wrap.style.display = 'block';
  const btn = $('forgotPasswordBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Parolni unutdingizmi?';
    btn.style.color = 'var(--tg-primary-blue,#1d9bf0)';
    btn.style.cursor = 'pointer';
  }
  const hintEl = $('forgotPasswordHint');
  if (hintEl) {
    hintEl.style.display = 'none';
    hintEl.textContent = '';
  }
}

export function hideForgotPasswordBtn() {
  _lastTestedUsername = '';
  _lastRecoveryInfo = null;
  const wrap = $('forgotPasswordWrap');
  if (wrap) wrap.style.display = 'none';
  const btn = $('forgotPasswordBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Parolni unutdingizmi?';
    btn.style.color = 'var(--tg-primary-blue,#1d9bf0)';
    btn.style.cursor = 'pointer';
  }
  const hintEl = $('forgotPasswordHint');
  if (hintEl) {
    hintEl.style.display = 'none';
    hintEl.textContent = '';
  }
}

/** 8 xonali aralash vaqtinchalik parol (masalan: Q123eqwe) */
function gen8CharTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;

  // Kamida 1 ta katta harf, raqamlar va kichik harflar
  const chars = [
    upper[Math.floor(Math.random() * upper.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
    lower[Math.floor(Math.random() * lower.length)],
    lower[Math.floor(Math.random() * lower.length)],
    lower[Math.floor(Math.random() * lower.length)],
    all[Math.floor(Math.random() * all.length)]
  ];

  // Chalkashtirish (Fisher-Yates)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const forgotPasswordBtn = $('forgotPasswordBtn');
if (forgotPasswordBtn) {
  forgotPasswordBtn.onclick = async () => {
    const u = _lastTestedUsername || cleanUsername($('aUsername')?.value);
    if (!u) {
      toast('Foydalanuvchi nomini kiriting', 'error');
      $('aUsername')?.focus();
      return;
    }

    let recInfo = _lastRecoveryInfo;
    if (!recInfo || _lastTestedUsername !== u) {
      try {
        const { data } = await sb.rpc('check_user_recovery', { p_username: u });
        recInfo = data;
        _lastRecoveryInfo = data;
        _lastTestedUsername = u;
      } catch (_) {}
    }

    if (recInfo && !recInfo.exists) {
      toast('Bunday foydalanuvchi topilmadi', 'error');
      return;
    }

    if (recInfo && !recInfo.has_recovery) {
      toast("Ushbu hisobda zaxira email ko'rsatilmagan. Administrator bilan bog'laning", 'warning');
      return;
    }

    // Avtomatik email yubormaymiz! Yagona sodda tiklash kartasini ochamiz:
    openRecoveryModal(u, recInfo.masked_email || 'Emailingiz');
  };
}

/* ── Parolni tiklash oynasi (3 qadam: email → kod → yangi parol) ───── */
const recoveryModal = $('recoveryModal');
const rcCard = $('rcCard');
const rcTitle = $('rcTitle');
const rcDots = $('rcDots');
const rcStepBack = $('rcStepBack');
const recoveryTargetEmail = $('recoveryTargetEmail');
const recoveryModalSubtitle = $('recoveryModalSubtitle');
const recoverySendBtn = $('recoverySendBtn');
const recoverySendStatus = $('recoverySendStatus');
const recoveryBackBtn = $('recoveryBackBtn');
const recoverySubmitBtn = $('recoverySubmitBtn');
const recoveryCodeInp = $('recoveryCodeInp');
const recoveryNewPwdInp = $('recoveryNewPwdInp');
const recoveryConfirmPwdInp = $('recoveryConfirmPwdInp');
const recoveryErr = $('recoveryErr');
const rcOtp = $('rcOtp');
const rcResendBtn = $('rcResendBtn');
const rcToStep3 = $('rcToStep3');
const cells = [...(rcOtp?.querySelectorAll('.rc-cell') || [])];

bindEye(recoveryModal);
bindMeter({
  input: recoveryNewPwdInp, confirm: recoveryConfirmPwdInp,
  meter: $('rcMeter'), text: $('rcMeterText'), match: $('rcMatch'),
});

let _activeRecoveryUsername = '';
let _activeMaskedEmail = '';
let _resendTimer = null;
let _step = 1;

function showErr(msg) {
  if (recoveryErr) { recoveryErr.textContent = msg; recoveryErr.style.display = 'block'; }
  shake(rcCard);
}
function clearErr() {
  if (recoveryErr) { recoveryErr.textContent = ''; recoveryErr.style.display = 'none'; }
}

function showStep(n) {
  _step = n;
  clearErr();
  recoveryModal?.querySelectorAll('.rc-step').forEach(s => {
    s.classList.toggle('on', Number(s.dataset.step) === n);
  });
  rcDots?.querySelectorAll('i').forEach((d, i) => {
    d.classList.toggle('on', i === n - 1);
    d.classList.toggle('done', i < n - 1);
  });
  if (rcStepBack) rcStepBack.hidden = n === 1;
  const masked = _activeMaskedEmail || 'zaxira emailingiz';
  const texts = {
    1: ['Parolni tiklash', 'Zaxira emailingizga tasdiqlash kodi yuboramiz.'],
    2: ['Kodni kiriting', `${masked} manziliga yuborilgan 8 belgili kodni kiriting.`],
    3: ['Yangi parol', 'Hisobingiz uchun yangi parol belgilang.'],
  }[n];
  if (rcTitle) rcTitle.textContent = texts[0];
  if (recoveryModalSubtitle) recoveryModalSubtitle.textContent = texts[1];
  setTimeout(() => {
    if (n === 2) (cells.find(c => !c.value) || cells[0])?.focus();
    if (n === 3) recoveryNewPwdInp?.focus();
  }, 120);
}

/* ── 8 katakli kod ── */
function syncCode() {
  const code = cells.map(c => c.value).join('');
  if (recoveryCodeInp) recoveryCodeInp.value = code;
  cells.forEach(c => c.classList.toggle('filled', !!c.value));
  if (rcToStep3) rcToStep3.disabled = code.length < cells.length;
}
function fillCells(str, start = 0) {
  let i = start;
  for (const ch of String(str).replace(/\s+/g, '')) {
    if (i >= cells.length) break;
    cells[i++].value = ch;
  }
  syncCode();
  cells[Math.min(i, cells.length - 1)]?.focus();
}
cells.forEach((cell, idx) => {
  cell.addEventListener('focus', () => cell.select());
  cell.addEventListener('input', () => {
    const v = cell.value.replace(/\s+/g, '');
    clearErr();
    if (v.length > 1) { cell.value = ''; fillCells(v, idx); return; }   // paste / avto-to'ldirish
    cell.value = v;
    syncCode();
    if (v && idx < cells.length - 1) cells[idx + 1].focus();
  });
  cell.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !cell.value && idx > 0) {
      e.preventDefault();
      cells[idx - 1].value = '';
      syncCode();
      cells[idx - 1].focus();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault(); cells[idx - 1].focus();
    } else if (e.key === 'ArrowRight' && idx < cells.length - 1) {
      e.preventDefault(); cells[idx + 1].focus();
    } else if (e.key === 'Enter' && rcToStep3 && !rcToStep3.disabled) {
      e.preventDefault(); rcToStep3.click();
    }
  });
  cell.addEventListener('paste', e => {
    e.preventDefault();
    fillCells(e.clipboardData?.getData('text') || '', idx);
  });
});

function startResendTimer(sec = 45) {
  if (_resendTimer) clearInterval(_resendTimer);
  if (!rcResendBtn) return;
  rcResendBtn.disabled = true;
  rcResendBtn.textContent = `Qayta yuborish (${sec}s)`;
  _resendTimer = setInterval(() => {
    sec--;
    if (sec <= 0) {
      clearInterval(_resendTimer); _resendTimer = null;
      rcResendBtn.disabled = false;
      rcResendBtn.textContent = 'Qayta yuborish';
    } else {
      rcResendBtn.textContent = `Qayta yuborish (${sec}s)`;
    }
  }, 1000);
}

export function openRecoveryModal(username, maskedEmail, prefilledCode = '') {
  _activeRecoveryUsername = username;
  _activeMaskedEmail = maskedEmail || _activeMaskedEmail || '';
  if (!recoveryModal) return;

  if (recoveryTargetEmail) recoveryTargetEmail.textContent = _activeMaskedEmail || 'Zaxira emailingiz';
  if (recoverySendStatus) recoverySendStatus.style.display = 'none';
  if (recoverySendBtn) { recoverySendBtn.disabled = false; recoverySendBtn.textContent = 'Emailga kod yuborish'; }
  if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }
  if (rcResendBtn) { rcResendBtn.disabled = true; rcResendBtn.textContent = 'Qayta yuborish'; }

  cells.forEach(c => { c.value = ''; });
  syncCode();
  [recoveryNewPwdInp, recoveryConfirmPwdInp].forEach(inp => {
    if (!inp) return;
    inp.value = '';
    if (inp.type === 'text') recoveryModal.querySelector(`.pw-eye[data-target="${inp.id}"]`)?.click();
  });
  recoveryNewPwdInp?.dispatchEvent(new Event('input'));

  recoveryModal.style.display = 'flex';

  if (prefilledCode) {
    // parol maydoniga yozilgan kod allaqachon tasdiqlangan — to'g'ridan-to'g'ri 3-qadam
    fillCells(prefilledCode);
    if (recoveryCodeInp) recoveryCodeInp.value = prefilledCode.trim();
    showStep(3);
    if (recoveryModalSubtitle) recoveryModalSubtitle.textContent = 'Kod qabul qilindi. Yangi parolni belgilang.';
  } else {
    showStep(1);
  }
}

function closeRecoveryModal() {
  if (recoveryModal) recoveryModal.style.display = 'none';
  if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }
  clearErr();
}

/* ── Kod yuborish (1-qadam tugmasi va "Qayta yuborish") ── */
async function sendCode(triggerBtn) {
  const u = _activeRecoveryUsername || $('aUsername')?.value.trim().toLowerCase();
  if (!u) { toast('Foydalanuvchi nomini kiriting', 'error'); return; }

  [recoverySendBtn, rcResendBtn].forEach(b => { if (b) b.disabled = true; });
  triggerBtn.textContent = 'Yuborilmoqda...';
  clearErr();

  try {
    // Har safar yangi kod yaratiladi — bazada eski barcha kodlar avtomatik eskiradi
    const tempPassword = gen8CharTempPassword();
    const resp = await sb.functions.invoke('send-recovery-email', {
      body: { username: u, temp_password: tempPassword }
    });
    const data = resp.data;
    if (resp.error || !data?.ok) {
      throw new Error(data?.error || resp.error?.message || "Server bilan bog'lanishda xatolik");
    }
    if (!data.email_sent) {
      throw new Error(data.error_detail || 'Email yuborishda xatolik yuz berdi');
    }

    const masked = data.masked_email || _activeMaskedEmail || '';
    if (masked) {
      _activeMaskedEmail = masked;
      if (recoveryTargetEmail) recoveryTargetEmail.textContent = masked;
    }
    toast(`Yangi kod ${masked || 'emailingiz'} ga yuborildi. Eski kodlar bekor qilindi`, 'success', 5000);

    cells.forEach(c => { c.value = ''; });
    syncCode();
    showStep(2);
    startResendTimer(45);
  } catch (err) {
    console.error('[recovery send] error:', err);
    showErr(err.message || 'Email yuborishda xatolik yuz berdi');
    if (rcResendBtn) rcResendBtn.disabled = false;
  } finally {
    if (recoverySendBtn) { recoverySendBtn.disabled = false; recoverySendBtn.textContent = 'Emailga kod yuborish'; }
    // "Qayta yuborish" matnini taymer o'zi boshqaradi; xato bo'lsa (taymer yo'q) tiklaymiz
    if (rcResendBtn && !_resendTimer) { rcResendBtn.disabled = false; rcResendBtn.textContent = 'Qayta yuborish'; }
  }
}

if (recoverySendBtn) recoverySendBtn.onclick = () => sendCode(recoverySendBtn);
if (rcResendBtn) rcResendBtn.onclick = () => sendCode(rcResendBtn);

/* ── 2-qadam: kodni tekshirib, 3-qadamga o'tish ── */
if (rcToStep3) {
  rcToStep3.onclick = async () => {
    const u = _activeRecoveryUsername || $('aUsername')?.value.trim().toLowerCase();
    const code = recoveryCodeInp?.value.trim() || '';
    if (code.length < cells.length) return showErr("8 xonali kodni to'liq kiriting");

    const idle = rcToStep3.textContent;
    rcToStep3.disabled = true;
    rcToStep3.textContent = 'Tekshirilmoqda...';
    let ok = true;
    try {
      const { data } = await sb.rpc('verify_recovery_code', { p_username: u, p_code: code });
      if (data && data.valid === false) ok = false;
    } catch (_) { /* server tekshiruvi oxirgi qadamda ham bor */ }
    rcToStep3.textContent = idle;
    rcToStep3.disabled = false;

    if (!ok) return showErr("Kod noto'g'ri yoki muddati o'tgan");
    showStep(3);
  };
}

/* ── Orqaga ── */
if (rcStepBack) rcStepBack.onclick = () => showStep(Math.max(1, _step - 1));
if (recoveryBackBtn) {
  recoveryBackBtn.onclick = () => {
    closeRecoveryModal();
    $('aPassword')?.focus();
  };
}

/* ── 3-qadam: yangi parolni saqlash ── */
if (recoverySubmitBtn) {
  recoverySubmitBtn.onclick = async () => {
    const u = _activeRecoveryUsername || $('aUsername')?.value.trim().toLowerCase();
    const code = recoveryCodeInp?.value.trim() || '';
    const newPwd = recoveryNewPwdInp?.value || '';
    const confirmPwd = recoveryConfirmPwdInp?.value || '';

    recoveryNewPwdInp?.classList.remove('input-error');
    recoveryConfirmPwdInp?.classList.remove('input-error');

    if (!code) { showStep(2); return showErr('8 xonali tasdiqlash kodini kiriting'); }
    if (newPwd.length < 6) {
      recoveryNewPwdInp?.classList.add('input-error');
      return showErr("Yangi parol kamida 6 ta belgidan iborat bo'lishi kerak");
    }
    if (newPwd !== confirmPwd) {
      recoveryConfirmPwdInp?.classList.add('input-error');
      return showErr('Yangi parollar bir-biriga mos kelmadi');
    }

    recoverySubmitBtn.disabled = true;
    recoverySubmitBtn.textContent = 'Tekshirilmoqda...';
    clearErr();

    try {
      const { data, error } = await sb.rpc('reset_password_with_code', {
        p_username: u,
        p_code: code,
        p_new_password: newPwd,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || 'Parolni yangilashda xatolik');

      closeRecoveryModal();
      toast('Parolingiz muvaffaqiyatli yangilandi!', 'success');

      // Yangi parol bilan avtomatik tizimga kirish
      const actualEmail = data.email || (u.includes('@') ? u : `${u}@mrspace.local`);
      const { error: signErr } = await sb.auth.signInWithPassword({
        email: actualEmail,
        password: newPwd,
      });
      if (signErr) {
        $('aUsername').value = u;
        $('aPassword').value = newPwd;
        toast('Yangi parolingiz bilan "Kirish" tugmasini bosing', 'info');
      } else {
        try { await markPasswordLogin(); } catch (_) {}
      }
    } catch (err) {
      console.error('[reset_password_with_code] error:', err);
      const msg = err.message || "Tasdiqlash kodi noto'g'ri";
      if (/kod|code/i.test(msg)) showStep(2);
      showErr(msg);
    } finally {
      recoverySubmitBtn.disabled = false;
      recoverySubmitBtn.textContent = 'Parolni yangilash va kirish';
    }
  };
}
