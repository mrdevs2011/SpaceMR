/**
 * chat-voice-player.js — waveform hydrate, playback, mini-player
 * Ehtiyotkor ajratish: paintMessages/closeChatThread chat.js da qoladi.
 */
import { state } from '../core/config.js';
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
  const url = wrap?.dataset.url;
  const count = parseInt(wrap?.dataset.barCount, 10) || CVM_BAR_COUNT;
  if (!url || waveEl.dataset.hydrated === '1' || waveEl.dataset.hydrated === 'pending') return;
  const known = _waveResolved.get(_wfKey(url, count));
  if (known) { _applyWave(waveEl, known); return; }
  waveEl.dataset.hydrated = 'pending';
  _cvmEnqueue(() => _getWaveformData(url, count).then(data => {
    if (!waveEl.isConnected) return;
    if (!data) { waveEl.dataset.hydrated = ''; return; }
    _applyWave(waveEl, data);
  }));
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
  if (_activeLoading) {
    _activeBtn.innerHTML = LOADING_ICON;
    _activeBtn.classList.add('cvm-play--loading');
  } else {
    _activeBtn.classList.remove('cvm-play--loading');
    _activeBtn.innerHTML = (_activeAudio && !_activeAudio.paused) ? PAUSE_ICON : PLAY_ICON;
  }
}

function _curDur() {
  const d = _activeAudio ? _activeAudio.duration : 0;
  return (isFinite(d) && d > 0) ? d : (_activeTotal || 0);
}

function _paintProgress(force) {
  if (!_activeAudio || !_activeBtn) return;
  const wrap = _activeBtn.closest('.chat-voice-msg');
  if (!wrap) return;
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
      const durEl = wrap.querySelector('.cvm-dur');
      if (durEl) durEl.textContent = fmtVoiceDur(_activeTotal || 0);
    }
  }
  _activeBars = null; _activeBarsWrap = null; _lastFilled = -1;
}

function _stopActive() {
  _stopPlayEq();
  if (_activeAudio) {
    const a = _activeAudio;
    a.onwaiting = a.onplaying = a.onpause = a.onended = a.onerror = null;
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


/* ── Play button circular EQ (classic realistic ring) ─────────────────
 * Ijro paytida tugma atrofida 16 ta radial bar — haqiqiy audio amplituda. */
const _EQ_BARS = 16;
let _eqCtx = null;
let _eqAnalyser = null;
let _eqData = null;
let _eqRaf = null;
let _eqBtn = null;
let _eqSmooth = 0;

function _ensureEqRing(btn) {
  if (!btn) return null;
  let ring = btn.querySelector('.cvm-eq');
  if (ring) return ring;
  ring = document.createElement('span');
  ring.className = 'cvm-eq';
  ring.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < _EQ_BARS; i++) {
    const b = document.createElement('span');
    b.className = 'cvm-eq-bar';
    b.style.setProperty('--i', String(i));
    b.style.setProperty('--n', String(_EQ_BARS));
    ring.appendChild(b);
  }
  btn.appendChild(ring);
  return ring;
}

function _stopPlayEq() {
  if (_eqRaf) { cancelAnimationFrame(_eqRaf); _eqRaf = null; }
  if (_eqBtn) {
    _eqBtn.classList.remove('cvm-play--eq');
    const ring = _eqBtn.querySelector('.cvm-eq');
    if (ring) {
      ring.querySelectorAll('.cvm-eq-bar').forEach(b => {
        b.style.setProperty('--h', '0');
        b.style.opacity = '0';
      });
    }
  }
  _eqBtn = null;
  _eqSmooth = 0;
}

function _startPlayEq(audio, btn) {
  if (!audio || !btn) return;
  _stopPlayEq();
  const ring = _ensureEqRing(btn);
  if (!ring) return;
  btn.classList.add('cvm-play--eq');
  _eqBtn = btn;

  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!_eqCtx) _eqCtx = new AC();
    if (_eqCtx.state === 'suspended') _eqCtx.resume().catch(() => {});

    // Har audio element uchun MediaElementSource bir marta
    if (!audio.__cvmEqNode) {
      const src = _eqCtx.createMediaElementSource(audio);
      const analyser = _eqCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.65;
      src.connect(analyser);
      analyser.connect(_eqCtx.destination); // ovoz chiqishi uchun majburiy
      audio.__cvmEqNode = { src, analyser };
    }
    _eqAnalyser = audio.__cvmEqNode.analyser;
    _eqData = new Uint8Array(_eqAnalyser.frequencyBinCount);

    const bars = ring.querySelectorAll('.cvm-eq-bar');
    const tick = () => {
      _eqRaf = null;
      if (!_eqAnalyser || !_eqBtn || !_activeAudio || _activeAudio.paused) {
        if (_eqBtn && (!_activeAudio || _activeAudio.paused)) {
          // pause: silliq so'nish
          _eqSmooth *= 0.85;
          bars.forEach((b, i) => {
            const h = _eqSmooth * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.7)));
            b.style.setProperty('--h', h.toFixed(3));
            b.style.opacity = String(Math.min(1, h * 1.2));
          });
          if (_eqSmooth > 0.02) _eqRaf = requestAnimationFrame(tick);
          else _stopPlayEq();
        }
        return;
      }
      _eqAnalyser.getByteFrequencyData(_eqData);
      const n = _eqData.length;
      // Umumiy energiya (bass+mid)
      let sum = 0;
      const use = Math.min(48, n);
      for (let i = 1; i < use; i++) sum += _eqData[i];
      const avg = sum / (use - 1) / 255;
      const target = Math.min(1, Math.max(0, (avg - 0.04) * 2.8));
      _eqSmooth += (target - _eqSmooth) * (target > _eqSmooth ? 0.45 : 0.18);

      // Har bar o'z frekvensiya bo'lagidan + biroz global
      const per = Math.max(1, Math.floor(use / _EQ_BARS));
      for (let i = 0; i < bars.length; i++) {
        let s = 0;
        const a0 = 1 + i * per;
        for (let j = 0; j < per && a0 + j < use; j++) s += _eqData[a0 + j];
        const local = s / per / 255;
        const h = Math.min(1, Math.max(0.06, local * 1.6 * 0.55 + _eqSmooth * 0.45));
        bars[i].style.setProperty('--h', h.toFixed(3));
        bars[i].style.opacity = String(0.35 + h * 0.65);
      }
      _eqRaf = requestAnimationFrame(tick);
    };
    _eqRaf = requestAnimationFrame(tick);
  } catch (e) {
    console.warn('Play EQ ishlamadi:', e?.message || e);
  }
}

window._chatPlayVoice = function(btn) {
  const wrap = btn.closest('.chat-voice-msg');
  const url  = wrap?.dataset?.url;
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

  // Boshqa xabar o'ynayotgan bo'lsa — to'liq to'xtatib, vizualini tozalaymiz
  if (_activeAudio) _stopActive();

  _activeBtn     = btn;
  _activeUrl     = url;
  _activeTotal   = parseFloat(wrap.dataset.dur || '0') || 0;
  _activeChatId  = wrap.dataset.chatId || state.currentChatId || null;
  _activeChatUid = wrap.dataset.chatUid || state.currentChatUid || null;
  _activeName    = wrap.dataset.name || 'Ovozli xabar';

  const audio = new Audio();
  audio.preload = 'auto';
  _activeAudio = audio;
  _activeLoading = true;          // yuklanish tugaguncha tugma ichida spinner aylanadi
  _setBtnState();
  wrap.querySelector('.cvm-waveform')?.classList.add('playing');

  audio.onwaiting = () => { if (_activeAudio !== audio) return; _activeLoading = true; _setBtnState(); };
  audio.onplaying = () => {
    if (_activeAudio !== audio) return;
    _activeLoading = false; _setBtnState(); _syncMiniPlayer(); _startProgressLoop();
    _startPlayEq(audio, _activeBtn);
  };
  audio.onpause = () => {
    if (_activeAudio !== audio || audio.ended) return;
    _setBtnState(); _syncMiniPlayer(); _paintProgress(false);
  };
  audio.onended = () => {
    if (_activeAudio !== audio) return;
    _stopActive();
    _syncMiniPlayer();
  };
  audio.onerror = (e) => {
    if (_activeAudio !== audio) return;
    console.error('Audio xatosi:', e, 'URL:', url);
    toast('Audio yuklanmadi', 'error');
    _stopActive();
    _syncMiniPlayer();
  };

  audio.src = url;
  audio.play().catch(e => {
    if (e?.name === 'AbortError') return;   // tez almashtirish — kutilgan holat
    if (_activeAudio !== audio) return;
    console.error('Audio play xatosi:', e, 'URL:', url);
    toast('Audio ijro etilmadi', 'error');
    _stopActive();
    _syncMiniPlayer();
  });

  _syncMiniPlayer();
};

/* ── Voice mini-player — chatdan chiqib ketilsa ham ijro davom etadi ── */
function _isVoiceOwnerChatOpen() {
  const threadOpen = $('chatThreadModal')?.classList.contains('show');
  return !!(threadOpen && state.currentChatId && state.currentChatId === _activeChatId);
}

function _syncMiniPlayer() {
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


export function initVoicePlayer(opts = {}) {
  _openChatCb = opts.openChat || null;
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
};
