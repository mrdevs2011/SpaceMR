/**
 * Admin — Foydalanuvchi parolini tiklash (OTP / recovery code).
 *
 * Parol to'g'ridan-to'g'ri O'ZGARTIRILMAYDI.
 * Xuddi "Parolni unutdingizmi" kabi 8 xonali bir martalik tiklash kodi (OTP)
 * yaratiladi va profiles.recovery_code ga 24 soatga yoziladi.
 * Foydalanuvchi bu kod orqali tizimga kirib o'zi yangi parol belgilaydi.
 */
import { sb, state } from '../core/config.js';
import { toast } from '../ui/toast.js';
import { $, esc, lockScroll, unlockScroll, copyToClipboard } from '../core/utils.js';

/* ── Konstantalar ───────────────────────────────────────────────────────── */
const OTP_LENGTH = 8;

/* ── 8 xonali tasodifiy OTP kodi ───────────────────────────────────────── */
function genOTP() {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all    = upper + lower + digits;

  const chars = [
    upper [Math.floor(Math.random() * upper.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
    digits[Math.floor(Math.random() * digits.length)],
    lower [Math.floor(Math.random() * lower.length)],
    lower [Math.floor(Math.random() * lower.length)],
    lower [Math.floor(Math.random() * lower.length)],
    all   [Math.floor(Math.random() * all.length)],
  ];

  for (let i = OTP_LENGTH - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/* ── Email maskalash ────────────────────────────────────────────────────── */
function maskEmail(email) {
  if (!email?.includes('@')) return '';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0] || '*'}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

/* ── State ──────────────────────────────────────────────────────────────── */
let _uid  = null;
let _code = '';
let _regenRot = 0;

/* ── UI yordamchilar ────────────────────────────────────────────────────── */
function closeOverlay() {
  const ov = $('adminResetPwdOverlay');
  if (ov) ov.style.display = 'none';
  unlockScroll('adminResetPwdOverlay');
}

function showStep(step) {
  const confirm = $('adminResetPwdStepConfirm');
  const result  = $('adminResetPwdStepResult');
  if (confirm) confirm.style.display = step === 'confirm' ? 'block' : 'none';
  if (result)  result.style.display  = step === 'result'  ? 'block' : 'none';
}

/* ── Asosiy eksport ─────────────────────────────────────────────────────── */
export function adminResetPassword(uid, displayName) {
  if (!state.me?.isAdmin) { toast('Ruxsat yo\'q', 'error'); return; }
  if (!uid) return;

  _uid  = uid;
  _code = genOTP();

  const ov = $('adminResetPwdOverlay');
  if (!ov) { console.error('[adminResetPassword] overlay topilmadi'); return; }

  /* Confirm bosqich uchun maydonlarni to'ldirish */
  const userSubtitle = $('adminResetPwdUserSubtitle');
  const warnText     = $('adminResetWarnText');
  const tempInput    = $('adminResetTempPwdInput');
  const submitBtn    = $('adminResetSubmitBtn');

  if (userSubtitle) userSubtitle.textContent = displayName || 'Tanlangan foydalanuvchi';
  if (tempInput)    tempInput.value = _code;
  if (submitBtn) {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Tiklash kodini yaratish';
  }

  /* Warn matnini xavfsiz to'ldirish */
  if (warnText) {
    warnText.textContent =
      "Foydalanuvchining joriy paroli o'chirilmaydi. Xavfsiz bir martalik tiklash kodi (OTP) " +
      "yaratiladi. Agar zaxira email bo'lsa, xat yuboriladi. " +
      "Foydalanuvchi ushbu kod orqali tizimga kirib o'ziga yangi parol o'rnatishi mumkin.";
  }

  showStep('confirm');
  ov.style.display = 'flex';
  lockScroll('adminResetPwdOverlay');

  /* Backdrop click → yopish */
  ov.onclick = (e) => { if (e.target === ov) closeOverlay(); };

  /* Qayta yaratish (regen) */
  const regenBtn = $('adminResetRegenBtn');
  if (regenBtn) {
    regenBtn.onclick = () => {
      _code = genOTP();
      if (tempInput) tempInput.value = _code;
      const svg = regenBtn.querySelector('svg');
      if (svg) {
        _regenRot += 360;
        svg.style.transition = 'transform 0.4s cubic-bezier(.4,0,.2,1)';
        svg.style.transform  = `rotate(${_regenRot}deg)`;
      }
    };
  }

  /* Bekor qilish */
  const cancelBtn = $('adminResetCancelBtn');
  if (cancelBtn) cancelBtn.onclick = closeOverlay;

  /* Tayyor (result screen) */
  const doneBtn = $('adminResetDoneBtn');
  if (doneBtn) doneBtn.onclick = closeOverlay;

  /* Nusxalash (result screen) */
  const copyBtn = $('adminResetCopyBtn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      copyToClipboard(_code);
      toast('Nusxalandi', 'success');
    };
  }

  /* Tasdiqlash — RPC orqali OTP saqlash */
  if (submitBtn) {
    submitBtn.onclick = async () => {
      submitBtn.disabled    = true;
      submitBtn.textContent = 'Yuklanmoqda...';

      try {
        const { data, error } = await sb.rpc('admin_reset_user_password', {
          p_uid:          _uid,
          p_temp_password: _code,
        });

        if (error) throw new Error(error.message);

        /* Result screen */
        const resultEl   = $('adminResetResultPwdText');
        const subtitleEl = $('adminResetResultSubtitle');

        if (resultEl) resultEl.textContent = _code;

        if (subtitleEl) {
          if (data?.masked_email) {
            subtitleEl.textContent =
              `Tiklash kodi tayyorlandi. Foydalanuvchida zaxira email bor (${esc(data.masked_email)}). ` +
              `Siz uni to'g'ridan-to'g'ri uning pochtasiga yuborishingiz yoki kodni o'ziga berishingiz mumkin:`;
          } else {
            subtitleEl.textContent =
              "Foydalanuvchida zaxira email yo'q. " +
              "Quyidagi bir martalik tiklash kodini (OTP) foydalanuvchiga taqdim eting:";
          }
        }

        const sendEmailBtn = $('adminResetSendEmailBtn');
        if (sendEmailBtn) {
          if (data?.masked_email) {
            sendEmailBtn.style.display = 'block';
            sendEmailBtn.onclick = async () => {
              const oldTxt = sendEmailBtn.textContent;
              sendEmailBtn.disabled = true;
              sendEmailBtn.textContent = 'Yuborilmoqda...';
              try {
                const { error: fnErr } = await sb.functions.invoke('send-recovery-email', {
                  body: { username: data.username, temp_password: _code }
                });
                if (fnErr) throw fnErr;
                toast('Xat yuborildi!', 'success');
                sendEmailBtn.style.display = 'none';
              } catch (e) {
                toast('Xatolik: ' + e.message, 'error');
                sendEmailBtn.disabled = false;
                sendEmailBtn.textContent = oldTxt;
              }
            };
          } else {
            sendEmailBtn.style.display = 'none';
          }
        }

        showStep('result');
        toast('Tiklash kodi tayyor', 'success');
      } catch (err) {
        console.error('[adminResetPassword]', err);
        toast('Xatolik: ' + err.message, 'error');
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Tiklash kodini yaratish';
      }
    };
  }
}
