import { sb, state, uploadViaController, mapProfile, mapPost, purgeUserMedia, verifyPassword } from '../core/config.js';
import { $, esc, defAvi, uToEmail, lockScroll, unlockScroll, showConfirm } from '../core/utils.js';
import { toast }                       from '../ui/toast.js';
import { initPush, removePushToken, areNotificationsEnabled, setNotificationsEnabled, notificationsUserDisabled } from '../push.js';
import { startChatsWatcher, stopChatsWatcher, repaintNoticeBanner } from '../chat/chat.js';
import { startBus, stopBus, busOn, trackPresence, untrackPresence } from '../core/rt-bus.js';
import { startCallWatcher, stopCallWatcher } from '../call/call.js';
import { clearAllCache, cachePosts, getCachedPosts, clearRuntimeCache, getCachedProfile } from '../core/local-cache.js';
import { openAviCrop } from '../ui/avi-crop.js';
import { initAuthSettings, paintSettingsRecoveryRow } from './auth-settings.js';
import { bindEye, bindMeter, shake } from './pwd-ui.js';
import { maybeShowGuideCard } from '../ui/install-guide.js';
import { showForgotPasswordBtn, hideForgotPasswordBtn, openRecoveryModal } from './auth-recovery.js';
import { initRegRecovery, openRegRecoveryModal } from './auth-reg-recovery.js';
import { initAuthPending, showPendingScreen, hidePendingScreen } from './auth-pending.js';

/* ── Server vaqti sinxronizatsiyasi ────────────────────────────────────
   Foydalanuvchi lokal soatini o'zgartirsa ham ban muddati to'g'ri ishlaydi.
   Supabase server_now() dan real vaqt olib, local offset saqlanadi.
   serverNow() => real server vaqti (ms) — Date.now() o'rniga ishlatiladi.

   ESLATMA (tuzatish): ilgari offline bo'lganda offset 0 ga qaytarilar edi —
   ya'ni serverNow() aslida "Date.now()" bilan bir xil bo'lib qolardi. Bu
   degani: foydalanuvchi telefon SOATINI oldinga surib, vaqtli blokning
   "muddati o'tgan" ko'rinishini offline holatda ham hosil qila olardi.
   Endi performance.now() — apparat darajasidagi MONOTONIK taymerdan
   foydalanamiz: bu taymer tizim sanasi/vaqti o'zgartirilsa ham ta'sirlanmaydi
   (faqat qurilma qayta yoqilsa yoki sahifa qayta yuklansa sinxronlanadi).
   Shu bilan "soatni oldinga surib blokdan qochish" firibgarligi online
   bo'lsin, offline bo'lsin — sinxronizatsiya bir marta bo'lgan bo'lsa —
   butunlay yopiladi. ─────────────────────────────────────────────────── */
let _serverTimeOffset = 0; // legacy — endi to'g'ridan-to'g'ri ishlatilmaydi, moslik uchun saqlangan
let _serverTimeSynced = false;
let _syncedServerMs = null; // oxirgi sinxronizatsiyadagi server vaqti (ms)
let _syncedPerf      = null; // o'sha paytdagi performance.now() (monotonik nuqta)

async function _syncServerTime() {
  // Offline bo'lsa urinmaymiz — oldingi sinxronlangan qiymatlar saqlanadi
  // (aks holda soatni surib blokdan qochish mumkin bo'lib qolardi).
  if (!navigator.onLine) return;
  try {
    const t0 = performance.now();
    const { data, error } = await sb.rpc('server_now');
    if (error || !data) throw error || new Error('server_now bo\'sh');
    const rtt = performance.now() - t0;
    const serverMs = Date.parse(data) + rtt / 2;
    _syncedServerMs   = serverMs;
    _syncedPerf       = performance.now();
    _serverTimeOffset = serverMs - Date.now();
    _serverTimeSynced = true;
  } catch (err) {
    console.warn('[Auth] Server vaqti sinxronizatsiya xatosi:', err?.message);
    // Oldingi _syncedServerMs/_syncedPerf qiymatlarini SAQLAB QOLAMIZ.
  }
}

/** Hozirgi haqiqiy server vaqti (ms). Date.now() o'rniga ishlating. */
function serverNow() {
  if (_syncedServerMs != null && _syncedPerf != null) {
    // Monotonik hisob — tizim sanasi/vaqti o'zgartirilsa ham to'g'ri.
    return _syncedServerMs + (performance.now() - _syncedPerf);
  }
  // Hali birorta sinxronizatsiya bo'lmagan bo'lsa (masalan ilova internetsiz
  // birinchi marta ochilgan) — noiloj tizim soatiga tayanamiz.
  return Date.now();
}

/* ── Offline holatda "oxirgi tasdiqlangan holat" keshi ──────────────────
   MUAMMO: avval offline bo'lganda Firestore SDK ning O'ZI qaytargan
   (tarmoqqa yetib bormagan, ya'ni ehtimol ESKI) kesh hujjatiga to'liq
   ishonilardi. Agar admin sizni bloklagan payt siz allaqachon offline
   bo'lsangiz (yoki bloklangandan keyin offline bo'lib qolsangiz), keshdagi
   "blocked: false" ma'lumoti abadiy ishlatilaverar edi.

   YECHIM: har safar SERVERDAN tasdiqlangan (fromCache=false) holatni
   localStorage'ga yozib boramiz. Keyingi safar profil so'rovi natijasi
   fromCache=true (ya'ni internetga yetib bormagan) bo'lsa, ushbu oxirgi
   tasdiqlangan holatga qaraymiz — agar u "blocked" bo'lsa, offline bo'lsa
   ham ilovaga kiritilmaydi. Bundan tashqari, tasdiqlangan holat juda eski
   bo'lsa (OFFLINE_TRUST_MS dan ko'p), "internetga ulaning" ekrani chiqadi —
   ya'ni abadiy offline yurib, tekshiruvdan MUTLAQO qochib bo'lmaydi. ─── */
const OFFLINE_TRUST_MS = 24 * 60 * 60 * 1000; // 24 soat (avval 15 daqiqa edi)

function _verifiedKey(uid) { return `mrg_verified_${uid}`; }

function _saveVerifiedState(uid, data) {
  try {
    const blockedUntilMs = data.blockedUntil || null;
    localStorage.setItem(_verifiedKey(uid), JSON.stringify({
      blocked:      data.blocked === true,
      blockedUntil: blockedUntilMs,
      approved:     data.approved,
      at:           Date.now(),
    }));
  } catch(_) {}
}

function _getVerifiedState(uid) {
  try {
    const raw = localStorage.getItem(_verifiedKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch(_) { return null; }
}

/** Offline/ishonchsiz (fromCache) holatda kirish qarorini qabul qiladi.
 * true qaytarsa — ilovaga kiritish MUMKIN (bloklanmagan yoki hali
 * tekshirilmagan yangi qurilma). false qaytarsa — blocked/pending ekran
 * ko'rsatilishi kerak (chaqiruvchi buni o'zi bajaradi). */
function _offlineAccessDecision(uid) {
  const vs = _getVerifiedState(uid);
  if (!vs) return { allow: true, reason: 'no-verified-state' };

  const age = Date.now() - (vs.at || 0);
  if (vs.blocked && (!vs.blockedUntil || vs.blockedUntil > serverNow())) {
    return { allow: false, blocked: true, blockedUntil: vs.blockedUntil };
  }
  if (age > OFFLINE_TRUST_MS) {
    return { allow: false, needsVerify: true };
  }
  return { allow: true, reason: 'verified-clean' };
}

/* ── Render callbacks injected by script.js ──────────────────────────── */
let _cb = {};
export function setRenderCallbacks(callbacks) {
  _cb = callbacks;
}

/* ── Auth form state ─────────────────────────────────────────────────── */
let isLogin = true;

const authSwitchBtn = $('authSwitchBtn');
if (authSwitchBtn) {
  authSwitchBtn.onclick = () => {
    isLogin = !isLogin;
    $('authTitle').textContent      = isLogin ? 'Hisobingizga kiring' : 'Hisob yaratish';
    $('authBtn').textContent        = isLogin ? 'Kirish' : 'Ro\'yxatdan o\'tish';
    $('authSwitchText').textContent = isLogin ? 'Hisobingiz yo\'qmi? ' : 'Hisobingiz bormi? ';
    authSwitchBtn.textContent       = isLogin ? 'Ro\'yxatdan o\'tish' : 'Kirish';
    $('nameRow').style.display      = isLogin ? 'none' : 'block';
    $('confirmRow').style.display   = isLogin ? 'none' : 'block';
    hideForgotPasswordBtn();
    $('authErr').textContent = '';
  };
}

/* ── Supabase xatolarini o'zbekchaga tarjima ─────────────────────────── */
function sbErrUz(err) {
  const msg = String(err?.message || '').toLowerCase();
  const code = err?.code || '';
  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'Foydalanuvchi nomi yoki parol xato';
  }
  if (msg.includes('already registered') || msg.includes('already been registered') || code === 'user_already_exists') {
    return 'Bu login allaqachon band';
  }
  if (msg.includes('password should be at least') || code === 'weak_password') {
    return `Parol kamida 6 ta belgi bo'lishi kerak`;
  }
  if (err?.status === 429 || msg.includes('rate limit') || msg.includes('too many')) {
    return `Juda ko'p urinish. Biroz kuting`;
  }
  if (msg.includes('failed to fetch') || msg.includes('network') || err?.name === 'AuthRetryableFetchError') {
    return `Internet aloqasi yo'q yoki serverga ulanish mumkin emas`;
  }
  if (msg.includes('banned') || msg.includes('disabled')) {
    return 'Bu hisob bloklangan';
  }
  return `Xatolik yuz berdi. Qayta urinib ko'ring`;
}

/** Login normalizatsiyasi: kichik harf, faqat a-z 0-9 _ */
const _cleanUsername = u => String(u || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

/** Username → auth email. Faqat DB'dagi joriy username orqali (email_for_username).
 *  Eski username topilmasa null — login ishlamaydi (username o'zgargach). */
async function _emailForLogin(cleaned) {
  try {
    const { data, error } = await sb.rpc('email_for_username', { p_username: cleaned });
    if (error) throw error;
    if (data) return data;
  } catch (e) {
    // Tarmoq xatosida oxirgi chora — taxmin (faqat RPC ishlamasa)
    console.warn('[auth] email_for_username:', e?.message || e);
    return uToEmail(cleaned);
  }
  return null; // username bazada yo'q
}

const authBtn = $('authBtn');
if (authBtn) {
  authBtn.onclick = async () => {
    const u = $('aUsername')?.value?.trim() || '';
    const p = $('aPassword')?.value || '';
    const e = $('authErr');

    /* ── Xato ko'rsatish: matn + shake + qizil border ── */
    const showErr = (msg, fields = []) => {
      e.textContent = msg;
      if ('vibrate' in navigator) navigator.vibrate([14, 6, 14, 6, 14]);

      ['aUsername','aPassword','aConfirm','aFullname'].forEach(id => {
        const el = $(id);
        if (el) el.classList.remove('input-error');
      });
      fields.forEach(id => {
        const el = $(id);
        if (el) el.classList.add('input-error');
      });

      const card = document.querySelector('.auth-card');
      if (card) {
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
      }
    };

    /* Inputga yozganda qizil border ketadi */
    ['aUsername','aPassword','aConfirm','aFullname'].forEach(id => {
      const el = $(id);
      if (el && !el._errListenerAdded) {
        el._errListenerAdded = true;
        el.addEventListener('input', () => {
          el.classList.remove('input-error');
          if (id === 'aUsername') hideForgotPasswordBtn();
        });
      }
    });

    /* ── Validatsiya ── */
    const cleaned = _cleanUsername(u);
    if (!cleaned) {
      showErr(`Foydalanuvchi nomi bo'sh bo'lishi mumkin emas`, ['aUsername']);
      return;
    }
    if (cleaned.length < 2) {
      showErr(`Foydalanuvchi nomi kamida 2 ta belgi (a-z, 0-9, _)`, ['aUsername']);
      return;
    }
    if (cleaned.length > 20) {
      showErr(`Foydalanuvchi nomi 20 ta belgidan oshmasligi kerak`, ['aUsername']);
      return;
    }
    if (!p || p.length < 6) {
      showErr(`Parol kamida 6 ta belgi bo'lishi kerak`, ['aPassword']);
      return;
    }
    e.textContent = '';
    authBtn.disabled = true;
    authBtn.textContent = isLogin ? 'Kirilmoqda...' : 'Hisob yaratilmoqda...';

    try {
      if (isLogin) {
        const email = await _emailForLogin(cleaned);
        if (!email) {
          throw new Error("Login yoki parol noto'g'ri");
        }
        let authData, authError;
        const res = await sb.auth.signInWithPassword({ email, password: p });
        authData = res.data;
        authError = res.error;

        if (authError && p.length === 8) {
          // Xato bo'lsa va kod 8 ta belgi bo'lsa (admin recovery code bo'lishi mumkin)
          const { data: recData } = await sb.rpc('reset_password_with_code', {
            p_username: cleaned,
            p_code: p,
            p_new_password: p
          });
          if (recData?.ok) {
            // Parol 8 xonali kodga o'zgardi, qayta kiramiz
            const secondTry = await sb.auth.signInWithPassword({ email, password: p });
            authData = secondTry.data;
            authError = secondTry.error;
            if (!authError) {
              setTimeout(() => {
                toast("Vaqtinchalik kod bilan kirdingiz. Sozlamalardan parolingizni yangilang.", "warning", 8000);
              }, 1000);
            }
          }
        }

        if (authError) throw authError;
        hideForgotPasswordBtn();
        if (authData?.user?.id) {
          _setLocalPwdTs(authData.user.id, Date.now());
        }
        try {
          await sb.from('profiles').update({
            last_login: new Date().toISOString(),
            last_user_agent: navigator.userAgent || null,
            last_platform: navigator.platform || null,
          }).eq('id', authData.user.id);
        } catch (_) { /* profil yo'q bo'lsa ham loginni to'xtatmaymiz */ }
        // onAuthStateChange o'zi ilovani yoki pending ekranni ko'rsatadi
        return;
      }

      const fn = $('aFullname').value.trim();
      const c  = $('aConfirm').value;

      if (!fn) {
        authBtn.disabled = false;
        authBtn.textContent = "Ro'yxatdan o'tish";
        showErr('Ismingizni kiriting', ['aFullname']);
        return;
      }
      if (p !== c) {
        authBtn.disabled = false;
        authBtn.textContent = "Ro'yxatdan o'tish";
        showErr('Parollar mos emas', ['aPassword','aConfirm']);
        return;
      }

      const { data: free, error: freeErr } = await sb.rpc('username_available', { p_username: cleaned });
      if (freeErr) throw freeErr;
      let isFree = free;
      if (isFree) {
        try {
          const { data: grpRows } = await sb.from('groups').select('id').ilike('username', cleaned).limit(1);
          if (grpRows && grpRows.length) isFree = false;
        } catch (_) {}
      }
      if (!isFree) {
        authBtn.disabled = false;
        authBtn.textContent = "Ro'yxatdan o'tish";
        showErr('Bu nom allaqachon band', ['aUsername']);
        return;
      }

      // Hamma tekshiruvlar to'liq o'tdi — zaxira email maslahat popupini ochamiz
      authBtn.disabled = false;
      authBtn.textContent = "Ro'yxatdan o'tish";

      openRegRecoveryModal({
        cleaned,
        fn,
        p,
      });
      return;
    } catch (err) {
      console.error('Auth error:', err?.code || '', err?.message);
      if (!isLogin) {
        sessionStorage.removeItem('spacemr_new_signup');
        sessionStorage.removeItem('mrspace_new_signup');
      }
      authBtn.disabled = false;
      authBtn.textContent = isLogin ? 'Kirish' : "Ro'yxatdan o'tish";
      const known = sbErrUz(err);
      if (known === 'Foydalanuvchi nomi yoki parol xato') {
        if (isLogin) {
          // 1. Agar foydalanuvchi emailga kelgan 8 xonali tasdiqlash kodini parol maydoniga kiritgan bo'lsa:
          if (p && p.trim().length >= 6) {
            try {
              const { data: vCode } = await sb.rpc('verify_recovery_code', {
                p_username: cleaned,
                p_code: p.trim(),
              });
              if (vCode && vCode.valid) {
                toast('Tasdiqlash kodi qabul qilindi. Yangi parolingizni belgilang!', 'info', 6000);
                openRecoveryModal(cleaned, vCode.masked_email || '', p.trim());
                return;
              }
            } catch (vErr) {
              console.warn('[verify_recovery_code] check:', vErr);
            }
          }

          showErr(known, ['aUsername','aPassword']);
          try {
            const { data: recInfo } = await sb.rpc('check_user_recovery', { p_username: cleaned });
            if (recInfo && recInfo.exists) {
              showForgotPasswordBtn(cleaned, recInfo);
            } else {
              hideForgotPasswordBtn();
            }
          } catch (_) {
            hideForgotPasswordBtn();
          }
        } else {
          showErr(known, ['aUsername','aPassword']);
        }
      } else if (known === 'Bu login allaqachon band') {
        showErr(known, ['aUsername']);
      } else if (known === `Parol kamida 6 ta belgi bo'lishi kerak`) {
        showErr(known, ['aPassword']);
      } else if (/Confirm email/.test(err?.message || '')) {
        showErr(err.message);
      } else {
        showErr(known);
      }
    }
  };
}

/* ── Qat'iy email validatsiyasi ────────────────────────────────────── */
export function validateStrictEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  if (!s) {
    return { ok: false, error: 'Email manzili kiritilmadi' };
  }
  if (s.length > 254) {
    return { ok: false, error: 'Email juda uzun (maksimal 254 belgi)' };
  }
  if (/\s/.test(s)) {
    return { ok: false, error: 'Email manzilida bo\'sh joy bo\'lishi mumkin emas' };
  }
  const atCount = (s.match(/@/g) || []).length;
  if (atCount !== 1) {
    return { ok: false, error: 'Emailda faqat bitta @ belgisi bo\'lishi kerak' };
  }

  const [localPart, domainPart] = s.split('@');
  if (!localPart || localPart.length < 1 || localPart.length > 64) {
    return { ok: false, error: 'Email bosh qismi noto\'g\'ri' };
  }
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return { ok: false, error: 'Email manzilida nuqtalar noto\'g\'ri qo\'yilgan' };
  }
  if (!domainPart || !domainPart.includes('.')) {
    return { ok: false, error: 'Email domeni to\'liq emas (masalan: @gmail.com)' };
  }
  if (domainPart.startsWith('.') || domainPart.endsWith('.') || domainPart.includes('..') || domainPart.startsWith('-') || domainPart.endsWith('-')) {
    return { ok: false, error: 'Email domenida xatolik bor' };
  }

  const parts = domainPart.split('.');
  const tld = parts[parts.length - 1];
  if (!tld || tld.length < 2 || !/^[a-z]+$/.test(tld)) {
    return { ok: false, error: 'Email domen kengaytmasi (.com, .uz...) noto\'g\'ri' };
  }

  const rfcRegex = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (!rfcRegex.test(s)) {
    return { ok: false, error: 'Email formati noto\'g\'ri' };
  }

  // Keng tarqalgan xato yozilgan domenlar tekshiruvi (typo check)
  const typos = [
    { bad: 'gmail.con', good: 'gmail.com' },
    { bad: 'gmai.com', good: 'gmail.com' },
    { bad: 'gamil.com', good: 'gmail.com' },
    { bad: 'gmial.com', good: 'gmail.com' },
    { bad: 'yaho.com', good: 'yahoo.com' },
    { bad: 'hotmial.com', good: 'hotmail.com' },
    { bad: 'outlok.com', good: 'outlook.com' },
  ];
  for (const t of typos) {
    if (domainPart === t.bad) {
      return { ok: false, error: `Email domenida xato: @${t.good} kiritmoqchimisiz?` };
    }
  }

  const fakeDomains = ['test.com', 'example.com', 'sample.com', 'asdf.com', 'test.uz', 'fake.com', 'aaa.com'];
  if (fakeDomains.includes(domainPart)) {
    return { ok: false, error: 'Iltimos, haqiqiy shaxsiy emailingizni kiriting' };
  }

  return { ok: true, email: s };
}

/* ── Profil holati kuzatuvi (blok / ruxsat / o'chirilish) ──────────────
 * Kirgan har bir user uchun: realtime (profiles qatori) + 60s zaxira
 * so'rov (realtime uzilib qolsa ham blok/ruxsat kechikmasin).
 * ─────────────────────────────────────────────────────────────────────── */
let _activeUserUnsub = null;
let _approvalListener = null;
let _currentUid = null;   // hozir ishlanayotgan sessiya (takroriy SIGNED_IN'dan himoya)
let _entering = false;    // _enterApp ikki marta parallel ishlamasin
let _shownKey = null;     // bir xil pending/blocked ekran qayta-qayta chizilmasin
const PROFILE_POLL_MS = 60 * 1000;

function _getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem('spacemr_device_id');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem('spacemr_device_id', id);
    }
  } catch (_) {
    id = 'dev-' + Date.now();
  }
  return id;
}

function _getLocalPwdTs(uid) {
  return Number(localStorage.getItem(`spacemr_pwd_ts_${uid}`) || 0);
}
function _setLocalPwdTs(uid, ts) {
  if (uid && ts) localStorage.setItem(`spacemr_pwd_ts_${uid}`, String(ts));
}

export async function notifyPasswordChanged(uid) {
  if (!uid) return;
  const now = Date.now();
  _setLocalPwdTs(uid, now);
  try {
    const ch = sb.channel('user-session-' + uid);
    await ch.subscribe();
    await ch.send({
      type: 'broadcast',
      event: 'password_changed',
      payload: { sessionId: _getDeviceId(), at: now }
    });
  } catch (err) {
    console.warn('[Auth] notifyPasswordChanged broadcast error:', err?.message);
  }
}

function _buildMe(user, p) {
  return {
    uid: user.id,
    email: user.email || p?.email || null,
    displayName: p?.fullName || '',
    photoURL: p?.avatar || null,
    username: p?.username || '',
    isAdmin: !!p?.isAdmin,
    mustChangePassword: !!p?.mustChangePassword,
    passwordChangedAt: p?.passwordChangedAt || null,
    recoveryEmail: p?.recoveryEmail || null,
  };
}

function _blockedUntilMs(p) {
  return p?.blockedUntil || null;
}

/** blocked=true, lekin muddati o'tgan bo'lsa — bloklanmagan hisoblanadi
 *  (DB'dagi is_approved() ham shunday qaraydi). */
function _isBlockedNow(p) {
  if (!p?.blocked) return false;
  const until = _blockedUntilMs(p);
  return !until || until > serverNow();
}

async function _fetchProfile(uid) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return mapProfile(data); // qator yo'q bo'lsa null
}

function _showOnce(reason, until = null) {
  try { (window.__spacemrHideSplash || window.__mrspaceHideSplash)?.('gate'); } catch (_) {}

  const key = reason + ':' + (until || '');
  if (_shownKey === key) return;
  _shownKey = key;
  showPendingScreen(reason, until);
}

function _stopUserWatch() {
  if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }
  if (_approvalListener) { _approvalListener(); _approvalListener = null; }
}

let _pendingForceLogout = false; // tab yashirin bo'lsa — fokusda chiqamiz

/** Hisob o'chirilgan / majburiy chiqish. Orqa tab darhol refresh qilmasin. */
function _requestForceSignOut(reason = '') {
  if (document.visibilityState === 'visible') {
    _forceSignOut();
    return;
  }
  _pendingForceLogout = true;
  console.warn('[Auth] Chiqish kechiktirildi (tab yashirin):', reason || 'force');
}

function _flushDeferredForceLogout() {
  if (!_pendingForceLogout) return;
  if (document.visibilityState !== 'visible') return;
  _pendingForceLogout = false;
  _forceSignOut();
}

async function _forceSignOut() {
  _pendingForceLogout = false;
  _stopUserWatch();
  _hideMandatoryPasswordResetModal();
  try { await Promise.race([removePushToken(), new Promise(r => setTimeout(r, 800))]); } catch (_) {}
  try { clearAllCache(); } catch (_) {}
  try { await sb.auth.signOut({ scope: 'local' }); } catch (_) {}
  try { await sb.auth.signOut({ scope: 'global' }); } catch (_) {}
  try {
    Object.keys(localStorage).forEach(k => {
      if (/supabase|spacemr|mrspace|sb-/i.test(k)) localStorage.removeItem(k);
    });
    Object.keys(sessionStorage).forEach(k => {
      if (/supabase|spacemr|mrspace|sb-/i.test(k)) sessionStorage.removeItem(k);
    });
  } catch (_) {}
  state.me = null;
  _currentUid = null;
  _shownKey = null;
  stopChatsWatcher();
  stopBus();
  stopCallWatcher();
  stopPresenceHeartbeat();
  const app = $('app');
  const authWrap = $('authWrap');
  if (app) app.classList.remove('show');
  if (authWrap) authWrap.classList.add('show');
  hidePendingScreen();
  location.replace('/');
}

let _mandatoryModalActive = false;

function _showMandatoryPasswordResetModal(me) {
  _mandatoryModalActive = true;
  const overlay = $('mandatoryPwdOverlay');
  if (!overlay) return;

  overlay.style.display = 'flex';
  lockScroll();

  const errEl = $('mandatoryPwdErr');
  if (errEl) errEl.textContent = '';

  const newInp = $('mNewPassword');
  const confInp = $('mConfirmPassword');
  const saveBtn = $('mandatoryPwdSaveBtn');
  const outBtn = $('mandatoryPwdSignOutBtn');

  if (newInp) { newInp.value = ''; newInp.classList.remove('input-error'); }
  if (confInp) { confInp.value = ''; confInp.classList.remove('input-error'); }

  bindEye(overlay);
  bindMeter({ input: newInp, confirm: confInp, meter: $('mMeter'), text: $('mMeterText'), match: $('mMatch') });
  [newInp, confInp].forEach(inp => {
    if (inp && inp.type === 'text') overlay.querySelector(`.pw-eye[data-target="${inp.id}"]`)?.click();
  });
  newInp?.dispatchEvent(new Event('input'));
  const _card = overlay.querySelector('.pw-card');

  if (outBtn) {
    outBtn.onclick = async () => {
      _hideMandatoryPasswordResetModal();
      await _forceSignOut();
    };
  }

  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Parolni saqlash va kirish';

    saveBtn.onclick = async () => {
      const p1 = newInp?.value || '';
      const p2 = confInp?.value || '';

      if (errEl) errEl.textContent = '';
      newInp?.classList.remove('input-error');
      confInp?.classList.remove('input-error');

      if (!p1 || p1.length < 6) {
        if (errEl) errEl.textContent = `Yangi parol kamida 6 ta belgi bo'lishi kerak`;
        newInp?.classList.add('input-error');
        newInp?.focus();
        shake(_card);
        return;
      }
      if (p1 !== p2) {
        if (errEl) errEl.textContent = 'Parollar bir-biriga mos kelmadi';
        confInp?.classList.add('input-error');
        confInp?.focus();
        shake(_card);
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saqlanmoqda...';

      try {
        const { error: pErr } = await sb.auth.updateUser({ password: p1 });
        if (pErr) throw pErr;

        try {
          await sb.rpc('user_password_updated');
        } catch (_) {
          await sb.from('profiles').update({
            must_change_password: false,
            password_changed_at: new Date().toISOString()
          }).eq('id', me.uid);
        }

        await notifyPasswordChanged(me.uid);

        me.mustChangePassword = false;
        _hideMandatoryPasswordResetModal();

        toast("Yangi parolingiz muvaffaqiyatli o'rnatildi!", 'success');
        await _enterApp(me);
      } catch (err) {
        console.error('[MandatoryPwdReset]', err);
        if (errEl) errEl.textContent = err.message || 'Xatolik yuz berdi';
        shake(_card);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Parolni saqlash va kirish';
      }
    };
  }
}

function _hideMandatoryPasswordResetModal() {
  _mandatoryModalActive = false;
  const overlay = $('mandatoryPwdOverlay');
  if (overlay) overlay.style.display = 'none';
  unlockScroll();
}

/** Profilning eng so'nggi holatiga qarab ekranni to'g'irlaydi (idempotent). */
async function _onLiveProfile(p, me) {
  if (!p) return;
  _saveVerifiedState(me.uid, p);
  Object.assign(me, _buildMe({ id: me.uid, email: me.email }, p));

  const appEl = $('app');
  const isInApp = !!(appEl && appEl.classList.contains('show'));

  // 0. Boshqa qurilmada parol yangilangan bo'lsa darhol logout qilish (kamida 60s farq bilan)
  const knownPwdTs = _getLocalPwdTs(me.uid);
  if (p.passwordChangedAt && knownPwdTs && (p.passwordChangedAt - knownPwdTs > 60000)) {
    console.warn('[Auth] Parol boshqa qurilmada yangilandi (ts tekshiruvi). Chiqilmoqda...');
    toast('Parolingiz boshqa qurilmada o\'zgartirildi. Iltimos, qayta kiring', 'warning');
    await _forceSignOut();
    return;
  }

  // 1. Bloklangan (muddati o'tmagan)
  if (_isBlockedNow(p)) {
    if (isInApp) {
      stopChatsWatcher();
      stopBus();
      stopCallWatcher();
      stopPresenceHeartbeat();
      appEl.classList.remove('show');
    }
    _showOnce('blocked', _blockedUntilMs(p));
    return;
  }

  // 2. Parolni majburiy yangilash talabi (admin tomonidan reset qilingan)
  if (p.mustChangePassword === true) {
    if (isInApp) {
      stopChatsWatcher();
      stopBus();
      stopCallWatcher();
      stopPresenceHeartbeat();
      appEl.classList.remove('show');
    }
    hidePendingScreen();
    _showMandatoryPasswordResetModal(me);
    return;
  } else {
    _hideMandatoryPasswordResetModal();
  }

  // 3. Ruxsat berilgan
  if (p.approved === true) {
    if (!isInApp && !_entering) {
      hidePendingScreen();
      _shownKey = null;
      await _enterApp(me);
    }
    return;
  }

  // 4. Pending yoki rejected (sessiyani o'chirib yubormasdan ekranni ko'rsatish)
  if (p.approved === 'rejected') {
    if (isInApp) {
      stopChatsWatcher();
      stopBus();
      stopCallWatcher();
      stopPresenceHeartbeat();
      appEl.classList.remove('show');
    }
    _showOnce('rejected');
    return;
  }
  if (p.approved === false) {
    if (isInApp) {
      stopChatsWatcher();
      stopBus();
      stopCallWatcher();
      stopPresenceHeartbeat();
      appEl.classList.remove('show');
    }
    _showOnce('pending');
  }
}

function _startRealtimeUserWatch(me) {
  _stopUserWatch();
  const uid = me.uid;

  // 1. Jonli signal (broadcast): hisob o'chirilganda yoki parol boshqa qurilmada o'zgarganda darhol logout qilish
  const sessionCh = sb.channel('user-session-' + uid)
    .on('broadcast', { event: 'account_deleted' }, async () => {
      console.warn('[Auth] Hisob admin tomonidan o\'chirildi');
      await _forceSignOut();
    })
    .on('broadcast', { event: 'password_changed' }, async payload => {
      const fromSession = payload?.payload?.sessionId;
      if (fromSession && fromSession === _getDeviceId()) {
        return; // o'z qurilmamiz parolni o'zgartirgan
      }
      console.warn('[Auth] Parol boshqa qurilmada o\'zgartirildi (broadcast). Darhol chiqilmoqda...');
      toast('Parolingiz boshqa qurilmada o\'zgartirildi. Barcha sessiyalar yopildi', 'warning');
      await _forceSignOut();
    })
    .subscribe();

  // 2. Postgres changes: profiles qatori o'chirilganda (DELETE) yoki o'zgarganda
  const profileCh = sb.channel('profile-' + uid)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        async payload => {
          if (payload.eventType === 'DELETE') {
            _requestForceSignOut('profile_deleted');
            return;
          }
          await _onLiveProfile(mapProfile(payload.new), me);
        })
    .subscribe();

  // 3. Polling zaxira — 60s va tab fokuslanganda (debounce va token yangilanishi bilan)
  let consecutiveFailures = 0;
  let isChecking = false;

  const checkProfile = async () => {
    if (!navigator.onLine || isChecking) return;
    isChecking = true;
    try {
      let p = null;
      try {
        p = await _fetchProfile(uid);
      } catch (fErr) {
        // Agar JWT muddati o'tgan bo'lsa, avval tokenni yangilab qayta ko'ramiz
        if (/unauthorized|jwt expired|invalid claim|token is expired/i.test(fErr?.message || '')) {
          try {
            const { data: refData } = await sb.auth.refreshSession();
            if (refData?.session) {
              p = await _fetchProfile(uid);
            }
          } catch (_) {}
        }
      }

      if (p) {
        consecutiveFailures = 0;
        await _onLiveProfile(p, me);
      } else {
        consecutiveFailures++;
        console.warn(`[Auth] Profil tekshiruvi vaqtinchalik javob bermadi (${consecutiveFailures}/5)`);
        // Faqat ketma-ket 5 marta muvaffaqiyatsiz bo'lsa va auth.users da foydalanuvchi yo'q bo'lsa
        if (consecutiveFailures >= 5) {
          const { error: uErr } = await sb.auth.getUser();
          if (uErr && /not found|invalid claim|user does not exist/i.test(uErr.message || '')) {
            console.warn('[Auth] Foydalanuvchi bazadan o\'chirilgani tasdiqlandi');
            await _forceSignOut();
          }
        }
      }
    } catch (err) {
      console.warn('[Auth] checkProfile xatoligi:', err?.message || err);
    } finally {
      isChecking = false;
    }
  };

  const poll = setInterval(checkProfile, PROFILE_POLL_MS);

  let focusDebounce = null;
  const triggerDebouncedCheck = () => {
    // Avval kechiktirilgan chiqish (admin o'chirgan) — tab ochilganda darhol
    if (document.visibilityState === 'visible') _flushDeferredForceLogout();
    if (focusDebounce) clearTimeout(focusDebounce);
    focusDebounce = setTimeout(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        checkProfile();
      }
    }, 2500);
  };

  window.addEventListener('focus', triggerDebouncedCheck);
  document.addEventListener('visibilitychange', triggerDebouncedCheck);

  _activeUserUnsub = () => {
    clearInterval(poll);
    if (focusDebounce) clearTimeout(focusDebounce);
    window.removeEventListener('focus', triggerDebouncedCheck);
    document.removeEventListener('visibilitychange', triggerDebouncedCheck);
    sb.removeChannel(sessionCh);
    sb.removeChannel(profileCh);
  };
}

/* ── Sessiya boshqaruvi ──────────────────────────────────────────────── */
async function _handleSession(session) {
  const user = session?.user || null;

  if (!user) {
    _currentUid = null;
    _shownKey = null;
    state.me = null;
    _stopUserWatch();
    if (_postsUnsub) { _postsUnsub(); _postsUnsub = null; }
    hidePendingScreen();
    stopChatsWatcher();
    stopBus();
    stopCallWatcher();
    stopPresenceHeartbeat();
    const app = $('app');
    const authWrap = $('authWrap');
    if (app) app.classList.remove('show');
    if (authWrap) authWrap.classList.add('show');
    try { (window.__spacemrHideSplash || window.__mrspaceHideSplash)?.('no-session'); } catch (_) {}
    return;
  }

  // Token yangilanishi / takroriy SIGNED_IN — qayta ishlamaymiz
  if (_currentUid === user.id) return;
  _currentUid = user.id;

  if (!_serverTimeSynced) await _syncServerTime();

  let p = null, fetchErr = null;
  try { p = await _fetchProfile(user.id); } catch (err) { fetchErr = err; }

  // Yangi signup: handle_new_user trigger biroz kechikishi mumkin — 3 marta qayta urin
  if (!p && !fetchErr && navigator.onLine) {
    for (let i = 0; i < 3 && !p; i++) {
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
      try { p = await _fetchProfile(user.id); } catch (err) { fetchErr = err; break; }
    }
  }

  const me = _buildMe(user, p);
  state.me = me;
  try { import('../ui/ui.js').then(m => m.refreshHdrAvi?.()); } catch (_) {}
  try { document.dispatchEvent(new CustomEvent('meUpdated')); } catch (_) {}

  // Profil xato bilan olinmadi yoki offline
  if (fetchErr || (!p && !navigator.onLine)) {
    console.warn('[Auth] Profil olinmadi:', fetchErr?.message);
    if (!navigator.onLine) {
      const decision = _offlineAccessDecision(user.id);
      if (!decision.allow) {
        if (decision.blocked) _showOnce('blocked', decision.blockedUntil);
        else _showOnce('offline-verify');
        return;
      }
      _enterApp(me);
      _startRealtimeUserWatch(me);
      return;
    }
    // Agar token eskirgan bo'lsa, uni avtomatik yangilashga urinib ko'ramiz
    if (/unauthorized|jwt expired|invalid claim|token is expired/i.test(fetchErr?.message || '')) {
      try {
        const { data: refData } = await sb.auth.refreshSession();
        if (refData?.session) {
          try {
            p = await _fetchProfile(user.id);
            fetchErr = null;
          } catch (rErr) { fetchErr = rErr; }
        }
      } catch (_) {}
    }

    if (!p) {
      // Faqatgina auth.users da foydalanuvchi yo'q bo'lsa (haqiqatan o'chirilgan bo'lsa) hisobdan chiqaramiz
      const { error: uErr } = await sb.auth.getUser();
      if (uErr && /not found|user does not exist/i.test(uErr.message || '')) {
        await _forceSignOut();
        return;
      }
      // Onlayn, lekin server xato berdi yoki kechikmoqda — sessiyani o'chirmasdan pending ko'rsatamiz
      _showOnce('pending');
      _startRealtimeUserWatch(me);
      return;
    }
  }

  // Profil qatori olinmagan bo'lsa — sessiyani buzmasdan kutish
  if (!p) {
    console.warn('[Auth] Profil qatori olinmadi, sessiya saqlanadi');
    _showOnce('pending');
    _startRealtimeUserWatch(me);
    return;
  }

  try {
    const { applyAdminNav } = await import('../router.js');
    applyAdminNav();
  } catch (_) {}

  // Sessiyadagi joriy parol vaqtini muhrlaymiz
  const currentTs = p.passwordChangedAt || Date.now();
  const existingTs = _getLocalPwdTs(me.uid);
  if (!existingTs || currentTs > existingTs) {
    _setLocalPwdTs(me.uid, currentTs);
  }

  // Faqat serverdan haqiqatan olingan holat — tasdiqlangan holat sifatida saqlanadi
  await _onLiveProfile(p, me);
  _startRealtimeUserWatch(me);
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
  // Yangi kirishda (SIGNED_IN) darhol joriy parol vaqtini yangilash (eski ts tufayli soxta logout bo'lmasligi uchun)
  if (event === 'SIGNED_IN' && session?.user?.id) {
    _setLocalPwdTs(session.user.id, Date.now());
  }
  // Callback ichida supabase chaqiruvlarini kutmaymiz (deadlock xavfi)
  setTimeout(() => { _handleSession(session); }, 0);
});
// INITIAL_SESSION hodisasi versiyaga bog'liq — kafolat uchun bir marta o'zimiz ham so'raymiz
sb.auth.getSession().then(({ data }) => { _handleSession(data?.session || null); });

/* ── User cache invalidation helper ────────────────────────────────── */
export function invalidateUserCache(uid) {
  if (state._userCache && uid) {
    delete state._userCache[uid];
  }
}

async function _enterApp(user) {
  if (_entering) return;
  _entering = true;
  try {
    const authWrap = $('authWrap');
    const app = $('app');
    if (authWrap) authWrap.classList.remove('show');
    if (app) app.classList.add('show');
    _shownKey = null;

    /* Faqat yangi ro'yxatdan o'tgan foydalanuvchilarga onboarding */
    if (sessionStorage.getItem('spacemr_new_signup') || sessionStorage.getItem('mrspace_new_signup')) {
      sessionStorage.removeItem('spacemr_new_signup');
      sessionStorage.removeItem('mrspace_new_signup');
      setTimeout(() => {
        if (typeof window._startOnboarding === 'function') window._startOnboarding(true);
      }, 1100);
    }

    listenPosts();
    if (!notificationsUserDisabled()) initPush();
    startBus();          // tezkor shina: like/izoh/post/presence/kirish qutisi
    startChatsWatcher(); // ichida startGroupsWatcher ham
    startCallWatcher();
    maybeShowGuideCard(); // telefonda bir martalik "ilovani o'rnating" kartasi

    // "Oxirgi faollik" — admin panelida ko'rsatish uchun
    try {
      await sb.from('profiles').update({
        last_seen: new Date().toISOString(),
        last_user_agent: navigator.userAgent || null,
        last_platform: navigator.platform || null,
      }).eq('id', user.uid);
    } catch (_) { /* jim o'tkazib yuboramiz */ }

    startPresenceHeartbeat();

    // Splash davomida ko'proq ma'lumot yuklash
    try {
      await _preloadForSplash(user.uid);
    } catch (e) {
      console.warn('[Auth] preload:', e?.message || e);
    }
    try { (window.__spacemrHideSplash || window.__mrspaceHideSplash)?.('app-ready'); } catch (_) {}

    // Stories bar birinchi yuklanishda ham chiqsin (router auth dan oldin ishlagan bo'lishi mumkin)
    try {
      const { initStories } = await import('../feed/stories.js');
      initStories();
    } catch (e) { console.warn('[Auth] stories', e?.message || e); }

    // Target post havolasi bilan kelgan bo'lsa (login qilingandan so'ng avtomatik postga o'tish)
    try {
      const { scrollToPostFromHash, getTargetPostId } = await import('../feed/feed.js');
      const targetId = getTargetPostId();
      if (targetId) {
        const { navigateTo } = await import('../router.js');
        navigateTo('home', false);
        scrollToPostFromHash();
      }
    } catch (e) { console.warn('[Auth] target post scroll:', e?.message || e); }
  } finally {
    _entering = false;
  }
}

/** Splash yopilishidan oldin parallel yuklash */
async function _preloadForSplash(uid) {
  const tasks = [];

  // 1) Postlar (listenPosts load() async — qayta so'rov, tezkor kesh + network)
  tasks.push((async () => {
    try {
      const { data } = await sb.from('posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      if (data?.length) {
        const posts = data.map(r => {
          try { return mapPost(r); } catch { return null; }
        }).filter(Boolean);
        if (posts.length) {
          state.allPosts = posts;
          try { cachePosts(uid, posts); } catch (_) {}
          if (state.view === 'home') _cb.renderFeed?.();
        }
      }
    } catch (e) { console.warn('[preload] posts', e?.message); }
  })());

  // 2) Onlayn profillar (right-rail)
  tasks.push((async () => {
    try {
      const { data } = await sb.from('profiles')
        .select('id, username, full_name, avatar, last_seen, approval, blocked')
        .eq('approval', 'approved')
        .eq('blocked', false)
        .order('last_seen', { ascending: false })
        .limit(40);
      for (const row of data || []) {
        const d = mapProfile(row);
        if (!d?.uid) continue;
        state._userCache[d.uid] = {
          uid: d.uid, fullName: d.fullName, avatar: d.avatar,
          username: d.username, blocked: d.blocked, approved: d.approved,
          lastSeenAt: d.lastSeenAt,
        };
      }
      // right-rail yangilansin
      document.dispatchEvent(new CustomEvent('profilesPreloaded'));
    } catch (e) { console.warn('[preload] profiles', e?.message); }
  })());

  // 3) Guruhlar ro'yxati allaqachon startGroupsWatcher da — biroz kutamiz
  tasks.push(new Promise(r => setTimeout(r, 400)));

  // 4) Post mualliflari
  tasks.push((async () => {
    try {
      const uids = [...new Set((state.allPosts || []).map(p => p.userId).filter(Boolean))]
        .filter(id => !state._userCache[id])
        .slice(0, 30);
      if (!uids.length) return;
      const { data } = await sb.from('profiles')
        .select('id,full_name,avatar,username,blocked,approval')
        .in('id', uids);
      for (const row of data || []) {
        const d = mapProfile(row);
        state._userCache[d.uid] = {
          uid: d.uid, fullName: d.fullName, avatar: d.avatar,
          username: d.username, blocked: d.blocked, approved: d.approved,
        };
      }
    } catch (_) {}
  })());

  Promise.allSettled(tasks); // Fire and forget! Don't block splash screen.
  // right-rail qayta chizsin
  try {
    const rr = await import('../ui/right-rail.js');
    rr.startRightRail?.();
  } catch (_) {}
  document.dispatchEvent(new CustomEvent('groupsUpdated'));
}

/* ── Onlayn holat (presence) heartbeat ─────────────────────────────────
 * profiles.last_seen har ~25s yangilanadi; boshqalar isOnline(lastSeenAt)
 * (utils.js) bilan "onlayn/oxirgi faollik"ni hisoblaydi.
 * Fon/yopiq oynada ham yuboriladi (brauzer taymerni sekinlatadi, lekin oyna baribir ochiq).
 ─────────────────────────────────────────────────────────────────────── */
const HEARTBEAT_MS = 25 * 1000;
let _heartbeatTimer = null;

async function _pingPresence() {
  const uid = state.me?.uid;
  if (!uid) return;
  // Faqat faol tab — boshqa tabda offline qolishi kerak
  if (document.visibilityState !== 'visible') return;
  try {
    await sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', uid);
  } catch (_) { /* tarmoq yo'q — keyingi tikda qayta urinadi */ }
}

function startPresenceHeartbeat() {
  if (_heartbeatTimer) return;
  _pingPresence(); // darhol bitta marta
  _heartbeatTimer = setInterval(_pingPresence, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', _onVisibilityChangeForPresence);
  window.addEventListener('pagehide', _onPageHidePresence);
}

function stopPresenceHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  document.removeEventListener('visibilitychange', _onVisibilityChangeForPresence);
  window.removeEventListener('pagehide', _onPageHidePresence);
  untrackPresence();
}

function _onPageHidePresence() {
  untrackPresence();
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

function _onVisibilityChangeForPresence() {
  if (document.visibilityState === 'visible') {
    _pingPresence();
    trackPresence();
    if (!_heartbeatTimer) {
      _heartbeatTimer = setInterval(_pingPresence, HEARTBEAT_MS);
    }
  } else {
    // Boshqa tab / minimallashtirish — darhol offline
    untrackPresence();
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  }
}

/* ── Live posts listener ─────────────────────────────────────────────────
   RLS o'zi filtrlaydi: oddiy user public + o'z postlarini, admin hammasini
   oladi. Boshida bitta so'rov, keyin realtime (posts jadvali) orqali
   INSERT/UPDATE/DELETE. Like/izoh/ko'rish sonlarini DB triggerlari
   yangilaydi — UPDATE hodisasi patchCounts()ga olib boradi. ─────────── */
let _postsUnsub = null;
export function listenPosts() {
  if (_postsUnsub) return; // Allaqachon tinglayapti
  if (!state.me?.uid) return;
  let _lastPostIds = '';

  const myUid = state.me.uid;
  const byId = new Map();

  // Bir necha hodisa ketma-ket kelsa — bitta rAF frame ichida birlashtiramiz (0 lag)
  let _renderRaf = 0;
  function _scheduleRender() {
    if (_renderRaf) return;
    _renderRaf = requestAnimationFrame(() => { _renderRaf = 0; render(); });
  }

  // ── KESH-BIRINCHI: oldingi safar saqlangan postlarni darhol ko'rsatamiz ──
  const _cachedPosts = getCachedPosts(myUid);
  if (_cachedPosts && _cachedPosts.length) {
    state.allPosts = _cachedPosts;
    _lastPostIds = _cachedPosts.map(p => p.id).join(',');
    if (state.view === 'home')    _cb.renderFeed?.();
    if (state.view === 'reels')   _cb.renderReels?.();
    if (state.view === 'profile') _cb.renderProfile?.();
  }

  const render = async () => {
    const newPosts = [...byId.values()].sort((a, b) => {
      const at = a.createdAt || 0;
      const bt = b.createdAt || 0;
      return bt - at;
    });

    // Muallif ma'lumotlarini keshlash (bitta so'rov bilan)
    const uidsToFetch = [...new Set(newPosts.map(p => p.userId).filter(Boolean))]
      .filter(uid => !state._userCache[uid]);
    if (uidsToFetch.length) {
      try {
        const { data } = await sb.from('profiles')
          .select('id,full_name,avatar,username,blocked,approval')
          .in('id', uidsToFetch);
        for (const row of data || []) {
          const d = mapProfile(row);
          state._userCache[d.uid] = {
            uid: d.uid, fullName: d.fullName, avatar: d.avatar,
            username: d.username, blocked: d.blocked, approved: d.approved,
          };
        }
      } catch (err) {
        console.warn('[Auth] Muallif profillarini olishda xato:', err?.message);
      }
    }

    // Faqat post ID'lari o'zgarganda to'liq re-render
    const currentIds = newPosts.map(p => p.id).join(',');
    const structural = _lastPostIds !== currentIds || (newPosts.length === 0 && window.__feedNeedsEmptyRender);

    const countChanged = state.allPosts && state.allPosts.some(oldP => {
      const newP = newPosts.find(p => p.id === oldP.id);
      return newP && (
        newP.likes !== oldP.likes ||
        newP.commentCount !== oldP.commentCount
      );
    });

    state.allPosts = newPosts;
    _lastPostIds = currentIds;

    if (structural) cachePosts(myUid, newPosts);
    window.__feedNeedsEmptyRender = false;

    if (structural) {
      if (state.view === 'home')      _cb.renderFeed?.();
      if (state.view === 'reels')     _cb.renderReels?.();
      if (state.view === 'profile')   _cb.renderProfile?.();
      if (state.currentViewingUserId) {
        const modal = document.getElementById('userProfileModal');
        if (modal?.classList.contains('show')) _cb.renderUserProfileModal?.(state.currentViewingUserId);
      }
    } else if (countChanged) {
      _cb.patchCounts?.(newPosts);
    }
    // O'ng panel ("So'nggi") shu hodisa orqali yangilanadi — alohida realtime kanal kerak emas (5.3)
    if (structural) document.dispatchEvent(new CustomEvent('postsUpdated'));
  };

  const POST_LIMIT = 10; // scroll orqali 10 tadan ko'rsatiladi

  
  window.__fetchMorePosts = async () => {
    if (state.loadingMoreDB || !state.allPosts?.length) return false;
    state.loadingMoreDB = true;
    try {
      const oldest = state.allPosts[state.allPosts.length - 1];
      if (!oldest?.createdAt) return false;
      const { data, error } = await sb.from('posts').select('*')
        .lt('created_at', new Date(oldest.createdAt).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);
      if (error || !data || data.length === 0) { window.__feedFullyLoaded = true; document.dispatchEvent(new CustomEvent('postsUpdated')); return false; }
      
      let added = 0;
      for (const r of data) {
        if (!byId.has(r.id)) {
          byId.set(r.id, mapPost(r));
          added++;
        }
      }
      if (data.length < 10) { window.__feedFullyLoaded = true; _scheduleRender(); }
      if (added > 0) _scheduleRender();
      return added > 0;
    } catch (e) {
      return false;
    } finally {
      state.loadingMoreDB = false;
    }
  };

  const load = async () => {
    const { data, error } = await sb.from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(POST_LIMIT);
    if (error) { console.warn('[Auth] Posts yuklashda xato:', error.message); return; }
    byId.clear();
    for (const r of data || []) byId.set(r.id, mapPost(r));
    if (data && data.length < POST_LIMIT) { window.__feedFullyLoaded = true; window.__feedNeedsEmptyRender = true; }
    else window.__feedFullyLoaded = false;
    _scheduleRender();
  };

  load();

  let _subscribedOnce = false;
  const ch = sb.channel('posts-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, payload => {
      if (payload.eventType === 'DELETE') byId.delete(payload.old?.id);
      else if (payload.new?.id) byId.set(payload.new.id, mapPost(payload.new));
      _scheduleRender();
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        // Uzilib qayta ulanganda o'tkazib yuborilgan o'zgarishlarni to'ldiramiz
        if (_subscribedOnce) load();
        _subscribedOnce = true;
      }
    });

  // Tezkor shina: yozuvchidan to'g'ridan-to'g'ri keladi (postgres_changes kutilmaydi); keyin DB hodisasi to'g'rilaydi
  const _offBus = [
    busOn('post', o => {
      // Optimistic: o'zimga 0ms da ko'rsatish (server hali yuklamayotgan)
      if (o.op === 'opt' && o.post?.id) {
        byId.set(o.post.id, o.post);
      } else if (o.op === 'new' && o.row?.id) {
        if (o.replaceId) byId.delete(o.replaceId);
        byId.set(o.row.id, mapPost(o.row));
      } else if (o.op === 'del' && o.id) byId.delete(o.id);
      else return;
      _scheduleRender();
    }),
    busOn('like', o => {
      const p = byId.get(o.postId);
      if (p && Number.isFinite(o.n)) {
        const updated = { ...p, likes: o.n };
        byId.set(o.postId, updated);
        // DOM da bor bo'lsa — faqat raqamni yangilash (to'liq re-render yo'q)
        const inDom = document.getElementById('lc-' + o.postId);
        if (inDom) {
          state.allPosts = [...byId.values()].sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
          _cb.patchCounts?.([updated]);
        } else {
          _scheduleRender();
        }
      }
    }),
    busOn('cmt', o => {
      const p = byId.get(o.postId);
      if (p && Number.isFinite(o.n)) {
        const updated = { ...p, commentCount: o.n };
        byId.set(o.postId, updated);
        const inDom = document.getElementById('cc-' + o.postId);
        if (inDom) {
          state.allPosts = [...byId.values()].sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
          _cb.patchCounts?.([updated]);
        } else {
          _scheduleRender();
        }
      }
    }),
    busOn('story', o => {
      if (o?.op === 'opt' && o.item) {
        import('../feed/stories.js').then(m => m.injectLocalStory?.(o.item)).catch(() => {});
        return;
      }
      import('../feed/stories.js').then(m => m.loadStories()).catch(() => {});
    }),
  ];

  _postsUnsub = () => { if (_renderRaf) cancelAnimationFrame(_renderRaf); _offBus.forEach(f => f()); sb.removeChannel(ch); };
}

/* ── Profil edit / logout — to'liq implementatsiya ─────────────────── */

let _peAviPending = null;
let _peOriginalUsername = '';

export async function populateProfileForm() {
  if (!state.me) return;
  let d = getCachedProfile(state.me.uid) || {};
  try {
    const { data: _row } = await sb.from('profiles').select('*').eq('id', state.me.uid).maybeSingle();
    if (_row) {
      d = mapProfile(_row) || d;
      cacheProfile(state.me.uid, d);
    }
  } catch (_) {}
  _peOriginalUsername = d.username || '';

  const editName = $('editName');
  const editBioInput = $('editBioInput');
  const editUsername = $('editUsername');
  const editRecoveryEmail = $('editRecoveryEmail');
  if (editName) editName.value = d.fullName || '';
  if (editBioInput) editBioInput.value = d.bio || '';
  if (editUsername) editUsername.value = d.username || '';
  if (editRecoveryEmail) editRecoveryEmail.value = d.recoveryEmail || '';

  _peAviPending = null;
  const peAviImg = $('peAviImg');
  if (peAviImg) {
    const av = d.avatar || defAvi(d.fullName || 'U');
    peAviImg.innerHTML = `<img src="${esc(av)}" onerror="this.style.display='none'">`;
  }

  // Parol maydonlarini tozalash va ko'rish holatini yopish
  ['editOldPassword', 'editNewPassword', 'editNewPassword2'].forEach(id => {
    const el = $(id);
    if (el) {
      el.value = '';
      el.type = 'password';
    }
  });
  document.querySelectorAll('.pe-pwd-toggle').forEach(btn => {
    const openEye = btn.querySelector('.pe-eye-open');
    const closedEye = btn.querySelector('.pe-eye-closed');
    if (openEye) openEye.style.display = 'block';
    if (closedEye) closedEye.style.display = 'none';
    btn.setAttribute('aria-label', "Parolni ko'rsatish");
    btn.setAttribute('title', "Parolni ko'rsatish");
  });
}

// Avatar tanlash hodisalari (bir martalik)
const peAviInput = $('peAviInput');
const peAviEditBadge = $('peAviEditBadge');
if (peAviEditBadge && peAviInput) {
  peAviEditBadge.onclick = (e) => { e.stopPropagation(); peAviInput.click(); };
}
const peAviRing = $('peAviRing');
if (peAviRing && peAviInput) {
  peAviRing.onclick = (e) => {
    if (e.target !== peAviEditBadge && !peAviEditBadge.contains(e.target)) peAviInput.click();
  };
}
const peAviChangeText = $('peAviChangeText');
if (peAviChangeText && peAviInput) {
  peAviChangeText.onclick = (e) => { e.stopPropagation(); peAviInput.click(); };
}
if (peAviInput) {
  peAviInput.onchange = async ev => {
    const f = ev.target.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    if (f.size > 12*1024*1024) { toast("Rasm 12 MB dan kam bo'lishi kerak", 'error'); return; }
    // Crop / zoom oynasini ochamiz
    peAviInput.value = ''; // qayta tanlash uchun
    const cropped = await openAviCrop(f);
    if (!cropped) return; // bekor qilindi
    toast('Yuklanmoqda...', 'info');
    try {
      const file = new File([cropped], 'avatar.png', { type: 'image/png', lastModified: Date.now() });
      const result = await uploadViaController(file, 'avatars');
      _peAviPending = result.url;
      const peAviImg = $('peAviImg');
      if (peAviImg) peAviImg.innerHTML = `<img src="${result.url}">`;
      toast('Avatar tanlandi (saqlash uchun "Saqlash" tugmasini bosing)', 'success');
    } catch(e) { toast('Xato: ' + e.message, 'error'); }
  };
}

const editProfileBtn = $('editProfileBtn');
if (editProfileBtn) {
  editProfileBtn.onclick = () => {
    $('settingsBtn')?.click();
  };
}

let _isSavingProfile = false;
const saveProfileBtn = $('saveProfileBtn');
if (saveProfileBtn) {
  saveProfileBtn.onclick = async () => {
    if (!state.me) return;
    if (_isSavingProfile) return;
    _isSavingProfile = true;
    saveProfileBtn.disabled = true;
    const origHtml = saveProfileBtn.innerHTML;
    saveProfileBtn.textContent = 'Saqlanmoqda...';

    try {
      const fn = $('editName')?.value?.trim();
      if (!fn) { toast('Ismingizni kiriting', 'error'); return; }

      const rawRecEmail = $('editRecoveryEmail')?.value?.trim() || '';
      if (rawRecEmail) {
        const emailRes = validateStrictEmail(rawRecEmail);
        if (!emailRes.ok) {
          toast(emailRes.error, 'error');
          return;
        }
      }

      const updates = {
        full_name: fn,
        bio:       $('editBioInput')?.value?.trim() || '',
        recovery_email: rawRecEmail || null,
      };

      const rawUser = $('editUsername')?.value?.trim() || '';
      let newUsername = null;
      if (rawUser) {
        const cleaned = rawUser.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (cleaned.length < 2) { toast("Username kamida 2 ta belgi bo'lishi kerak (a-z, 0-9, _)", 'error'); return; }
        if (cleaned.length > 20) { toast("Username 20 ta belgidan oshmasligi kerak", 'error'); return; }
        if (cleaned !== _peOriginalUsername) {
          // Username o'zgarishi: auth email ham yangilanadi (eski login ishlamaydi)
          const { data: uRes, error: uErr } = await sb.rpc('change_my_username', { p_new_username: cleaned });
          if (uErr) {
            const msg = uErr.message || '';
            if (/band/i.test(msg)) toast('Bu username band', 'error');
            else toast(msg || "Username o'zgartirilmadi", 'error');
            return;
          }
          if (uRes && uRes.ok === false) {
            toast(uRes.message || "Username o'zgartirilmadi", 'error');
            return;
          }
          newUsername = cleaned;
          _peOriginalUsername = cleaned;
        }
      }

      if (_peAviPending) updates.avatar = _peAviPending;

      // Parol o'zgartirish (ixtiyoriy)
      const oldPwd = $('editOldPassword')?.value || '';
      const newPwd = $('editNewPassword')?.value || '';
      const newPwd2 = $('editNewPassword2')?.value || '';
      const wantsPwd = !!(oldPwd || newPwd || newPwd2);

      if (wantsPwd) {
        if (!oldPwd) { toast('Joriy parolni kiriting', 'error'); return; }
        if (newPwd.length < 6) { toast("Yangi parol kamida 6 ta belgi bo'lishi kerak", 'error'); return; }
        if (newPwd !== newPwd2) { toast('Yangi parollar mos emas', 'error'); return; }

        // Baza darajasida xavfsiz va atomik tekshirib o'zgartirish (notif mos bo'lishi uchun):
        const { data: pRes, error: pErr } = await sb.rpc('change_my_password', {
          p_old_password: oldPwd,
          p_new_password: newPwd,
        });

        if (pErr) {
          const msg = pErr.message || '';
          if (/Joriy parol noto/i.test(msg)) {
            toast("Joriy parol noto'g'ri", 'error');
          } else {
            toast(msg || "Parolni o'zgartirishda xatolik yuz berdi", 'error');
          }
          return;
        }

        if (!pRes?.ok) {
          toast(pRes?.message || "Parolni o'zgartirishda xatolik", 'error');
          return;
        }

        await notifyPasswordChanged(state.me.uid);
      }

      const { error } = await sb.from('profiles').update(updates).eq('id', state.me.uid);
      if (error) {
        if (error.code === '23505') { toast('Bu username band', 'error'); return; }
        throw error;
      }

      state.me.displayName = fn;
      if (newUsername) state.me.username = newUsername;
      else if (updates.username) state.me.username = updates.username;
      if (updates.avatar)   state.me.photoURL = updates.avatar;
      try { document.dispatchEvent(new CustomEvent('meUpdated')); } catch (_) {}
      if (updates.recovery_email !== undefined) {
        state.me.recoveryEmail = updates.recovery_email;
        paintSettingsRecoveryRow();
      }
      invalidateUserCache(state.me.uid);

      // parol maydonlarini tozalash
      ['editOldPassword','editNewPassword','editNewPassword2'].forEach(id => {
        const el = $(id); if (el) el.value = '';
      });

      toast(wantsPwd ? 'Profil va yangi parol saqlandi' : 'Profil saqlandi', 'success');
      _cb.renderProfile?.();
    } catch(e) {
      toast('Xato: ' + e.message, 'error');
    } finally {
      _isSavingProfile = false;
      saveProfileBtn.disabled = false;
      saveProfileBtn.innerHTML = origHtml;
    }
  };
}

const cancelEditBtn = $('cancelEditBtn');
if (cancelEditBtn) {
  cancelEditBtn.onclick = () => {
    populateProfileForm();
    $('closeSettingsBtn')?.click();
  };
}

// Profil tahrirlashda parolni ko'rsatish/yashirish (eye toggle)
document.querySelectorAll('.pe-pwd-toggle').forEach(btn => {
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const targetId = btn.getAttribute('data-target');
    const inp = $(targetId);
    if (!inp) return;
    const openEye = btn.querySelector('.pe-eye-open');
    const closedEye = btn.querySelector('.pe-eye-closed');
    if (inp.type === 'password') {
      inp.type = 'text';
      if (openEye) openEye.style.display = 'none';
      if (closedEye) closedEye.style.display = 'block';
      btn.setAttribute('aria-label', "Parolni yashirish");
      btn.setAttribute('title', "Parolni yashirish");
    } else {
      inp.type = 'password';
      if (openEye) openEye.style.display = 'block';
      if (closedEye) closedEye.style.display = 'none';
      btn.setAttribute('aria-label', "Parolni ko'rsatish");
      btn.setAttribute('title', "Parolni ko'rsatish");
    }
  };
});

export async function logOut() {
  try { await Promise.race([removePushToken(), new Promise(r => setTimeout(r, 1500))]); } catch (_) {}
  try { clearAllCache(); } catch (_) {}
  try { await sb.auth.signOut({ scope: 'local' }); } catch (_) {}
  try { await sb.auth.signOut({ scope: 'global' }); } catch (_) {}
  // Qolgan sessiya kalitlarini tozalash
  try {
    Object.keys(localStorage).forEach(k => {
      if (/supabase|spacemr-auth|mrspace-auth|sb-/i.test(k)) localStorage.removeItem(k);
    });
    Object.keys(sessionStorage).forEach(k => {
      if (/supabase|spacemr|mrspace|sb-/i.test(k)) sessionStorage.removeItem(k);
    });
  } catch (_) {}
  location.replace('/');
}

const logoutBtn = $('logoutBtn');
if (logoutBtn) {
  logoutBtn.onclick = () => { logOut(); };
}

// Initialize call handlers (buttons for accept/reject/end)

initRegRecovery({ sbErrUz });
initAuthPending({
  serverNow: () => serverNow(),
  onBlockExpired: async () => {
    if (state.me) {
      await _enterApp(state.me);
      _startRealtimeUserWatch(state.me);
    }
  },
  onPendingSignOut: async () => {
    if (_approvalListener) { _approvalListener(); _approvalListener = null; }
    if (_activeUserUnsub) { _activeUserUnsub(); _activeUserUnsub = null; }
  },
});
initAuthSettings({
  populateProfileForm: () => { populateProfileForm(); },
});
