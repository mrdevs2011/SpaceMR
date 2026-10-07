import { smoothScrollIntoView } from '../core/utils.js';
/**
 * chat-voice-player.js — waveform hydrate, playback, mini-player
 * Ehtiyotkor ajratish: paintMessages/closeChatThread chat.js da qoladi.
 */
import { state, mediaSignedUrl } from '../core/config.js';
import { $ } from '../core/utils.js';
import { toast } from '../ui/toast.js';

let _openChatCb = null;

/* ── Voice waveform bars ──────────────────────────────────────────────
 * Boshlanishida — tekis (flat) past bar'lar (real ma'lumot hali yo'q).
 * Audio fayl fonda decode qilingach, har bir bar shu segmentdagi
 * HAQIQIY ovoz amplitudasiga (RMS) qarab balandligini oladi —
 * `_hydrateVoiceWaveforms()` orqali. Shu tufayli baland ovoz — baland
 * bar, past/jim joy — past bar bo'ladi (sun'iy sinus emas). */
const CVM_MIN_BARS  = 48;  // eng qisqa xabar uchun bar soni
const CVM_MAX_BARS  = 72;  // eng uzun xabar uchun bar soni
const CVM_BAR_COUNT = CVM_MIN_BARS; // fallback (davomiylik noma'lum bo'lganda)
const CVM_MIN_H = 2.5; // jim / past joy
const CVM_MAX_H = 28;  // eng baland pik — aniq kontrast

/* Telegram — bar sonini xabar davomiyligiga qarab dinamik hisoblaydi:
 * qisqa ovozli xabar ~50 ta ingichka bar, uzunrog'i (≈20s+) esa ~80
 * tagacha bar bilan chiziladi — natijada wave zich va aniq ko'rinadi. */
function _voiceBarCount(duration) {
  const d = Number(duration) || 0;
  if (d <= 0) return CVM_MIN_BARS;
  const count = Math.round(d * 4); // ≈4 bar/soniya
  return Math.max(CVM_MIN_BARS, Math.min(CVM_MAX_BARS, count));
}

/* Allaqachon decode qilingan waveform ma'lumotlari (sinxron o'qiladi).
 * Repaint bo'lganda barlar darhol to'g'ri balandlikda chiziladi — "tekis → qayta
 * to'lqin" miltillashi yo'q. Kalit: URL (query'siz) + bar soni. */
const _waveResolved = new Map();
const _wfKey = (url, count) => `${String(url || '').split('?')[0]}::${count}`;

/* O'z yuborgan ovozimizning local blob URL'i (id -> blob:). Server xabari kelganda
 * ham shu URL ishlatiladi — tarmoqdan qayta yuklanmaydi, waveform o'zgarmaydi. */
const _localVoiceUrls = new Map();
function registerLocalVoiceUrl(id, url, barCount) {
  if (!id || !url) return;
  _localVoiceUrls.set(String(id), url);
  // Lokal blob — darhol decode (tarmoq kutmasdan), keyin miltillash yo'q
  const cnt = barCount || CVM_BAR_COUNT;
  _getWaveformData(url, cnt).catch(() => {});
}
function getLocalVoiceUrl(id) { return id ? (_localVoiceUrls.get(String(id)) || '') : ''; }

function waveReadyClass(url = '', count = CVM_BAR_COUNT) {
  return (url && _waveResolved.has(_wfKey(url, count))) ? ' cvm-wave-ready' : '';
}

function renderVoiceWave(seed = 0, count = CVM_BAR_COUNT, url = '') {
  const data = url ? _waveResolved.get(_wfKey(url, count)) : null;
  let bars = '';
  for (let i = 0; i < count; i++) {
    const h = data ? CVM_MIN_H + (data[i] ?? 0) * (CVM_MAX_H - CVM_MIN_H) : CVM_MIN_H;
    bars += `<span class="cvm-bar" style="height:${h.toFixed(1)}px"></span>`;
  }
  return bars;
}

function _applyWave(waveEl, data) {
  if (!waveEl || !data) return;
  const bars = waveEl.querySelectorAll('.cvm-bar');
  // Birinchi chizishda transition O'CHIRILADI — tekis→baland "o'sish" ko'rinmasin
  waveEl.classList.add('cvm-wave-snap');
  bars.forEach((b, i) => {
    const v = data[i] ?? 0;
    const vv = v < 0.04 ? 0.04 : v;
    b.style.height = `${(CVM_MIN_H + vv * (CVM_MAX_H - CVM_MIN_H)).toFixed(1)}px`;
  });
  waveEl.dataset.hydrated = '1';
  waveEl.classList.add('cvm-wave-ready');
  // keyingi frame'da transition qayta yoqiladi (playback progress uchun)
  requestAnimationFrame(() => {
    waveEl.classList.remove('cvm-wave-snap');
  });
}

/* url → Promise<number[] | null> (har bir qiymat 0..1, normalizatsiya
 * qilingan RMS amplituda). Bir xil xabar ikki marta decode qilinmasin
 * deb keshlaymiz. */
const _waveformCache = new Map();

function _getWaveformData(url, count = CVM_BAR_COUNT) {
  if (!url) return Promise.resolve(null);
  const cacheKey = _wfKey(url, count);
  if (_waveformCache.has(cacheKey)) return _waveformCache.get(cacheKey);

  const promise = (async () => {
    try {
      // cache: 'no-store' — brauzer HTTP keshida (yoki avval boshqa joyda
      // <audio> orqali Range so'rov bilan olingan qisman/206 javobda)
      // qolib ketgan noto'liq baytlarni QAYTA ISHLATMASLIK uchun. Har
      // safar to'liq, yangi oqim so'raladi — shu orqali "Unable to
      // decode audio data" xatosining eng keng tarqalgan sababi
      // (keshdagi buzuq/qisman fayl) bartaraf etiladi.
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrBuf = await res.arrayBuffer();
      if (!arrBuf || arrBuf.byteLength === 0) throw new Error('Bo\'sh audio bufer');
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const audioBuf = await ctx.decodeAudioData(arrBuf.slice(0));
      const raw = audioBuf.getChannelData(0); // 1-kanal yetarli
      const blockSize = Math.max(1, Math.floor(raw.length / count));
      // Har blokda: peak (max |sample|) + RMS aralashmasi — Telegram uslubidagi
      // aniq baland/past kontrast. Faqat RMS bo'lsa hamma "o'rtacha" ko'rinadi.
      const peaks = new Array(count);
      for (let i = 0; i < count; i++) {
        const start = i * blockSize;
        const end = Math.min(raw.length, start + blockSize);
        let sumSq = 0, peak = 0, n = 0;
        // step: uzun bloklarda har n-sample (tezlik)
        const step = Math.max(1, Math.floor((end - start) / 64));
        for (let j = start; j < end; j += step) {
          const a = Math.abs(raw[j]);
          if (a > peak) peak = a;
          sumSq += a * a;
          n++;
        }
        const rms = n ? Math.sqrt(sumSq / n) : 0;
        // 65% peak + 35% RMS — gapirish piklar aniq, jimlik past
        peaks[i] = peak * 0.65 + rms * 0.35;
      }
      try { ctx.close(); } catch (_) {}

      // Soft floor: eng past 8% ni deyarli 0 ga yaqinlashtirish (shovqin kesish)
      const sorted = peaks.slice().sort((a, b) => a - b);
      const floor = sorted[Math.floor(sorted.length * 0.08)] || 0;
      const ceiling = sorted[Math.floor(sorted.length * 0.98)] || Math.max(...peaks, 0.0001);
      const range = Math.max(ceiling - floor, 0.0001);

      // Gamma 0.72 — o'rta qiymatlarni biroz ko'taradi, lekin past/baland farq saqlanadi
      const norm = peaks.map(v => {
        const t = Math.max(0, (v - floor) / range);
        return Math.min(1, Math.pow(t, 0.72));
      });
      _waveResolved.set(cacheKey, norm);
      return norm;
    } catch (e) {
      // e?.message || e — Error obyektining o'z xususiyatlari (message,
      // stack) enumerable emas, shuning uchun ba'zi konsollarda to'g'ridan
      // to'g'ri Error obyektini chop etsak "Error {}" (bo'sh) ko'rinadi va
      // haqiqiy sabab (masalan "Failed to fetch" — odatda CORS yoki
      // noto'g'ri/eskirgan Supabase Storage URL) yashirinib qoladi.
      console.warn('Waveform ajratib olishda xato:', e?.message || e?.name || e, '| url:', url);
      // MUHIM (flat-forever fix): agar shu (muvaffaqiyatsiz) natijani
      // keshda saqlab qo'ysak, chat ro'yxati Firestore yangilanishi bilan
      // qayta chizilganda (bu tez-tez sodir bo'ladi) HAR SAFAR shu keshdagi
      // "null"ni qaytarib, xabar ABADIY tekis (flat) ko'rinib qolardi —
      // hatto vaqtinchalik tarmoq xatosi tuzalgan bo'lsa ham. Xato holatini
      // keshdan o'chiramiz — shunda keyingi qayta chizilishda (re-render)
      // qaytadan haqiqiy urinish (retry) qilinadi.
      _waveformCache.delete(cacheKey);
      return null; // xato bo'lsa — tekis holat saqlanib qoladi
    }
  })();

  _waveformCache.set(cacheKey, promise);
  return promise;
}

/* Bir vaqtning o'zida ko'p ovozli xabar fon fonida dekod qilinsa,
 * server/tarmoqqa haddan tashqari ko'p parallel so'rov ketib, hatto
 * <audio> elementining o'zi ham yuklanishida muammo tug'dirishi mumkin
 * (masalan "no supported source" xatosi). Shu sabab — navbat orqali
 * bir vaqtda faqat 2 tasi dekod qilinadi, qolganlari navbatda kutadi. */
const CVM_MAX_CONCURRENT = 4;
let _cvmActiveDecodes = 0;
const _cvmQueue = [];

function _cvmRunQueue() {
  while (_cvmActiveDecodes < CVM_MAX_CONCURRENT && _cvmQueue.length) {
    const job = _cvmQueue.shift();
    _cvmActiveDecodes++;
    job().finally(() => {
      _cvmActiveDecodes--;
      _cvmRunQueue();
    });
  }
}

function _cvmEnqueue(job) {
  _cvmQueue.push(job);
  _cvmRunQueue();
}

/* Faqat foydalanuvchi haqiqatan ko'rayotgan (viewportga yaqin) ovozli
 * xabarlar uchun waveform yuklaymiz — chat ochilishi bilanoq o'nlab
 * xabarning to'liq audio faylini fon fonida yuklab yubormaymiz. */
let _cvmObserver = null;
function _cvmGetObserver() {
  if (_cvmObserver) return _cvmObserver;
  _cvmObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const waveEl = entry.target;
      _cvmObserver.unobserve(waveEl);
      _cvmStartHydrate(waveEl);
    });
  }, { root: null, rootMargin: '200px', threshold: 0.01 });
  return _cvmObserver;
}

function _cvmStartHydrate(waveEl) {
  const wrap = waveEl.closest('.chat-voice-msg');
  let url = wrap?.dataset.url;
  const path = wrap?.dataset.path || '';
  const count = parseInt(wrap?.dataset.barCount, 10) || CVM_BAR_COUNT;
  if ((!url && !path) || waveEl.dataset.hydrated === '1' || waveEl.dataset.hydrated === 'pending') return;
  if (url) {
    const known = _waveResolved.get(_wfKey(url, count));
    if (known) { _applyWave(waveEl, known); return; }
  }
  waveEl.dataset.hydrated = 'pending';
  _cvmEnqueue(async () => {
    let data = url ? await _getWaveformData(url, count) : null;
    if (!data && path) {
      try {
        const signed = await mediaSignedUrl(path, 7200);
        if (signed) {
          url = signed;
          if (wrap) wrap.dataset.url = signed;
          data = await _getWaveformData(signed, count);
        }
      } catch (_) {}
    }
    if (!waveEl.isConnected) return;
    if (!data) { waveEl.dataset.hydrated = ''; return; }
    _applyWave(waveEl, data);
  });
}

/* Berilgan konteyner ichidagi hali "hydrate" qilinmagan barcha voice
 * xabarlarni kuzatuvga (IntersectionObserver) qo'shadi — har biri
 * faqat ekranga yaqinlashganda navbat orqali dekod qilinadi. */
function _hydrateVoiceWaveforms(container) {
  if (!container) return;
  const observer = _cvmGetObserver();
  const wraps = container.querySelectorAll('.chat-voice-msg[data-url]');
  wraps.forEach(wrap => {
    const waveEl = wrap.querySelector('.cvm-waveform');
    if (!waveEl || waveEl.dataset.hydrated === '1' || waveEl.dataset.hydrated === 'pending') return;
    const cnt = parseInt(wrap.dataset.barCount, 10) || CVM_BAR_COUNT;
    const known = _waveResolved.get(_wfKey(wrap.dataset.url, cnt));
    if (known) { _applyWave(waveEl, known); return; } // sinxron — to'g'ri balandlik darhol
    observer.observe(waveEl);
  });
}

/* ── Xabar pufakchalari uchun "bounce" (pop-in) animatsiyasi qaysi
 * xabarlarga tegishli ekanini ANIQ, ID asosida kuzatamiz.
 *
 * ESKI USUL MUAMMOSI: oldin `idx >= prevCount` (ya'ni "avvalgi chizishda
 * nechta .chat-msg bor edi") solishtirilardi. Lekin "...yozmoqda"
 * pufakchasi HAM `.chat-msg` klassiga ega va u paintMessages()
 * dan TASHQARIDA, to'g'ridan-to'g'ri box.appendChild() bilan qo'shiladi/
 * o'chiriladi. Natijada `box.querySelectorAll('.chat-msg').length` real
 * Firestore xabarlar soniga har doim mos kelmasdi (goh ortiq, goh kam) —
 * xabar yuborilganda yoki xabar yangilanganda (bularning har biri messages'ga alohida
 * onSnapshot signalini qo'zg'atadi) `prevCount` noto'g'ri chiqib, ko'p
 * hollarda BARCHA xabarlar "yangi" deb hisoblanib, hammasi bir vaqtda
 * "bounce" bo'lib qolardi.
 *
 * YECHIM: har bir xabarning barqaror Firestore ID'si orqali — "shu ID
 * avval chizilganmi?" — tekshiramiz. Faqat HAQIQIY yangi (hali hech
 * qachon chizilmagan) xabar bounce bo'ladi; status/audioUrl kabi
 * maydonlar yangilanib qayta chizilganda eski xabarlar tegilmaydi. */
let _seenMsgIds = new Set();
let _seenMsgIdsChatId = null;
// Telegram uslubidagi "yangi xabar keldi" animatsiyasi:
// chat ilk ochilganda (baseline) animatsiya YO'Q — faqat chatda o'tirganda kelgan xabarga.
let _seenBaselineDone = false;
const _msgAnimStart = new Map();      // msgId -> animatsiya boshlangan vaqt (repaint bo'lsa ham davom etishi uchun)
const MSG_ANIM_MS = 360;
// O'chirilgan xabar "qum bo'lib sochilib ketishi" (MRdrive animatsiyasi) — jarayondagilar repaint'dan omon qoladi
const _dissolving = new Map();   // msgId -> { id, el, nextId }


function fmtVoiceDur(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}


/* ── Voice player ────────────────────────────────────────────────────
 * Progress requestAnimationFrame bilan chiziladi (timeupdate ~4Hz edi — qotib
 * ko'rinardi). MediaRecorder webm'larida audio.duration = Infinity bo'ladi, shuning
 * uchun davomiylik dataset'dagi (yozilgan) qiymatdan olinadi. Repaint bo'lsa, faol
 * tugma/waveform yangi DOM'ga qayta bog'lanadi. */
let _activeAudio    = null;
let _activeBtn      = null;
let _activeUrl      = '';
let _activeTotal    = 0;
let _activeChatId   = null;
let _activeChatUid  = null;
let _activeName     = '';
let _activeLoading  = false;
let _activeBars     = null;
let _activeBarsWrap = null;
let _lastFilled     = -1;
let _progRaf        = null;

function _setBtnState() {
  if (!_activeBtn) return;
  const ring = _activeBtn.querySelector('.cvm-eq');   // innerHTML halqani o'chirmasin (pauzada silliq so'nishi uchun)
  if (_activeLoading) {
    _activeBtn.innerHTML = LOADING_ICON;
    _activeBtn.classList.add('cvm-play--loading');
  } else {
    _activeBtn.classList.remove('cvm-play--loading');
    _activeBtn.innerHTML = (_activeAudio && !_activeAudio.paused) ? PAUSE_ICON : PLAY_ICON;
  }
  if (ring) _activeBtn.appendChild(ring);
}

function _curDur() {
  const d = _activeAudio ? _activeAudio.duration : 0;
  return (isFinite(d) && d > 0) ? d : (_activeTotal || 0);
}

function _paintProgress(force) {
  if (!_activeAudio || !_activeBtn) return;
  const wrap = _activeBtn.closest('.chat-voice-msg');
  if (!wrap) return;
  /* Yuklangan audio fayl (mp3...) — to'lqin EMAS, Telegramdagidek oddiy progress chiziq */
  if (wrap.classList.contains('cvm-file')) {
    const trk = wrap.querySelector('.cvm-track');
    const d = _curDur() || 0;
    const c = _activeAudio.currentTime || 0;
    const p = d > 0 ? Math.max(0, Math.min(1, c / d)) : 0;
    if (trk) trk.style.setProperty('--cvm-p', (p * 100).toFixed(2) + '%');
    const subEl = wrap.querySelector('.cvm-dur');
    if (subEl) { const t = fmtVoiceDur(c) + (d ? ' / ' + fmtVoiceDur(d) : ''); if (subEl.dataset.cur !== t) { subEl.textContent = t; subEl.dataset.cur = t; } }
    _updateMiniPlayerProgress(p);
    return;
  }
  if (_activeBarsWrap !== wrap) {
    _activeBarsWrap = wrap;
    _activeBars = wrap.querySelectorAll('.cvm-bar');
    _lastFilled = -1;
    force = true;
  }
  const dur = _curDur() || 1;
  const cur = _activeAudio.currentTime || 0;
  const pct = Math.max(0, Math.min(1, cur / dur));
  const n = _activeBars.length || 1;
  // Uzluksiz playhead: butun + fractional bar (Telegram-smooth)
  const exact = pct * n;
  const filled = Math.min(n, Math.floor(exact));
  const frac = exact - filled; // 0..1 joriy barda

  // Har frame: class + fractional opacity — sakrash yo'q
  for (let i = 0; i < n; i++) {
    const b = _activeBars[i];
    if (i < filled) {
      b.classList.add('played');
      b.classList.remove('cvm-bar-partial');
      b.style.removeProperty('--cvm-partial');
      b.style.opacity = '';
    } else if (i === filled && frac > 0.001) {
      b.classList.add('played', 'cvm-bar-partial');
      b.style.setProperty('--cvm-partial', frac.toFixed(3));
      // partial: played rangga qarab aralashadi (CSS)
    } else {
      b.classList.remove('played', 'cvm-bar-partial');
      b.style.removeProperty('--cvm-partial');
      b.style.opacity = '';
    }
  }
  _lastFilled = filled;

  const durEl = wrap.querySelector('.cvm-dur');
  if (durEl) { const t = fmtVoiceDur(cur); if (durEl.dataset.cur !== t) { durEl.textContent = t; durEl.dataset.cur = t; } }
  _updateMiniPlayerProgress(pct);
}

function _startProgressLoop() {
  if (_progRaf) return;
  const frame = () => {
    _progRaf = null;
    if (!_activeAudio) return;
    _paintProgress(false);
    if (!_activeAudio.paused && !_activeAudio.ended) _progRaf = requestAnimationFrame(frame);
  };
  _progRaf = requestAnimationFrame(frame);
}

function _resetActiveVisual() {
  if (_activeBtn) {
    _activeBtn.classList.remove('cvm-play--loading');
    _activeBtn.innerHTML = PLAY_ICON;
    const wrap = _activeBtn.closest('.chat-voice-msg');
    if (wrap) {
      wrap.querySelectorAll('.cvm-bar').forEach(b => {
        b.classList.remove('played', 'cvm-bar-partial');
        b.style.removeProperty('--cvm-partial');
        b.style.opacity = '';
      });
      wrap.querySelector('.cvm-waveform')?.classList.remove('playing');
      wrap.querySelector('.cvm-track')?.style.setProperty('--cvm-p', '0%');
      const durEl = wrap.querySelector('.cvm-dur');
      if (durEl) {
        if (wrap.classList.contains('cvm-file')) { durEl.textContent = durEl.dataset.sub || ''; delete durEl.dataset.cur; }
        else durEl.textContent = fmtVoiceDur(_activeTotal || 0);
      }
    }
  }
  _activeBars = null; _activeBarsWrap = null; _lastFilled = -1;
}

function _stopActive() {
  _stopPlayEq();
  if (_activeAudio) {
    const a = _activeAudio;
    a.onwaiting = a.onstalled = a.onplaying = a.onpause = a.onended = a.onerror = null;
    try { a.pause(); } catch (_) {}
  }
  _resetActiveVisual();
  _activeAudio = null; _activeBtn = null; _activeUrl = ''; _activeLoading = false;
}

function _reattachActiveVoiceUI(box) {
  if (!_activeAudio || !_activeBtn) return;
  if (box.contains(_activeBtn)) return;
  const key = String(_activeUrl || '').split('?')[0];
  if (!key) return;
  const newWrap = Array.from(box.querySelectorAll('.chat-voice-msg'))
    .find(w => String(w.dataset.url || '').split('?')[0] === key);
  if (!newWrap) return;
  const newBtn = newWrap.querySelector('.cvm-play');
  if (!newBtn) return;
  _activeBtn = newBtn;
  _activeBarsWrap = null;
  _setBtnState();
  newWrap.querySelector('.cvm-waveform')?.classList.toggle('playing', !_activeAudio.paused);
  _paintProgress(true);
  if (!_activeAudio.paused) _startProgressLoop();
}


/* ── Play button: silliq doira-waveform (SVG) ─────────────────────────
 * Ijro paytida tugma atrofida yopiq silliq egri chiziq — radiusi haqiqiy audio
 * spektr bilan o'zgaradi (chap/o'ng simmetrik). Catmull-Rom → Bezier, shuning
 * uchun "chiziqchalar" emas, yumshoq to'lqinli doira. */
const _EQ_PTS = 48;
const _RING_C = 27, _RING_R0 = 20, _RING_A = 5;
const _SVGNS = 'http://www.w3.org/2000/svg';
let _eqCtx = null;
let _eqAnalyser = null;
let _eqData = null;
let _eqRaf = null;
let _eqBtn = null;
let _eqSmooth = 0;
let _ringLv = new Float32Array(_EQ_PTS);
let _ringTmp = new Float32Array(_EQ_PTS);

function _ensureEqRing(btn) {
  if (!btn) return null;
  let ring = btn.querySelector('.cvm-eq');
  if (ring) return ring;
  ring = document.createElement('span');
  ring.className = 'cvm-eq';
  ring.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(_SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 54 54');
  svg.setAttribute('class', 'cvm-ring');
  const path = document.createElementNS(_SVGNS, 'path');
  path.setAttribute('class', 'cvm-ring-path');
  svg.appendChild(path);
  ring.appendChild(svg);
  btn.appendChild(ring);
  return ring;
}

function _ringD(lv) {
  const n = lv.length, P = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = _RING_R0 + lv[i] * _RING_A;
    P.push([_RING_C + Math.cos(th) * r, _RING_C + Math.sin(th) * r]);
  }
  const f = v => v.toFixed(2);
  let d = 'M' + f(P[0][0]) + ' ' + f(P[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    d += 'C' + f(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + f(p1[1] + (p2[1] - p0[1]) / 6) + ' '
             + f(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + f(p2[1] - (p3[1] - p1[1]) / 6) + ' '
             + f(p2[0]) + ' ' + f(p2[1]);
  }
  return d + 'Z';
}

function _paintRing(path, opacity) {
  // qo'shni nuqtalar bilan 3-nuqtali yumshatish → yanada silliq doira
  const n = _EQ_PTS;
  for (let i = 0; i < n; i++) {
    _ringTmp[i] = (_ringLv[(i - 1 + n) % n] + 2 * _ringLv[i] + _ringLv[(i + 1) % n]) / 4;
  }
  path.setAttribute('d', _ringD(_ringTmp));
  path.style.opacity = opacity.toFixed(3);
}

function _stopPlayEq() {
  if (_eqRaf) { cancelAnimationFrame(_eqRaf); _eqRaf = null; }
  if (_eqBtn) {
    _eqBtn.classList.remove('cvm-play--eq');
    const path = _eqBtn.querySelector('.cvm-ring-path');
    if (path) { path.removeAttribute('d'); path.style.opacity = '0'; }
  }
  _ringLv.fill(0);
  _eqBtn = null;
  _eqSmooth = 0;
}

function _startPlayEq(audio, btn) {
  if (!audio || !btn || audio.__noEq) return;
  _stopPlayEq();
  const ring = _ensureEqRing(btn);
  const path = ring?.querySelector('.cvm-ring-path');
  if (!path) return;
  btn.classList.add('cvm-play--eq');
  _eqBtn = btn;

  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!_eqCtx) _eqCtx = new AC();
    if (_eqCtx.state === 'suspended') _eqCtx.resume().catch(() => {});
    // Context ishlamayotgan bo'lsa — audio'ni graph'ga ULAMAYMIZ (ovoz o'chib qolmasin)
    if (_eqCtx.state !== 'running' && !audio.__cvmEqNode) {
      btn.classList.remove('cvm-play--eq'); _eqBtn = null; audio.__noEq = true;
      return;
    }

    // Har audio element uchun MediaElementSource bir marta
    if (!audio.__cvmEqNode) {
      const analyser = _eqCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.65;
      let src = null;
      // MUHIM: ovozni WebAudio orqali YO'NALTIRMAYMIZ. Ba'zi qurilmalarda (interaktiv doska,
      // ba'zi TV/Linux brauzerlar) WebAudio chiqishi jim bo'lib, <audio> esa ishlaydi —
      // createMediaElementSource bilan ovoz butunlay yo'qolardi. captureStream() esa elementning
      // o'z (native) chiqishiga tegmaydi: ovoz YouTube kabi ishonchli, EQ faqat "tinglaydi".
      const cap = audio.captureStream || audio.mozCaptureStream;
      if (typeof cap === 'function') {
        const stream = cap.call(audio);
        if (!stream || !stream.getAudioTracks().length) {
          btn.classList.remove('cvm-play--eq'); _eqBtn = null; audio.__noEq = true;
          return;
        }
        src = _eqCtx.createMediaStreamSource(stream);
        src.connect(analyser);
        const mute = _eqCtx.createGain(); mute.gain.value = 0;   // analyser ishlashi uchun graph'ga ulanadi, lekin eshitilmaydi
        analyser.connect(mute); mute.connect(_eqCtx.destination);
      } else {
        // captureStream yo'q (Safari) — eski yo'l
        src = _eqCtx.createMediaElementSource(audio);
        src.connect(analyser);
        analyser.connect(_eqCtx.destination);
      }
      audio.__cvmEqNode = { src, analyser };
    }
    _eqAnalyser = audio.__cvmEqNode.analyser;
    _eqData = new Uint8Array(_eqAnalyser.frequencyBinCount);

    const tick = () => {
      _eqRaf = null;
      if (!_eqAnalyser || !_eqBtn || !_activeAudio || _activeAudio.paused) {
        if (_eqBtn && (!_activeAudio || _activeAudio.paused)) {
          // pauza: silliq so'nish
          _eqSmooth *= 0.85;
          for (let i = 0; i < _EQ_PTS; i++) _ringLv[i] *= 0.85;
          _paintRing(path, 0.5 * Math.min(1, _eqSmooth * 6));
          if (_eqSmooth > 0.02) _eqRaf = requestAnimationFrame(tick);
          else _stopPlayEq();
        }
        return;
      }
      _eqAnalyser.getByteFrequencyData(_eqData);
      const use = Math.min(48, _eqData.length);
      let sum = 0;
      for (let i = 1; i < use; i++) sum += _eqData[i];
      const avg = sum / (use - 1) / 255;
      const target = Math.min(1, Math.max(0, (avg - 0.04) * 2.8));
      _eqSmooth += (target - _eqSmooth) * (target > _eqSmooth ? 0.45 : 0.18);

      for (let i = 0; i < _EQ_PTS; i++) {
        // f: 0 → 1 → 0 (tepada past chastota, pastda yuqori) — chap/o'ng simmetrik
        const f = 1 - Math.abs(1 - (2 * i) / _EQ_PTS);
        const bin = 1 + f * (use - 2);
        const b0 = Math.floor(bin), b1 = Math.min(use - 1, b0 + 1), t = bin - b0;
        const v = (_eqData[b0] * (1 - t) + _eqData[b1] * t) / 255;
        const tgt = Math.min(1, Math.max(0, v * (1 + 1.3 * f) * 0.9 + _eqSmooth * 0.4));
        _ringLv[i] += (tgt - _ringLv[i]) * (tgt > _ringLv[i] ? 0.5 : 0.2);
      }
      _paintRing(path, 0.55 + _eqSmooth * 0.45);
      _eqRaf = requestAnimationFrame(tick);
    };
    _eqRaf = requestAnimationFrame(tick);
  } catch (e) {
    console.warn('Play EQ ishlamadi:', e?.message || e);
  }
}

/* ── Avtomatik keyingisiga o'tish: voice tugagach pastdagi keyingi voice ───── */
function _nextVoiceBtn(btn, url) {
  const box = $('chatThreadMessages');
  if (!box) return null;
  const all = Array.from(box.querySelectorAll('.chat-voice-msg'));
  let i = -1;
  const wrap = btn?.closest?.('.chat-voice-msg');
  if (wrap && box.contains(wrap)) i = all.indexOf(wrap);
  if (i < 0 && url) {                       // DOM qayta chizilgan bo'lsa — URL bo'yicha topamiz
    const key = String(url).split('?')[0];
    i = all.findIndex(w => String(w.dataset.url || '').split('?')[0] === key);
  }
  if (i < 0) return null;
  for (let j = i + 1; j < all.length; j++) {
    const b = all[j].querySelector('.cvm-play');
    if (b && all[j].dataset.url) return b;
  }
  return null;
}

window._chatPlayVoice = async function(btn) {
  const wrap = btn.closest('.chat-voice-msg');
  let url = wrap?.dataset?.url || '';
  const path = wrap?.dataset?.path || '';
  if (!url && path) {
    try {
      const { mediaPublicUrl } = await import('../core/config.js');
      url = mediaPublicUrl(path) || '';
      if (url) wrap.dataset.url = url;
    } catch (_) {}
  }
  if (!url) {
    console.warn('Voice: URL topilmadi', wrap?.dataset);
    toast('Audio URL topilmadi', 'error');
    return;
  }

  // Bir xil xabar — pause/resume
  if (_activeAudio && _activeBtn === btn) {
    if (_activeAudio.paused) {
      _activeAudio.play().catch(e => { if (e?.name === 'AbortError') return; console.error('Resume xatosi:', e); toast('Ijro etilmadi', 'error'); });
      _startProgressLoop();
      _startPlayEq(_activeAudio, _activeBtn);
    } else {
      _activeAudio.pause();
    }
    _setBtnState();
    _syncMiniPlayer();
    return;
  }

  if (_activeAudio) _stopActive();

  _activeBtn     = btn;
  _activeUrl     = url;
  _activeTotal   = parseFloat(wrap.dataset.dur || '0') || 0;
  _activeChatId  = wrap.dataset.chatId || state.currentChatId || null;
  _activeChatUid = wrap.dataset.chatUid || state.currentChatUid || null;
  _activeName    = wrap.dataset.name || 'Ovozli xabar';

  // AudioContext'ni foydalanuvchi bosishi (gesture) ichida yaratib/uyg'otamiz —
  // aks holda iOS/Safari'da suspended qolib, EQ ulangan audio jim bo'lib qoladi.
  try {
    const AC0 = window.AudioContext || window.webkitAudioContext;
    if (AC0) { if (!_eqCtx) _eqCtx = new AC0(); if (_eqCtx.state === 'suspended') _eqCtx.resume().catch(() => {}); }
  } catch (_) {}

  const audio = new Audio();
  audio.preload = 'auto';
  audio.playsInline = true;
  // Avval CORS siz — mobilida ishonchliroq; EQ keyin yoqiladi agar CORS ishlasa
  audio.__noEq = false;
  _activeAudio = audio;
  _activeLoading = true;
  _setBtnState();
  wrap.querySelector('.cvm-waveform')?.classList.add('playing');

  const tryPlay = (src, withCors) => {
    // CORS'siz cross-origin audio'ni WebAudio'ga ulasak ovoz O'CHIB qoladi (jim) —
    // shuning uchun EQ faqat CORS bilan yuklanganda yoqiladi.
    audio.__noEq = !withCors;
    if (withCors) audio.crossOrigin = 'anonymous';
    else { try { audio.removeAttribute('crossorigin'); } catch (_) {} audio.crossOrigin = null; }
    audio.src = src;
    return audio.play();
  };

  let _voiceResumeT = 0, _voiceNudge = 0;
  const _softResumeVoice = () => {
    if (_activeAudio !== audio || audio.ended) return;
    clearTimeout(_voiceResumeT);
    _voiceResumeT = setTimeout(() => {
      if (_activeAudio !== audio || audio.paused || audio.ended) return;
      try {
        audio.play().catch(() => {});
        // Buffer qotib qolsa — kichik nudge (max 2)
        if (audio.readyState < 2 && _voiceNudge < 2) {
          _voiceNudge++;
          const ct = audio.currentTime || 0;
          if (ct > 0.15) {
            try { audio.currentTime = Math.max(0, ct - 0.03); } catch (_) {}
            audio.play().catch(() => {});
          }
        }
      } catch (_) {}
    }, 180);
  };
  audio.onwaiting = () => {
    if (_activeAudio !== audio) return;
    _activeLoading = true; _setBtnState();
    _softResumeVoice();
  };
  audio.onstalled = () => { if (_activeAudio === audio) _softResumeVoice(); };
  audio.onplaying = () => {
    if (_activeAudio !== audio) return;
    _voiceNudge = 0;
    _activeLoading = false; _setBtnState(); _syncMiniPlayer(); _startProgressLoop();
    if (!audio.__noEq) _startPlayEq(audio, _activeBtn);
  };
  audio.onpause = () => {
    if (_activeAudio !== audio || audio.ended) return;
    _setBtnState(); _syncMiniPlayer(); _paintProgress(false);
  };
  audio.onended = () => {
    if (_activeAudio !== audio) return;
    const prevBtn = _activeBtn, prevUrl = _activeUrl;
    _stopActive();
    _syncMiniPlayer();
    const next = _nextVoiceBtn(prevBtn, prevUrl);
    if (next) {
      const _vn = next.closest('.chat-voice-msg'); if (_vn) smoothScrollIntoView(_vn, { block: 'nearest' });
      window._chatPlayVoice(next);
    }
  };

  let step = 0; // 0: no-cors, 1: cors, 2: signed no-cors, 3: signed cors
  const failOrRetry = async (why) => {
    if (_activeAudio !== audio) return;
    step++;
    try {
      if (step === 1) {
        await tryPlay(url, true);
        return;
      }
      if (step === 2 && path) {
        const signed = await mediaSignedUrl(path, 7200);
        if (signed) {
          url = signed;
          _activeUrl = signed;
          wrap.dataset.url = signed;
          audio.__noEq = true;
          await tryPlay(signed, false);
          return;
        }
      }
      if (step === 3 && path) {
        const signed = await mediaSignedUrl(path, 7200);
        if (signed) {
          url = signed;
          _activeUrl = signed;
          await tryPlay(signed, true);
          return;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      return failOrRetry(err);
    }
    console.error('Audio xatosi:', why, 'URL:', url, 'path:', path);
    toast('Audio yuklanmadi', 'error');
    _stopActive();
    _syncMiniPlayer();
  };

  audio.onerror = () => failOrRetry('onerror');

  try {
    await tryPlay(url, false);
  } catch (e) {
    if (e?.name === 'AbortError') return;
    await failOrRetry(e);
  }

  _syncMiniPlayer();
};

/* ── Voice mini-player — chatdan chiqib ketilsa ham ijro davom etadi ── */
function _isVoiceOwnerChatOpen() {
  const threadOpen = $('chatThreadModal')?.classList.contains('show');
  return !!(threadOpen && state.currentChatId && state.currentChatId === _activeChatId);
}

export function _syncMiniPlayer() {
  const bar = $('voiceMiniPlayer');
  if (!bar) return;
  const shouldShow = !!_activeAudio && !_isVoiceOwnerChatOpen();
  if (!shouldShow) { bar.classList.remove('show'); return; }

  bar.classList.add('show');
  const titleEl = $('vmpTitle');
  if (titleEl) titleEl.textContent = _activeName || 'Ovozli xabar';
  const playBtn = $('vmpPlay');
  if (playBtn) playBtn.innerHTML = (_activeAudio && !_activeAudio.paused) ? PAUSE_ICON : PLAY_ICON;
}

function _updateMiniPlayerProgress(pct) {
  const fill = $('vmpFill');
  if (fill) fill.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
}

$('vmpPlay')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!_activeAudio) return;
  if (_activeAudio.paused) { _activeAudio.play().catch(() => {}); _startProgressLoop(); }
  else _activeAudio.pause();
  _setBtnState();
  _syncMiniPlayer();
});

$('vmpClose')?.addEventListener('click', (e) => {
  e.stopPropagation();
  _stopActive();
  _activeChatId  = null;
  _activeChatUid = null;
  _syncMiniPlayer();
});

// Bar bosilganda — ovoz chiqayotgan chatga qaytamiz
$('voiceMiniPlayer')?.addEventListener('click', () => {
  if (_activeChatUid && typeof _openChatCb === 'function') _openChatCb(_activeChatUid);
});

const PLAY_ICON  = `<img src="./svg/media/play.svg" alt="" class="icon" width="14" height="14">`;
const PAUSE_ICON = `<img src="./svg/extra/icon-4ed8972aa2b8.svg" alt="" class="icon" width="14" height="14">`;
// Fayl hali yuklanayotganda (buferlanmoqda) ko'rsatiladigan aylanuvchi spinner —
// CSS animatsiyasi uchun .cvm-play--loading klassi (CSS/chat.css) bilan birga ishlaydi.
const LOADING_ICON = `<span class="cvm-spin" aria-hidden="true"></span>`;


/* ── Server to'lqini (messages.waveform smallint[] 0..31) ──
 * Server qiymati bo'lsa — decode/fetch KERAK EMAS: barlar darhol to'g'ri balandlikda chiziladi. */
const WF_MAX = 31;
function _wfResample(arr, count) {
  const n = arr.length;
  if (n === count) return arr;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.floor(i * n / count), b = Math.max(a + 1, Math.floor((i + 1) * n / count));
    let m = 0;
    for (let j = a; j < b && j < n; j++) if (arr[j] > m) m = arr[j];
    out[i] = m;
  }
  return out;
}
function primeWaveform(url, count, arr) {
  if (!url || !Array.isArray(arr) || arr.length < 8) return false;
  const key = _wfKey(url, count);
  if (_waveResolved.has(key)) return true;
  const norm = arr.map(v => Math.max(0, Math.min(1, (Number(v) || 0) / WF_MAX)));
  _waveResolved.set(key, _wfResample(norm, count));
  return true;
}
/** Yozib olingan ovozdan serverga yuboriladigan to'lqin (0..31 butun sonlar) yoki null */
async function getVoiceWaveform(url, count) {
  try {
    const norm = await Promise.race([_getWaveformData(url, count), new Promise(r => setTimeout(() => r(null), 3500))]);
    if (!norm || !norm.length) return null;
    return norm.map(v => Math.max(0, Math.min(WF_MAX, Math.round(v * WF_MAX))));
  } catch (_) { return null; }
}

/* ── Audio fayl (mp3...) progress chizig'i: bosib/surib o'tkazish (seek) ── */
let _seekBound = false;
function _bindTrackSeek() {
  if (_seekBound) return;
  _seekBound = true;
  document.addEventListener('pointerdown', (e) => {
    const trk = e.target?.closest?.('.cvm-track');
    if (!trk) return;
    const btn = trk.closest('.chat-voice-msg')?.querySelector('.cvm-play');
    if (!btn) return;
    if (!_activeAudio || _activeBtn !== btn) { window._chatPlayVoice(btn); return; }
    const d = _curDur();
    if (!(d > 0)) return;
    const apply = (ev) => {
      const r = trk.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
      try { _activeAudio.currentTime = p * d; } catch (_) {}
      _paintProgress(true);
    };
    apply(e);
    try { trk.setPointerCapture(e.pointerId); } catch (_) {}
    const up = () => { trk.removeEventListener('pointermove', apply); trk.removeEventListener('pointerup', up); trk.removeEventListener('pointercancel', up); };
    trk.addEventListener('pointermove', apply);
    trk.addEventListener('pointerup', up);
    trk.addEventListener('pointercancel', up);
  });
}

export function initVoicePlayer(opts = {}) {
  _openChatCb = opts.openChat || null;
  _bindTrackSeek();
}

export {
  fmtVoiceDur,
  renderVoiceWave,
  waveReadyClass,
  _voiceBarCount as voiceBarCount,
  _hydrateVoiceWaveforms as hydrateVoiceWaveforms,
  _reattachActiveVoiceUI as reattachActiveVoiceUI,
  registerLocalVoiceUrl,
  getLocalVoiceUrl,
  primeWaveform,
  getVoiceWaveform,
};
