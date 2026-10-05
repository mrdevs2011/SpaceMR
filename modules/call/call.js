import { esc } from '../core/utils.js';
/**
 * call.js — faqat WebRTC call engine + chat.js dan re-export
 * 
 * MUHIM: Oldingi versiyada call.js chat.js bilan bir xil kodni o'z ichida 
 * takrorlagan, natijada barcha Firestore listener'lar IKKI MARTA ishga tushar,
 * RAM va CPU ikki barobar sarflanardi. Endi faqat call-specific kod bu yerda.
 */

// Chat funksiyalarini chat.js dan re-export qilamiz (takrorlash yo'q)
export {
  startChatsWatcher,
  stopChatsWatcher,
  renderChatsList,
  repaintNoticeBanner,
  openChatThread,
  closeChatThread,
  sendChatMessage,
  destroyChatsView,
} from '../chat/chat.js';

import { sb, state } from '../core/config.js';
import { $ } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { sendCallLog } from '../chat/chat-actions.js';
import { TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL } from '../core/env.js';

/* calls qatori (snake_case) → eski Firestore ko'rinishi */
function mapCall(r) {
  if (!r) return null;
  return {
    id: r.id,
    callerId: r.caller_id,
    calleeId: r.callee_id,
    type: r.type,
    status: r.status,
    offer: r.offer,
    answer: r.answer,
    callerCandidates: r.caller_candidates || [],
    calleeCandidates: r.callee_candidates || [],
    videoOffer: r.video_offer || null,
    videoAnswer: r.video_answer || null,
  };
}

async function _updateCall(id, patch) {
  const { error } = await sb.from('calls').update(patch).eq('id', id);
  if (error) throw error;
}

/* ── Qo'ng'iroqni QAT'IY tugatish yordamchilari ──
   Sahifa refresh/yopilganda yoki internet uzilganda 'ended' yetib borishi shart. */
let _accessToken = null;
try {
  sb.auth.getSession().then(r => { _accessToken = r?.data?.session?.access_token || null; }).catch(() => {});
  sb.auth.onAuthStateChange((_e, sess) => { _accessToken = sess?.access_token || null; });
} catch (_) {}

const PENDING_END_KEY = 'call_pending_end';
function _setPendingEnd(id) {
  try { id ? localStorage.setItem(PENDING_END_KEY, id) : localStorage.removeItem(PENDING_END_KEY); } catch (_) {}
}
const _withTimeout = (p, ms = 3000) => Promise.race([Promise.resolve(p), new Promise(r => setTimeout(r, ms))]);

// Sahifa yopilayotganda ham yetib boradigan 'ended' (fetch keepalive). Yetmasa — keyingi online/yuklashda yopiladi.
function _beaconEnd(id) {
  if (!id) return;
  _setPendingEnd(id);
  try {
    if (!_accessToken || !sb.supabaseUrl || !sb.supabaseKey) return;
    fetch(`${sb.supabaseUrl}/rest/v1/calls?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', keepalive: true,
      headers: { apikey: sb.supabaseKey, Authorization: 'Bearer ' + _accessToken, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'ended' }),
    }).then(r => { if (r.ok) _setPendingEnd(null); }).catch(() => {});
  } catch (_) {}
}

// Oldingi sessiyada (refresh / internet uzilishi) yopilmay qolgan qo'ng'iroqni yopish
export async function flushPendingCallEnd() {
  let id = null;
  try { id = localStorage.getItem(PENDING_END_KEY); } catch (_) {}
  if (!id) return;
  try {
    const { error } = await sb.from('calls').update({ status: 'ended' }).eq('id', id);
    if (!error) _setPendingEnd(null);
  } catch (_) {}
}

// HARD END: kutmasdan darhol, to'liq tugatadi
function _hardEnd(reason, endSound = 'local') {
  if (_ending || (!_callId && !_pc)) return;
  console.warn('[call] hard end:', reason);
  _endCall(false, endSound);
}

async function _userInfo(uid) {
  const { data } = await sb.from('profiles').select('full_name, avatar').eq('id', uid).maybeSingle();
  return data ? { fullName: data.full_name || '', avatar: data.avatar || '' } : {};
}

// ICE candidate'ni atomik qo'shadi (RPC o'zi caller/callee ustunini tanlaydi)
async function _sendIce(callId, cand) {
  try { await sb.rpc('append_call_candidate', { p_call: callId, p_candidate: cand }); } catch (e) { console.warn('[call]', e?.message || e); }
}

// Bitta qo'ng'iroq yozuvini kuzatish: realtime (UPDATE) + har 4 soniyada zaxira so'rov.
// Yozuv o'chirilgan bo'lsa onRow(null) chaqiriladi. Chaqiruvlar ketma-ket bajariladi.
// Realtime'da DELETE filtr bilan kelmaydi, shuning uchun o'chirilishni zaxira so'rov ushlaydi.
let _watchSeq = 0;
function _watchCall(id, onRow) {
  let stopped = false, last = '', queue = Promise.resolve();
  const push = row => {
    const j = JSON.stringify(row);
    if (stopped || j === last) return;
    last = j;
    queue = queue.then(async () => {
      if (stopped) return;
      try { await onRow(row); } catch (e) { console.error('[Call] watcher:', e); }
    });
  };
  const load = async () => {
    if (stopped) return;
    const { data, error } = await sb.from('calls').select('*').eq('id', id).maybeSingle();
    if (stopped || error) return;
    push(mapCall(data));
  };
  const ch = sb.channel('call-' + id + '-' + (++_watchSeq))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: 'id=eq.' + id },
        p => push(mapCall(p.new)))
    .subscribe(st => { if (st === 'SUBSCRIBED') load(); });
  const poll = setInterval(load, 4000);
  return () => { stopped = true; clearInterval(poll); sb.removeChannel(ch); };
}

/* ══════════════════════════════════════════════════════════════════════
   WebRTC CALL ENGINE  (Supabase signaling)
   ══════════════════════════════════════════════════════════════════════ */

// STUN — faqat "ochiq" tarmoqlarda ishlaydi. Ko'pchilik haqiqiy holatda
// (mobil internet, turli operatorlar, qattiq NAT) TO'G'RIDAN-TO'G'RI P2P
// ulanish imkonsiz bo'ladi va TURN relay orqali o'tish SHART bo'ladi —
// shuning uchun TURN serverlar ham qo'shildi (aks holda qo'ng'iroq "ulanadi,
// lekin ovoz/video kelmaydi" yoki "tez-tez uziladi" bo'lib chiqadi).
// TURN: Vercel Environment Variables'da TURN_URLS (vergul bilan), TURN_USERNAME,
// TURN_CREDENTIAL bering (Metered / Cloudflare / o'z coturn'ingiz). Bo'lmasa —
// bepul umumiy OpenRelay ishlatiladi (beqaror: mobil tarmoqda qo'ng'iroq ulanmasligi mumkin).
const _turnList = (TURN_URLS || '').split(',').map(x => x.trim()).filter(Boolean);

const _STATIC_ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ..._turnList.length
      ? [{ urls: _turnList, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]
      : [
          { urls: 'stun:openrelay.metered.ca:80' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ],
  ],
  iceCandidatePoolSize: 10
};

// Cloudflare TURN: qisqa muddatli kredensial /api/turn dan olinadi (sirlar serverda).
// Ishlamasa yuqoridagi statik sozlamaga (TURN_* yoki OpenRelay) tushadi.
let ICE_SERVERS = _STATIC_ICE;
let _iceAt = 0;
async function _refreshIce() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const r = await fetch('/api/turn', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.iceServers) && j.iceServers.length) {
      ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...j.iceServers], iceCandidatePoolSize: 10 };
      _iceAt = Date.now();
    }
  } catch (e) { console.warn('[call] /api/turn:', e?.message || e); }
}
sb.auth.onAuthStateChange((_ev, sess) => { if (sess) _refreshIce(); });
setInterval(() => { if (Date.now() - _iceAt > 6 * 3600e3) _refreshIce(); }, 30 * 60e3);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - _iceAt > 6 * 3600e3) _refreshIce();
});

let _pc          = null;
let _localStream = null;
let _callId      = null; // hozirgi qo'ng'iroq yozuvining uuid si
let _callChatId  = null; // chaqiruvchi: qo'ng'iroq boshlangan chat (tarix yozuvi uchun)
let _callPeerUid = null;
const _logged    = new Set(); // tarix yozuvi ikki marta yozilmasin
let _pendingIce  = [];   // call yozuvi yaratilguncha kelgan ICE candidate'lar
let _callUnsub   = null;
let _callTimer   = null;
let _callSec     = 0;
let _callIsVideo = false;
let _isCaller    = false;
let _facingMode  = 'user'; // 'user' = old kamera, 'environment' = orqa kamera

// ── Qo'ng'iroq davomida video yoqish/o'chirish (Telegram uslubi: bitta
// "qo'ng'iroq" tugmasi bilan boshlanadi, video esa faol qo'ng'iroq ichida
// kamera tugmasi bosilganda yoqiladi) uchun holat ──
let _localVideoOn      = false; // biz hozir video yuboryapmizmi
let _remoteHasVideo    = false; // qarshi tomon hozir video yuboryaptimi
let _callConnected     = false; // ulanish effektlari (beep/timer) faqat 1 marta ishga tushishi uchun
let _lastRenegoOfferTs  = 0;
let _lastRenegoAnswerTs = 0;

/* ─── RINGBACK TONE ─────────────────────────────────────────────────── */
let _ringbackCtx  = null;
let _ringbackLoop = null;

function _playRingback() {
  _stopRingback();
  try {
    _ringbackCtx = new (window.AudioContext || window.webkitAudioContext)();
    function _beep() {
      if (!_ringbackCtx) return;
      const osc  = _ringbackCtx.createOscillator();
      const gain = _ringbackCtx.createGain();
      osc.connect(gain); gain.connect(_ringbackCtx.destination);
      osc.type = 'sine'; osc.frequency.value = 425;
      gain.gain.setValueAtTime(0, _ringbackCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.18, _ringbackCtx.currentTime + 0.02);
      gain.gain.setValueAtTime(0.18, _ringbackCtx.currentTime + 0.95);
      gain.gain.linearRampToValueAtTime(0, _ringbackCtx.currentTime + 1.0);
      osc.start(_ringbackCtx.currentTime);
      osc.stop(_ringbackCtx.currentTime + 1.0);
    }
    _beep();
    _ringbackLoop = setInterval(_beep, 5000);
  } catch (_) {}
}

function _stopRingback() {
  clearInterval(_ringbackLoop); _ringbackLoop = null;
  if (_ringbackCtx) { try { _ringbackCtx.close(); } catch(_){} _ringbackCtx = null; }
}

/* ─── INCOMING RINGTONE (qabul qiluvchi uchun) ──────────────────────── */
let _ringCtx      = null;
let _ringLoop     = null;
let _ringVibrate  = null;

function _startRingtone() {
  _stopRingtone();

  // So'zsiz marimba/music-box melodiyasi (WebAudio, fayl kerak emas): pentatonika, har ~3.2s da takrorlanadi.
  // Eslatma: veb-ilova qurilmaning tizim ringtone'ini o'qiy olmaydi — shuning uchun doim shu melodiya.
  try {
    _ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ringCtx.state === 'suspended') _ringCtx.resume().catch(() => {});

    const MELODY = [ // [chastota Hz, boshlanish s]
      [659.25, 0.00], [783.99, 0.20], [1046.5, 0.40], [783.99, 0.70],
      [659.25, 0.90], [783.99, 1.10], [1174.66, 1.30], [1046.5, 1.70],
    ];
    function _marimba(freq, t) {
      const g = _ringCtx.createGain();
      g.connect(_ringCtx.destination);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      [[1, 1], [4, 0.22], [10, 0.05]].forEach(([mul, amp]) => {
        const o = _ringCtx.createOscillator();
        const og = _ringCtx.createGain();
        og.gain.value = amp;
        o.type = 'sine';
        o.frequency.value = freq * mul;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + 1);
      });
    }
    function _ringOnce() {
      if (!_ringCtx) return;
      const t0 = _ringCtx.currentTime + 0.02;
      MELODY.forEach(([f, dt]) => _marimba(f, t0 + dt));
    }

    _ringOnce();
    _ringLoop = setInterval(_ringOnce, 3200);
  } catch (_) {}

  // Tebranish pattern: [jiringlash, pauza, jiringlash, pauza...]
  if (navigator.vibrate) {
    const vibratePattern = [500, 500, 500, 500, 500, 500];
    navigator.vibrate(vibratePattern);
    _ringVibrate = setInterval(() => {
      if (navigator.vibrate) navigator.vibrate(vibratePattern);
    }, 3000);
  }
}

function _stopRingtone() {
  clearInterval(_ringLoop);   _ringLoop = null;
  clearInterval(_ringVibrate); _ringVibrate = null;
  if (_ringCtx) {
    try { _ringCtx.close(); } catch (_) {}
    _ringCtx = null;
  }
  if (navigator.vibrate) navigator.vibrate(0); // tebranishni to'xtatish
}

function _playConnectBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(1100, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.28);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => { try { ctx.close(); } catch(_){} };
  } catch (_) {}
}

/* ── Classic end-call / reject tones ─────────────────────────────────────
 * local  — men qizilni bosdim yoki ring timeout (40–45s) avto-tugatish
 * remote — qarshi tomon o'zi qizilni bosdi / rad etdi
 * Farqi seziladi: local = classic ikki pasayuvchi beep; remote = yumshoqroq uchlik. */
function _playCallEndSound(kind = 'local') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.02;
    const mk = (freq, start, dur, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t0 + start);
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(vol, t0 + start + 0.02);
      g.gain.setValueAtTime(vol, t0 + start + Math.max(0.04, dur - 0.06));
      g.gain.linearRampToValueAtTime(0, t0 + start + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0 + start);
      o.stop(t0 + start + dur + 0.02);
    };
    if (kind === 'remote') {
      // U tugatdi: pastroq, 3 ta qisqa ("busy/hangup boshqacha")
      mk(420, 0.00, 0.14, 0.16);
      mk(360, 0.16, 0.14, 0.14);
      mk(300, 0.32, 0.18, 0.12);
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 700);
    } else {
      // Men / timeout: classic end-call — ikki pasayuvchi ton
      mk(480, 0.00, 0.16, 0.20);
      mk(320, 0.18, 0.22, 0.18);
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 550);
    }
  } catch (_) {}
}

/* ══════════════════════════════════════════════════════════════════════
   UMUMIY (SHARED) AudioContext — BUGFIX (2026-07-08)
   ══════════════════════════════════════════════════════════════════════
   ILGARI: har bir qo'ng'iroqda 3 TA ALOHIDA AudioContext yaratilardi —
   mikrofon "pulse" animatsiyasi uchun, VAD (ovoz aniqlash) uchun, va suhbatdosh
   ovozini tahlil qilish uchun. Bu:
     1) Mobil brauzerlarda (ayniqsa iOS Safari) resurs bo'lib ketardi —
        bir nechta parallel AudioContext ba'zan ovoz kesilishi/g'ijirlashiga
        sabab bo'lardi.
     2) Fon rejimiga o'tilganda (ekran qulflansa, boshqa ilova ochilsa)
        brauzer AudioContext'larni avtomatik "suspend" qiladi — kod esa
        ularni qayta "resume" qilmasdi. Natijada TASODIFIY: suhbatdosh ovozi
        umuman eshitilmay qoladi (audio elementi "ijro etilyapti", lekin
        WebAudio grafigi to'xtatilgan bo'lgani uchun tovush chiqmaydi) YOKI
        mikrofon tahlili doim "jimlik" o'qib, foydalanuvchi gapirsa ham
        aniqlanmay qoladi ("mikrofon eshitmayapti").
   ENDI: bitta AudioContext yaratiladi va butun sessiya davomida saqlanadi
   (yopilmaydi) — har ishlatishdan oldin resume() chaqiriladi, shuningdek
   sahifa qayta ko'rinadigan bo'lganda (visibilitychange) ham avtomatik
   resume qilinadi. */
let _sharedAudioCtx = null;

function _getSharedAudioCtx() {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
    _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume().catch(() => {});
  }
  return _sharedAudioCtx;
}

// Ilova fonga o'tib qaytganda (ekran qulflanishi, boshqa ilova, tab
// almashtirish) — qo'ng'iroq hali faol bo'lsa audio grafigini darhol
// tiklaymiz, aks holda foydalanuvchi qaytib kelganda ovoz "o'lik" qolib
// ketishi mumkin edi.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _pc) {
    _sharedAudioCtx?.resume().catch(() => {});
  }
});

/* ─── MIC PULSE ANIMATSIYA ──────────────────────────────────────────── */
let _micAnalyserFrame = null;

function _startMicPulse(stream) {
  _stopMicPulse();
  const wrap = document.getElementById('callActiveAvi');
  if (!wrap) return;

  // img ni topamiz yoki fallback sifatida wrap ni ishlatamiz
  const img = wrap.querySelector('img') || wrap;

  // wrapper ga overflow:visible berish — scale kesib qolmasin
  wrap.style.overflow        = 'visible';
  wrap.style.willChange      = 'box-shadow';
  wrap.style.transformOrigin = '50% 50%';

  // img smooth scale uchun
  img.style.willChange      = 'transform';
  img.style.transformOrigin = '50% 50%';
  img.style.borderRadius    = '50%';

  try {
    const ctx      = _getSharedAudioCtx();
    const src      = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize        = 512;
    analyser.smoothingTimeConstant = 0.75;   // smooth
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    // Eksponensial smoothing uchun
    let smoothLevel = 0;

    function _tick() {
      _micAnalyserFrame = requestAnimationFrame(_tick);
      analyser.getByteFrequencyData(data);

      // Faqat nutq diapazonini olish (200–3000 Hz)
      const binHz   = (ctx.sampleRate / analyser.fftSize);
      const lo      = Math.floor(200  / binHz);
      const hi      = Math.ceil(3000  / binHz);
      let sum = 0;
      for (let i = lo; i <= hi && i < data.length; i++) sum += data[i];
      const raw = sum / ((hi - lo) || 1);

      // Yumshoq o'tish (attack tez, release sekin)
      const target = Math.min(raw / 90, 1);
      smoothLevel += target > smoothLevel
        ? (target - smoothLevel) * 0.35   // attack
        : (target - smoothLevel) * 0.12;  // release

      const scale = 1 + smoothLevel * 0.32;          // max ~1.32x
      const ring1 = Math.round(smoothLevel * 18);    // yaqin ring px
      const ring2 = Math.round(smoothLevel * 38);    // uzoq ring px
      const a1    = (0.15 + smoothLevel * 0.75).toFixed(2);
      const a2    = (0.05 + smoothLevel * 0.35).toFixed(2);

      // IMG: smooth scale
      img.style.transform  = `scale(${scale.toFixed(4)})`;

      // WRAPPER: glow rings
      wrap.style.boxShadow =
        `0 0 0 ${ring1}px rgba(29,155,240,${a1}),` +
        `0 0 0 ${ring2}px rgba(29,155,240,${a2}),` +
        `0 0 ${ring2 * 2}px rgba(99,179,237,${(a2 * 0.6).toFixed(2)})`;
    }
    _tick();
  } catch (_) {}
}

function _stopMicPulse() {
  if (_micAnalyserFrame) { cancelAnimationFrame(_micAnalyserFrame); _micAnalyserFrame = null; }
  const wrap = document.getElementById('callActiveAvi');
  if (wrap) {
    const img = wrap.querySelector('img') || wrap;
    img.style.transform  = 'scale(1)';
    wrap.style.boxShadow = '';
    wrap.style.overflow  = 'hidden';
    setTimeout(() => { img.style.transform = ''; }, 320);
    // ESLATMA: bu yerda AudioContext'ni endi YOPMAYMIZ — u umumiy
    // (_getSharedAudioCtx) va butun sessiya davomida qayta ishlatiladi;
    // yopish keyingi qo'ng'iroqlarda yangi context yaratish zarurati va
    // shu bilan bog'liq tasodifiy audio muammolarni qaytarardi.
  }
}

/* ── Yordamchi: timer ── */
function _startCallTimer() {
  _callSec = 0;
  clearInterval(_callTimer);
  _callTimer = setInterval(() => {
    _callSec++;
    const m = String(Math.floor(_callSec / 60)).padStart(2, '0');
    const s = String(_callSec % 60).padStart(2, '0');
    const el = document.getElementById('callTimer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function _stopCallTimer() {
  clearInterval(_callTimer);
  _callTimer = null;
  _callSec   = 0;
}

/* ── Yordamchi: voice-wrap ↔ video-wrap orasida SMOOTH (crossfade) o'tish ──
   Ikkala qatlam ham doim DOM'da turadi (call-stage ichida ustma-ust), shu
   sababli display:none bilan sakrab o'tish o'rniga opacity/scale bilan
   erib o'tadi (CSS: .cs-active klassi orqali boshqariladi). */
function _setVideoModeUI(showVideo) {
  const modal      = document.getElementById('callActiveModal');
  const videoWrap  = document.getElementById('callVideoWrap');
  const voiceWrap  = document.getElementById('callVoiceWrap');
  const camBtn     = document.getElementById('callCamBtn');
  const switchBtn  = document.getElementById('callSwitchCamBtn');

  modal?.classList.toggle('video-mode', !!showVideo);
  videoWrap?.classList.toggle('cs-active', !!showVideo);
  voiceWrap?.classList.toggle('cs-active', !showVideo);

  const localVideoEl = document.getElementById('callLocalVideo');
  localVideoEl?.classList.toggle('cs-active', _localVideoOn);

  if (camBtn) {
    camBtn.classList.toggle('active', _localVideoOn);
    camBtn.classList.toggle('muted',  showVideo && !_localVideoOn);
    camBtn.title = _localVideoOn ? 'Kamerani o\'chirish' : 'Videoni yoqish';
  }
  // Kamera almashtirish tugmasi faqat biz o'zimiz video yuborayotganda kerak
  const switchCol = document.getElementById('callSwitchCol');
  if (switchCol) switchCol.style.display = _localVideoOn ? '' : 'none';
}

/* ── Yordamchi: modal ko'rsatish ── */
/* Avatar rasm bo'lmasa — ismning bosh harfi bilan doira (Telegram/Discord uslubida) */
function _avatarHTML(name, photoUrl) {
  if (photoUrl) return `<img src="${esc(photoUrl)}" onerror="this.style.display='none'">`;
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="call-avi-initial">${letter}</span>`;
}

function _showActiveCallModal(otherName, otherAvi, isVideo) {
  const modal = document.getElementById('callActiveModal');
  const nameEl = document.getElementById('callActiveName');
  const aviEl  = document.getElementById('callActiveAvi');
  const statusEl = document.getElementById('callStatus');
  const timerEl  = document.getElementById('callTimer');

  if (nameEl)   nameEl.textContent = otherName || 'Foydalanuvchi';
  if (aviEl)    aviEl.innerHTML = _avatarHTML(otherName, otherAvi);
  if (statusEl) statusEl.textContent = 'Qo\'ng\'iroq qilinmoqda...';
  if (timerEl)  timerEl.textContent  = '00:00';

  // Endi barcha qo'ng'iroqlar OVOZLI boshlanadi (Telegram uslubi — hdr'da
  // bitta tugma bor); video faqat qo'ng'iroq ichida kamera tugmasi bilan
  // yoqiladi. `isVideo` faqat eski/dasturiy chaqiruvlar uchun saqlanadi.
  _localVideoOn   = !!isVideo;
  _remoteHasVideo = false;
  _setVideoModeUI(!!isVideo);

  modal?.classList.add('show');
}

function _hideActiveCallModal() {
  document.getElementById('callActiveModal')?.classList.remove('show', 'video-mode');
}

/* ── JIRINGLASH VAQTI — BITTA joyda. Shu vaqt ichida javob bo'lmasa qo'ng'iroq avtomatik tugaydi
   (chaqiruvchi ham, qabul qiluvchi ham). Server zaxirasi: supabase/migrations/070_call_ring_expiry.sql ── */
export const CALL_RING_MAX_MS = 45000;
let _callerRingTimer = null;
let _callAnswerSeen  = false;
function _clearCallerRingTimer() { if (_callerRingTimer) { clearTimeout(_callerRingTimer); _callerRingTimer = null; } }

/* ── Qo'ng'iroqni to'liq tugatish ── */
let _ending = false;
async function _endCall(notify = true, endSound = null) {
  if (_ending) return;
  _ending = true;
  // endSound: 'local' | 'remote' | null (ovozsiz — ichki tozalash)
  if (endSound === 'local' || endSound === 'remote') _playCallEndSound(endSound);
  // Tarix yozuvi — faqat chaqiruvchi, bir marta
  let _log = null;
  if (_isCaller && _callId && _callChatId && !_logged.has(_callId)) {
    _logged.add(_callId);
    _log = { chat: _callChatId, peer: _callPeerUid, connected: _callConnected, sec: _callSec };
  }
  _stopCallTimer();
  _clearCallerRingTimer();
  _stopRingback();
  _stopMicPulse();
  _cleanCallModal();

  if (_callUnsub) { _callUnsub(); _callUnsub = null; }

  if (_localStream) {
    try { _localStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    _localStream = null;
  }
  if (_pc) {
    try { _pc.close(); } catch (_) {}
    _pc = null;
  }

  const rv = document.getElementById('callRemoteVideo');
  const lv = document.getElementById('callLocalVideo');
  const ra = document.getElementById('callRemoteAudio');
  if (rv) rv.srcObject = null;
  if (lv) lv.srcObject = null;
  if (ra) ra.srcObject = null;

  _hideActiveCallModal();
  document.getElementById('incomingCallModal')?.classList.remove('show');

  // Avval status=ended (boshqa tab/PWA/domain ringing ni to'xtatadi), keyin delete
  const idToDelete = _callId;
  if (idToDelete) {
    let done = false;
    try { await _withTimeout(sb.from('calls').update({ status: 'ended' }).eq('id', idToDelete)); } catch (_) {}
    for (let i = 0; i < 2 && !done; i++) {
      try {
        const res = await _withTimeout(sb.from('calls').delete().eq('id', idToDelete));
        if (!res) break;                 // tarmoq yo'q / timeout — _ending osilib qolmasin
        if (!res.error) done = true;
      } catch (_) {}
    }
    if (!done) _beaconEnd(idToDelete);   // keyinroq (online / refresh) albatta yopiladi
  }
  _callId = null;
  _callChatId = null; _callPeerUid = null;
  _pendingIce = [];
  _isCaller   = false;
  _facingMode = 'user';
  _localVideoOn = false;
  _remoteHasVideo = false;
  _callConnected = false;
  _lastRenegoOfferTs = 0;
  _lastRenegoAnswerTs = 0;
  _ending = false;

  if (_log) sendCallLog(_log.chat, _log.peer, { connected: _log.connected, seconds: _log.sec });
}

/* ── PeerConnection yaratish ── */
function _createPC() {
  if (_pc) { _pc.close(); }
  _pc = new RTCPeerConnection(ICE_SERVERS);

  _pc.ontrack = e => {
    const track  = e.track;
    const stream = e.streams[0];

    if (track.kind === 'video') {
      const rv = document.getElementById('callRemoteVideo');
      if (rv) rv.srcObject = stream;

      // Qarshi tomon video trackni enabled=false qilib qo'ysa (kamerani
      // o'chirsa), bu tomonda WebRTC spetsifikatsiyasiga ko'ra shu
      // qabul qilinayotgan track uchun 'mute'/'unmute' hodisalari
      // avtomatik chaqiriladi — shu orqali UI'ni smooth almashtiramiz.
      _remoteHasVideo = !track.muted;
      _setVideoModeUI(_localVideoOn || _remoteHasVideo);

      track.onunmute = () => { _remoteHasVideo = true;  _setVideoModeUI(true); };
      track.onmute   = () => { _remoteHasVideo = false; _setVideoModeUI(_localVideoOn); };
    } else {
      const ra = document.getElementById('callRemoteAudio');
      if (ra) {
        ra.srcObject = stream;
        // Default = earpiece (quloqqa tutilsa eshitiladi)
        setTimeout(() => _applySpeaker(_speakerOn), 300);
      }
    }

    // Qo'ng'iroq ulandi — bu effektlar faqat BIRINCHI marta ishga tushsin
    // (video keyinroq qo'shilganda qayta beep/timer restart bo'lmasin).
    if (!_callConnected) {
      _callConnected = true;
      _stopRingback();
      _playConnectBeep();
      _startMicPulse(_localStream);
      const statusEl = document.getElementById('callStatus');
      if (statusEl) statusEl.textContent = 'Ulandi';
      _startCallTimer();
    }
  };

  _pc.onicecandidate = e => {
    if (!e.candidate) return;
    const c = e.candidate.toJSON();
    if (_callId) _sendIce(_callId, c);
    else _pendingIce.push(c);   // yozuv hali yaratilmagan — keyin yuboriladi
  };

  _pc.onconnectionstatechange = () => {
    if (_pc?.connectionState === 'disconnected' ||
        _pc?.connectionState === 'failed' ||
        _pc?.connectionState === 'closed') {
      _hardEnd('pc-' + _pc?.connectionState);
    }
  };

  return _pc;
}

/* ── Qo'ng'iroq DAVOMIDA video yoqilganda qayta muzokara (renegotiation) ──
   Boshlang'ich ulanish faqat ovoz bilan tuziladi. Foydalanuvchi kamera
   tugmasini bosganda YANGI video track qo'shiladi — buni qarshi tomonga
   yetkazish uchun signalingni "offer/answer" jarayonini YANA BIR MARTA
   (calls jadvalidagi alohida video_offer/video_answer ustunlari
   orqali) o'tkazamiz. Har ikki tomon ham o'zining kuzatuvchisi (_watchCall)
   ichida shuni tekshiradi. */
async function _handleRenego(data) {
  if (!_pc || !_callId || !state.me) return;

  if (data.videoOffer &&
      data.videoOffer.from !== state.me.uid &&
      data.videoOffer.ts !== _lastRenegoOfferTs) {
    _lastRenegoOfferTs = data.videoOffer.ts;
    try {
      await _pc.setRemoteDescription(new RTCSessionDescription(data.videoOffer));
      const answer = await _pc.createAnswer();
      await _pc.setLocalDescription(answer);
      await _updateCall(_callId, {
        video_answer: { type: answer.type, sdp: answer.sdp, from: state.me.uid, ts: Date.now() }
      });
    } catch (err) {
      console.error('[Call] Video taklifini qayta ishlab bo\'lmadi:', err);
    }
  }

  if (data.videoAnswer &&
      data.videoAnswer.from !== state.me.uid &&
      data.videoAnswer.ts !== _lastRenegoAnswerTs) {
    _lastRenegoAnswerTs = data.videoAnswer.ts;
    if (_pc.signalingState === 'have-local-offer') {
      try {
        await _pc.setRemoteDescription(new RTCSessionDescription(data.videoAnswer));
      } catch (err) {
        console.error('[Call] Video javobini qayta ishlab bo\'lmadi:', err);
      }
    }
  }
}

/* ── Qo'ng'iroq ichida videoni yoqish (kamera tugmasi) ── */
async function _enableLocalVideo() {
  if (_localVideoOn || !_pc || !_localStream || !_callId) return;

  let track = _localStream.getVideoTracks()[0];
  try {
    if (!track) {
      const vidStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: _facingMode }
      });
      track = vidStream.getVideoTracks()[0];
      _localStream.addTrack(track);
      _pc.addTrack(track, _localStream);
    } else {
      track.enabled = true;
    }
  } catch (err) {
    toast('Kameraga ruxsat yo\'q: ' + err.message, 'error');
    return;
  }

  const lv = document.getElementById('callLocalVideo');
  if (lv) lv.srcObject = _localStream;

  _localVideoOn = true;
  _callIsVideo  = true;
  _setVideoModeUI(true);

  // Qarshi tomonga yangi trackni yetkazish uchun qayta muzokara boshlaymiz
  try {
    const offer = await _pc.createOffer();
    await _pc.setLocalDescription(offer);
    await _updateCall(_callId, {
      video_offer: { type: offer.type, sdp: offer.sdp, from: state.me.uid, ts: Date.now() }
    });
  } catch (err) {
    console.error('[Call] Video taklifini yuborib bo\'lmadi:', err);
  }
}

/* ── Qo'ng'iroq ichida videoni o'chirish (kamera tugmasi) ──
   Trackni butunlay olib tashlamaymiz (qayta yoqishda tezroq bo'lishi va
   yana renegotiation kerak bo'lmasligi uchun) — shunchaki enabled=false
   qilamiz. Bu qarshi tomonda ham avtomatik 'mute' hodisasini chaqiradi. */
function _disableLocalVideo() {
  const track = _localStream?.getVideoTracks()[0];
  if (track) track.enabled = false;
  _localVideoOn = false;
  _setVideoModeUI(_remoteHasVideo);
}

/* ── Qo'ng'iroq boshlash (caller) ── */
async function initiateCall(isVideo) {
  const uid = state.currentChatUid;
  if (!uid || !state.me) return;
  // Ikki marta bosish / parallel tab — bitta faol qo'ng'iroq
  if (_pc || _callId || _ending) {
    toast("Allaqachon qo'ng'iroqdasiz", 'error');
    return;
  }

  // O'zining eski 'ringing' ghostlarini yop (boshqa tab/PWA qoldirgan)
  try {
    await sb.from('calls').update({ status: 'ended' })
      .eq('caller_id', state.me.uid).eq('status', 'ringing');
  } catch (_) {}

  _callIsVideo = isVideo;
  _isCaller    = true;
  _facingMode  = 'user';
  _callChatId  = state.currentChatId || null;
  _callPeerUid = uid;

  // Har yangi qo'ng'iroqda speaker = off (earpiece, default)
  _speakerOn = false;
  const spBtn = document.getElementById('callSpeakerBtn');
  if (spBtn) { spBtn.classList.remove('active'); spBtn.title = 'Dinamik (ovoz)'; }

  try {
    _localStream = await navigator.mediaDevices.getUserMedia(
      isVideo ? { audio: true, video: { facingMode: _facingMode } } : { audio: true }
    );
  } catch (err) {
    toast('Mikrofon/kameraga ruxsat yo\'q: ' + err.message, 'error');
    return;
  }

  // Local video preview
  if (isVideo) {
    const lv = document.getElementById('callLocalVideo');
    if (lv) lv.srcObject = _localStream;
  }

  // Qabul qiluvchi ma'lumotlari
  let otherName = document.getElementById('chatThreadName')?.textContent || 'Foydalanuvchi';
  let otherAvi  = '';
  try {
    const d = await _userInfo(uid);
    otherName = d.fullName || otherName;
    otherAvi  = d.avatar   || '';
  } catch (e) { console.warn('[call]', e?.message || e); }

  _showActiveCallModal(otherName, otherAvi, isVideo);
  _playRingback();

  // PC yaratish va track qo'shish
  _createPC();
  _localStream.getTracks().forEach(t => _pc.addTrack(t, _localStream));

  // Offer yaratish
  const offer = await _pc.createOffer();
  await _pc.setLocalDescription(offer);

  // Supabase'da call yozuvi. id ni client beradi (insert...select RLS'dan o'tmasligi mumkin).
  const callId = crypto.randomUUID();
  const { error: insErr } = await sb.from('calls').insert({
    id: callId,
    caller_id: state.me.uid,
    callee_id: uid,
    type: isVideo ? 'video' : 'voice',
    status: 'ringing',
    offer: { type: offer.type, sdp: offer.sdp },
  });
  if (insErr) {
    console.error("[Call] Qo'ng'iroq yozuvini yaratib bo'lmadi:", insErr.message);
    toast("Qo'ng'iroqni boshlab bo'lmadi. Internetni tekshirib, qayta urinib ko'ring.", 'error');
    _hideActiveCallModal();
    _stopRingback();
    if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
    if (_pc) { _pc.close(); _pc = null; }
    _pendingIce = [];
    return;
  }
  _callId = callId;
  _callAnswerSeen = false;

  // Maksimal jiringlash vaqti: javob bo'lmasa avtomatik tugatamiz
  _clearCallerRingTimer();
  _callerRingTimer = setTimeout(async () => {
    _callerRingTimer = null;
    if (_callId !== callId || _callConnected || _callAnswerSeen || _ending) return;
    // Faqat hali 'ringing' bo'lsa yopamiz (shu orasida qabul qilingan bo'lsa 0 qator o'zgaradi)
    try { await _withTimeout(sb.from('calls').update({ status: 'ended' }).eq('id', callId).eq('status', 'ringing')); } catch (_) {}
    if (_callId !== callId || _callConnected || _callAnswerSeen || _ending) return;
    toast('Javob bermadi');
    _hardEnd('ring-timeout');   // realtime kutmaymiz — darhol to'liq tugatamiz
  }, CALL_RING_MAX_MS);

  // Yozuv yaratilguncha yig'ilgan ICE candidate'larni yuboramiz
  const early = _pendingIce; _pendingIce = [];
  early.forEach(c => _sendIce(callId, c));

  // Answer kutish
  _callUnsub = _watchCall(callId, async data => {
    if (data && (data.answer || (data.status && data.status !== 'ringing'))) { _callAnswerSeen = true; _clearCallerRingTimer(); }
    if (!data) { await _endCall(false); return; }

    if (data.status === 'declined' || data.status === 'ended') {
      // Qarshi tomon rad etdi yoki qizilni bosdi
      await _endCall(false, 'remote');
      return;
    }
    if (!_pc) return;

    // FAQAT birinchi (boshlang'ich) answer uchun. Aks holda qo'ng'iroq ichida video yoqilganda
    // (signalingState yana 'have-local-offer') eski answer qayta qo'llanib xato berardi va
    // _handleRenego (video_answer) hech qachon ishlamay qolardi.
    if (data.answer && !_pc.remoteDescription && _pc.signalingState === 'have-local-offer') {
      try {
        await _pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (e) { console.error('[Call] answer qo\'llanmadi:', e); }
    }

    // Callee ICE candidates
    if (data.calleeCandidates?.length) {
      const existing = _pc._addedCallee || 0;
      const newOnes  = data.calleeCandidates.slice(existing);
      _pc._addedCallee = data.calleeCandidates.length;
      for (const c of newOnes) {
        try { await _pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('[call]', e?.message || e); }
      }
    }

    // Qo'ng'iroq davomida video yoqilgan bo'lsa — qayta muzokara
    await _handleRenego(data);
  });
}

/* ── Kiruvchi qo'ng'iroqni qabul qilish (callee) ── */
async function _acceptIncomingCall(callData, callId) {
  _callIsVideo = callData.type === 'video';
  _isCaller    = false;
  _callId      = callId;
  _facingMode  = 'user';

  document.getElementById('incomingCallModal')?.classList.remove('show');

  try {
    _localStream = await navigator.mediaDevices.getUserMedia(
      _callIsVideo ? { audio: true, video: { facingMode: _facingMode } } : { audio: true }
    );
  } catch (err) {
    toast("Mikrofon/kameraga ruxsat yo'q: " + err.message, 'error');
    try { await _updateCall(callId, { status: 'declined' }); } catch (e) { console.warn('[call]', e?.message || e); }
    _callId = null;
    return;
  }

  if (_callIsVideo) {
    const lv = document.getElementById('callLocalVideo');
    if (lv) lv.srcObject = _localStream;
  }

  // Caller ma'lumotlari
  let callerName = 'Foydalanuvchi', callerAvi = '';
  try {
    const d = await _userInfo(callData.callerId);
    callerName = d.fullName || callerName;
    callerAvi  = d.avatar   || '';
  } catch (e) { console.warn('[call]', e?.message || e); }

  _showActiveCallModal(callerName, callerAvi, _callIsVideo);

  _createPC();
  _localStream.getTracks().forEach(t => _pc.addTrack(t, _localStream));

  await _pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

  // Caller ICE candidates (mavjudlarini qo'shish)
  if (callData.callerCandidates?.length) {
    _pc._addedCaller = callData.callerCandidates.length;
    for (const c of callData.callerCandidates) {
      try { await _pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('[call]', e?.message || e); }
    }
  }

  const answer = await _pc.createAnswer();
  await _pc.setLocalDescription(answer);

  // Faqat hali 'ringing' bo'lsa qabul qilamiz (chaqiruvchi bekor qilgan bo'lsa 0 qator o'zgaradi)
  const { data: upd, error: updErr } = await sb.from('calls')
    .update({ answer: { type: answer.type, sdp: answer.sdp }, status: 'accepted' })
    .eq('id', callId).eq('status', 'ringing').select('id');
  if (updErr || !upd?.length) {
    console.warn("[Call] Qo'ng'iroq allaqachon tugagan yoki qabul qilib bo'lmadi:", updErr?.message);
    await _endCall(false);
    return;
  }

  // Caller ICE candidates stream
  _callUnsub = _watchCall(callId, async data => {
    if (!data) { await _endCall(false); return; }
    if (data.status === 'ended') { await _endCall(false, 'remote'); return; }
    if (!_pc) return;

    if (data.callerCandidates?.length) {
      const existing = _pc._addedCaller || 0;
      const newOnes  = data.callerCandidates.slice(existing);
      _pc._addedCaller = data.callerCandidates.length;
      for (const c of newOnes) {
        try { await _pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('[call]', e?.message || e); }
      }
    }

    // Qo'ng'iroq davomida video yoqilgan bo'lsa — qayta muzokara
    await _handleRenego(data);
  });
}

/* ── Kiruvchi qo'ng'iroqni kuzatish ── */
let _incomingUnsub  = null;
let _activeCallDocId = null; // hozir ko'rsatilayotgan qo'ng'iroq ID si (duplicate oldini olish)
let _autoRejectTimer = null;

// Tugma listenerlarini tozalash uchun ref lar
let _boundAccept = null;
let _boundReject = null;

function _cleanCallModal() {
  const acceptBtn = document.getElementById('incomingCallAccept');
  const rejectBtn = document.getElementById('incomingCallReject');
  if (_boundAccept) { acceptBtn?.removeEventListener('click', _boundAccept); _boundAccept = null; }
  if (_boundReject) { rejectBtn?.removeEventListener('click', _boundReject); _boundReject = null; }
  if (_autoRejectTimer) { clearTimeout(_autoRejectTimer); _autoRejectTimer = null; }
  _activeCallDocId = null;
  _stopRingtone();
  document.getElementById('incomingCallModal')?.classList.remove('show');
}

// 'ringing' holatida shuncha vaqtdan eski yozuvlar (chaqiruvchi ilovasi yopilib qolgan) e'tiborga olinmaydi
const RING_WINDOW_MS = CALL_RING_MAX_MS + 60000;
const RING_GHOST_MS  = CALL_RING_MAX_MS + 30000;   // soat farqi uchun zaxira

async function _handleIncomingRow(data) {
  // Qo'ng'iroq tugagan — modal yopish
  if (!data) {
    if (_activeCallDocId) _cleanCallModal();
    return;
  }

  // Allaqachon shu qo'ng'iroq ko'rsatilmoqda — qayta ochmaymiz
  if (_activeCallDocId === data.id) return;

  // Allaqachon qo'ng'iroqda bo'lsak — rad etamiz
  if (_pc) {
    try { await _updateCall(data.id, { status: 'declined' }); } catch (e) { console.warn('[call]', e?.message || e); }
    return;
  }

  // Avvalgi modal tozalash (eski listenerlar olib tashlanadi)
  _cleanCallModal();
  _activeCallDocId = data.id;

  // Caller ma'lumotlari
  let callerName = 'Foydalanuvchi', callerAvi = '';
  try {
    const ud = await _userInfo(data.callerId);
    callerName = ud.fullName || callerName;
    callerAvi  = ud.avatar   || '';
  } catch (e) { console.warn('[call]', e?.message || e); }

  // Kiruvchi qo'ng'iroq modal
  const modal     = document.getElementById('incomingCallModal');
  const nameEl    = document.getElementById('incomingCallName');
  const typeEl    = document.getElementById('incomingCallType');
  const aviEl     = document.getElementById('incomingCallAvi');
  const acceptBtn = document.getElementById('incomingCallAccept');
  const rejectBtn = document.getElementById('incomingCallReject');

  if (nameEl) nameEl.textContent = callerName;
  if (typeEl) typeEl.textContent = data.type === 'video' ? "Video qo'ng'iroq" : "Ovozli qo'ng'iroq";
  if (aviEl)  aviEl.innerHTML = _avatarHTML(callerName, callerAvi);

  modal?.classList.add('show');
  _startRingtone();

  // Qabul qilish
  _boundAccept = async () => {
    _cleanCallModal();
    await _acceptIncomingCall(data, data.id);
  };

  // Rad etish
  _boundReject = async () => {
    _playCallEndSound('local');  // men rad etdim
    _cleanCallModal();
    try { await _updateCall(data.id, { status: 'declined' }); } catch (e) { console.warn('[call]', e?.message || e); }
  };

  acceptBtn?.addEventListener('click', _boundAccept);
  rejectBtn?.addEventListener('click', _boundReject);

  // Maksimal jiringlash vaqtidan keyin avtomatik rad etish (CALL_RING_MAX_MS)
  _autoRejectTimer = setTimeout(async () => {
    if (_activeCallDocId === data.id) {
      _playCallEndSound('local');  // ring timeout — avto-rad
      _cleanCallModal();
      try { await _updateCall(data.id, { status: 'declined' }); } catch (e) { console.warn('[call]', e?.message || e); }
    }
  }, CALL_RING_MAX_MS);
}

export function startCallWatcher() {
  if (!state.me?.uid) return;
  stopCallWatcher();

  const me = state.me.uid;
  flushPendingCallEnd();
  let stopped = false, busy = false, again = false;

  // Menga kelayotgan 'ringing' qo'ng'iroqni so'rab, modalni yangilaydi (parallel chaqiruvlar birlashtiriladi)
  const refresh = async () => {
    if (stopped) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        const since = new Date(Date.now() - RING_WINDOW_MS).toISOString();
        const { data, error } = await sb.from('calls').select('*')
          .eq('callee_id', me).eq('status', 'ringing').gte('created_at', since)
          .order('created_at', { ascending: false }).limit(3);
        if (stopped) return;
        if (error) { console.error('[CallWatcher] xato:', error.message); continue; }
        const rows = data || [];
        // Maksimal jiringlashdan ancha eski ringing — ghost, yopamiz
        const now = Date.now();
        for (const row of rows) {
          const age = now - Date.parse(row.created_at);
          if (age > RING_GHOST_MS) {
            try { await sb.from('calls').update({ status: 'ended' }).eq('id', row.id).eq('status', 'ringing'); } catch (_) {}
          }
        }
        const fresh = rows.find(r => now - Date.parse(r.created_at) <= RING_GHOST_MS);
        await _handleIncomingRow(fresh ? mapCall(fresh) : null);
      } while (again && !stopped);
    } finally { busy = false; }
  };

  const ch = sb.channel('incoming-calls-' + me)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: 'callee_id=eq.' + me }, p => {
      // Payload'ning o'zidan DARHOL jiringlaymiz (qo'shimcha select kutmaymiz); keyin refresh holatni tekshiradi
      const row = p.new;
      if (row && row.status === 'ringing' && Date.now() - Date.parse(row.created_at) < RING_WINDOW_MS) {
        Promise.resolve(_handleIncomingRow(mapCall(row))).catch(() => {});
      } else refresh();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: 'callee_id=eq.' + me }, refresh)
    .subscribe(st => { if (st === 'SUBSCRIBED') refresh(); });

  // Zaxira: realtime uzilib qolsa ham qo'ng'iroq o'tkazib yuborilmasin
  const poll = setInterval(refresh, 10000);

  _incomingUnsub = () => { stopped = true; clearInterval(poll); sb.removeChannel(ch); };
}

export function stopCallWatcher() {
  if (_incomingUnsub) { _incomingUnsub(); _incomingUnsub = null; }
}

/* ── Call tugmasiga click listener ──
   Endi hdr'da bitta tugma bor (Telegram uslubi) — qo'ng'iroq HAR DOIM
   ovozli boshlanadi, video esa faol qo'ng'iroq ichida kamera tugmasi
   bilan yoqiladi (pastga q.). */
document.getElementById('chatVoiceCallBtn')?.addEventListener('click', () => initiateCall(false));

/* ── Active call controls ── */
document.getElementById('callEndBtn')?.addEventListener('click', async () => {
  if (_callId) {
    try { await _updateCall(_callId, { status: 'ended' }); } catch (e) { console.warn('[call]', e?.message || e); }
  }
  await _endCall(false, 'local');  // men qizilni bosdim
});

document.getElementById('callMicBtn')?.addEventListener('click', function () {
  const track = _localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  this.classList.toggle('muted', !track.enabled);
});

document.getElementById('callCamBtn')?.addEventListener('click', async function () {
  if (_localVideoOn) {
    _disableLocalVideo();
  } else {
    await _enableLocalVideo();
  }
});

/* ── Old kamera ↔ orqa kamera almashtirish ── */
let _switchingCam = false;

async function _switchCamera() {
  if (_switchingCam || !_localStream || !_localVideoOn) return;
  const oldTrack = _localStream.getVideoTracks()[0];
  if (!oldTrack) return;

  _switchingCam = true;
  const btn = document.getElementById('callSwitchCamBtn');
  btn?.classList.add('active');

  const wasEnabled = oldTrack.enabled;
  const newFacing  = _facingMode === 'user' ? 'environment' : 'user';

  // Avval eski kamerani to'liq to'xtatamiz — ko'pchilik mobil brauzerlar
  // (Android/iOS) bir vaqtda 2 ta kamera oqimini ochishga ruxsat bermaydi,
  // shuning uchun eskisi ochiq turganda yangisini so'rash xato beradi.
  _localStream.removeTrack(oldTrack);
  oldTrack.stop();

  const getStream = (constraint) => navigator.mediaDevices.getUserMedia({
    audio: false,
    video: constraint
  });

  try {
    let newStream;
    try {
      // Avval qat'iy (exact) urinib ko'ramiz
      newStream = await getStream({ facingMode: { exact: newFacing } });
    } catch (_) {
      // Qurilmada aynan shu label topilmasa, yumshoqroq (ideal) bilan qayta urinamiz
      newStream = await getStream({ facingMode: { ideal: newFacing } });
    }

    const newTrack = newStream.getVideoTracks()[0];
    newTrack.enabled = wasEnabled;

    // Peer connection ga yangi trackni almashtirish (qayta muzokarasiz)
    const sender = _pc?.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) { try { await sender.replaceTrack(newTrack); } catch (_) {} }

    // Local streamga yangi trackni qo'shamiz
    _localStream.addTrack(newTrack);

    // Preview elementini yangilash (ba'zi brauzerlarda kerak bo'ladi)
    const lv = document.getElementById('callLocalVideo');
    if (lv) { lv.srcObject = null; lv.srcObject = _localStream; }

    _facingMode = newFacing;
  } catch (err) {
    console.warn('[Call] Kamera almashtirib bo\'lmadi:', err.message);
    // Eski kamerani qaytarishga urinamiz, aks holda video butunlay o'chib qolmasin
    try {
      const restored = await getStream({ facingMode: { ideal: _facingMode } });
      const restoredTrack = restored.getVideoTracks()[0];
      restoredTrack.enabled = wasEnabled;
      _localStream.addTrack(restoredTrack);
      const sender = _pc?.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) { try { await sender.replaceTrack(restoredTrack); } catch (_) {} }
      const lv = document.getElementById('callLocalVideo');
      if (lv) { lv.srcObject = null; lv.srcObject = _localStream; }
    } catch (_) {}
    toast('Kamerani almashtirib bo\'lmadi. Qurilmangizda faqat bitta kamera bo\'lishi mumkin.', 'error');
  } finally {
    _switchingCam = false;
    btn?.classList.remove('active');
  }
}

document.getElementById('callSwitchCamBtn')?.addEventListener('click', _switchCamera);

/* ── Speaker (earpiece ↔ dinamik) toggle ── */
// _speakerOn = false → earpiece (quloqqa tutilsa eshitiladi, default)
// _speakerOn = true  → dinamik (baland ovoz)
let _speakerOn = false;

async function _applySpeaker(on) {
  const ra = document.getElementById('callRemoteAudio');
  if (!ra) return;

  // setSinkId — Chrome/Edge Android da earpiece vs speaker
  if (typeof ra.setSinkId === 'function') {
    try {
      if (on) {
        // Barcha audio qurilmalarini olish va 'speaker' ni topish
        const devices = await navigator.mediaDevices.enumerateDevices();
        const speaker = devices.find(d =>
          d.kind === 'audiooutput' &&
          (d.label.toLowerCase().includes('speaker') ||
           d.label.toLowerCase().includes('loud') ||
           d.deviceId === 'speaker')
        );
        await ra.setSinkId(speaker?.deviceId || 'default');
      } else {
        // Earpiece — 'communications' device yoki bo'sh string
        const devices = await navigator.mediaDevices.enumerateDevices();
        const earpiece = devices.find(d =>
          d.kind === 'audiooutput' &&
          (d.label.toLowerCase().includes('earpiece') ||
           d.label.toLowerCase().includes('ear') ||
           d.deviceId === 'communications')
        );
        await ra.setSinkId(earpiece?.deviceId || 'communications');
      }
    } catch (err) {
      console.warn('[Call] setSinkId failed:', err.message);
      // Fallback: volume orqali farqlash
      ra.volume = on ? 1.0 : 0.3;
    }
  } else {
    // setSinkId qo'llab-quvvatlanmasa — volume bilan farqlaymiz
    ra.volume = on ? 1.0 : 0.3;
  }
}

document.getElementById('callSpeakerBtn')?.addEventListener('click', async function () {
  _speakerOn = !_speakerOn;
  await _applySpeaker(_speakerOn);
  // muted emas — speaker off = earpiece (baribir eshitiladi, faqat past)
  this.classList.toggle('active', _speakerOn);
  this.title = _speakerOn ? 'Dinamik (yoqiq)' : 'Quloqcha rejimi';
});

// Qo'ng'iroq boshlanganida default = earpiece (past, quloqqa tutilsa eshitiladi)
export function _resetSpeaker() {
  _speakerOn = false;
  _applySpeaker(false);
  const btn = document.getElementById('callSpeakerBtn');
  if (btn) { btn.classList.remove('active'); btn.title = 'Dinamik (ovoz)'; }
}

/* Refresh / tab yopilishi / internet uzilishi — qo'ng'iroq BUTUNLAY tugaydi */
window.addEventListener('pagehide', () => {
  if (!_callId) return;
  _beaconEnd(_callId);
  try { _localStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
  try { _pc?.close(); } catch (_) {}
});
window.addEventListener('beforeunload', () => { if (_callId) _beaconEnd(_callId); });
window.addEventListener('offline', () => _hardEnd('offline'));
window.addEventListener('online', () => { flushPendingCallEnd(); });
