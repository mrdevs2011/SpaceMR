import './chat-image-zoom.js';
import { esc } from '../../core/utils.js';
import { getChatFileIcon, callLogInfo, fmtCallDur } from '../chat-shared.js';
import { PLAY_SVG, fmtDur, isVideoNote, renderVideoNote } from './video-note.js';

/* Rasm nisbatini eslab qolish: qayta chizilganda (innerHTML) rasm yuklanmasdan oldin ham
   joyi band bo'lsin — chat sakramasin. Birinchi marta ko'rilganda nisbat noma'lum. */
const _DIMS_KEY = 'chatImgRatios';
const _ratios = new Map();
try { for (const [k, v] of JSON.parse(sessionStorage.getItem(_DIMS_KEY) || '[]')) _ratios.set(k, v); } catch (_) {}
export function imgRatioAttr(url) {
  const r = _ratios.get(url);
  return r ? ` style="aspect-ratio:${r}"` : '';
}
export function rememberImgRatio(img) {
  const url = img.getAttribute('src');
  if (!url || !img.naturalWidth || !img.naturalHeight) return;
  const r = `${img.naturalWidth}/${img.naturalHeight}`;
  if (_ratios.get(url) === r) return;
  _ratios.set(url, r);
  try {
    const arr = [..._ratios.entries()].slice(-300);
    sessionStorage.setItem(_DIMS_KEY, JSON.stringify(arr));
  } catch (_) {}
}
/* ── Video preview: birinchi kadr + play tugmasi + davomiylik; bosilsa shu yerning o'zida ijro bo'ladi ── */
const VID_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const AUD_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'];
window._chatVidMeta = function (v) {
  try {
    rememberImgRatio({ getAttribute: () => v.getAttribute('src').split('#')[0], naturalWidth: v.videoWidth, naturalHeight: v.videoHeight });
    if (v.videoWidth && v.videoHeight) v.style.aspectRatio = `${v.videoWidth}/${v.videoHeight}`;
    const d = v.closest('.cfm-vid-wrap')?.querySelector('.cfm-vid-dur');
    if (d && isFinite(v.duration)) d.textContent = fmtDur(v.duration);
  } catch (_) {}
  window._chatImgLoaded && window._chatImgLoaded(v);
};
function _fmtVidTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
function _playVidReliable(v) {
  if (!v) return Promise.resolve();
  try {
    // Mobil Chrome: src dagi #fragment Range so'rovini buzadi
    const attr = v.getAttribute('src') || '';
    const cur = v.currentSrc || '';
    const raw = attr || cur;
    if (raw.includes('#')) {
      const clean = raw.split('#')[0];
      v.removeAttribute('src');
      while (v.firstChild) v.removeChild(v.firstChild);
      v.src = clean;
    }
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.playsInline = true;
  } catch (_) {}
  const go = () => v.play().catch(() => {
    // ba'zi mobil brauzerlar ovozli play ni bloklaydi — muted boshlab keyin ochamiz
    const wasMuted = v.muted;
    v.muted = true;
    return v.play().then(() => { if (!wasMuted) v.muted = false; }).catch(() => {});
  });
  if (v.readyState >= 2) return go();
  return new Promise(res => {
    let done = false;
    const finish = () => { if (done) return; done = true; v.removeEventListener('canplay', onReady); go().then(res, res); };
    const onReady = () => finish();
    v.addEventListener('canplay', onReady);
    try { v.load(); } catch (_) {}
    setTimeout(finish, 1200);
  });
}
function _requestFs(el, video) {
  const targets = [video, el].filter(Boolean);
  for (const t of targets) {
    const req = t.requestFullscreen || t.webkitRequestFullscreen || t.webkitEnterFullscreen || t.msRequestFullscreen;
    if (typeof req === 'function') {
      try {
        const r = req.call(t);
        if (r && typeof r.catch === 'function') r.catch(() => {});
        return;
      } catch (_) {}
    }
  }
}

function _ensureVidBar(wrap, v) {
  let bar = wrap.querySelector('.cfm-vid-bar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'cfm-vid-bar';
  bar.innerHTML = `
    <div class="cvb-progress"><div class="cvb-buf"></div><div class="cvb-fill"></div><div class="cvb-knob"></div></div>
    <div class="cvb-row">
      <button type="button" class="cvb-btn cvb-play" aria-label="Play/Pause">
        <svg class="cvb-ico-play" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        <svg class="cvb-ico-pause" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
      </button>
      <span class="cvb-time"><span class="cvb-cur">0:00</span><span class="cvb-sep">/</span><span class="cvb-dur">0:00</span></span>
      <button type="button" class="cvb-btn cvb-mute" aria-label="Ovoz">
        <svg class="cvb-ico-vol" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>
        <svg class="cvb-ico-mute" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
      </button>
      <button type="button" class="cvb-btn cvb-fs" aria-label="To'liq ekran">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
      </button>
    </div>`;
  const box = wrap.querySelector('.cfm-vid-box') || wrap;
  box.appendChild(bar);

  const fill = bar.querySelector('.cvb-fill');
  const buf = bar.querySelector('.cvb-buf');
  const knob = bar.querySelector('.cvb-knob');
  const curEl = bar.querySelector('.cvb-cur');
  const durEl = bar.querySelector('.cvb-dur');
  const playBtn = bar.querySelector('.cvb-play');
  const muteBtn = bar.querySelector('.cvb-mute');
  const fsBtn = bar.querySelector('.cvb-fs');
  const prog = bar.querySelector('.cvb-progress');

  const sync = () => {
    const d = v.duration || 0, c = v.currentTime || 0;
    const pct = d ? (c / d) * 100 : 0;
    fill.style.width = pct + '%';
    knob.style.left = pct + '%';
    curEl.textContent = _fmtVidTime(c);
    durEl.textContent = _fmtVidTime(d);
    try {
      if (v.buffered?.length) {
        const end = v.buffered.end(v.buffered.length - 1);
        buf.style.width = (d ? (end / d) * 100 : 0) + '%';
      }
    } catch (_) {}
    bar.classList.toggle('is-paused', v.paused);
    bar.classList.toggle('is-muted', v.muted || v.volume === 0);
  };

  v.addEventListener('timeupdate', sync);
  v.addEventListener('loadedmetadata', sync);
  v.addEventListener('progress', sync);
  v.addEventListener('play', sync);
  v.addEventListener('pause', sync);
  v.addEventListener('volumechange', sync);

  playBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (v.paused) _playVidReliable(v);
    else v.pause();
  });
  muteBtn.addEventListener('click', e => {
    e.stopPropagation();
    v.muted = !v.muted;
  });
  fsBtn.addEventListener('click', e => {
    e.stopPropagation();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      return;
    }
    // video element fullscreen — mobil layout to'g'ri
    _requestFs(box, v);
  });

  let scrubbing = false;
  const seekFromEvent = ev => {
    const r = prog.getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const ratio = Math.max(0, Math.min(1, x / r.width));
    if (isFinite(v.duration)) v.currentTime = ratio * v.duration;
    sync();
  };
  prog.addEventListener('pointerdown', ev => {
    ev.preventDefault(); ev.stopPropagation();
    scrubbing = true;
    prog.setPointerCapture?.(ev.pointerId);
    seekFromEvent(ev);
  });
  prog.addEventListener('pointermove', ev => { if (scrubbing) seekFromEvent(ev); });
  prog.addEventListener('pointerup', () => { scrubbing = false; });
  prog.addEventListener('pointercancel', () => { scrubbing = false; });

  // bar ichidagi click video toggle qilmasin
  bar.addEventListener('click', e => e.stopPropagation());
  sync();
  return bar;
}
function vidStop(wrap) {
  const v = wrap?.querySelector('video');
  if (!v) return;
  wrap.classList.remove('playing');
  v.controls = false;
  v.pause();
}
if (!window.__chatVidBound) {
  window.__chatVidBound = true;
  document.addEventListener('click', e => {
    const wrap = e.target?.closest?.('.cfm-vid-wrap');
    if (!wrap || e.button !== 0) return;
    if (wrap.closest('.msg-selecting')) return;
    if (e.target.closest?.('.cfm-vid-bar')) return;
    const v = wrap.querySelector('video');
    if (!v) return;
    e.preventDefault(); e.stopPropagation();
    // boshqa videolarni to'xtat
    document.querySelectorAll('.cfm-vid-wrap.playing').forEach(w => {
      if (w !== wrap) {
        const ov = w.querySelector('video');
        if (ov) { ov.pause(); }
        w.classList.remove('playing');
      }
    });
    if (wrap.classList.contains('playing')) {
      // toggle pause/play
      if (v.paused) _playVidReliable(v);
      else v.pause();
      return;
    }
    wrap.classList.add('playing');
    v.controls = false; // native emas — o'z barimiz
    try {
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.playsInline = true;
    } catch (_) {}
    _ensureVidBar(wrap, v);
    _playVidReliable(v);
  }, true);
  document.addEventListener('ended', e => {
    if (!e.target?.matches?.('.cfm-vid-wrap video')) return;
    const wrap = e.target.closest('.cfm-vid-wrap');
    vidStop(wrap);
    try { e.target.currentTime = 0; } catch (_) {}
  }, true);
}

if (!window.__chatNoteBound) {
  window.__chatNoteBound = true;
  const stopNote = w => { w.classList.remove('playing'); w.querySelector('video')?.pause(); };
  document.addEventListener('click', e => {
    const w = e.target?.closest?.('.cfm-note-wrap');
    if (!w || e.button !== 0) return;
    if (w.closest('.msg-selecting')) return;          // tanlash rejimida — xabar tanlanadi
    const v = w.querySelector('video');
    if (!v) return;
    e.preventDefault(); e.stopPropagation();
    if (w.classList.contains('playing')) { stopNote(w); return; }
    document.querySelectorAll('.cfm-note-wrap.playing').forEach(stopNote);
    document.querySelectorAll('.cfm-vid-wrap.playing video').forEach(o => o.pause());
    w.classList.add('playing');
    // Kechni oldini olish: avval buffer, keyin play
    try { v.muted = false; } catch (_) {}
    const tryPlay = () => v.play().catch(() => w.classList.remove('playing'));
    if (v.readyState >= 2) tryPlay();
    else {
      const onReady = () => { v.removeEventListener('canplay', onReady); tryPlay(); };
      v.addEventListener('canplay', onReady);
      try { v.load(); } catch (_) {}
      // fallback agar canplay kelmasa
      setTimeout(() => { if (w.classList.contains('playing') && v.paused) tryPlay(); }, 800);
    }
  }, true);
  document.addEventListener('ended', e => {
    if (!e.target?.matches?.('.cfm-note-vid')) return;
    e.target.closest('.cfm-note-wrap')?.classList.remove('playing');
    try { e.target.currentTime = 0; } catch (_) {}
  }, true);
}

export function generateVoiceBubble({ voiceMedia, dur, barCount, safeUrl, _mpName, renderVoiceWave, waveReadyClass, idx, state }) {
  const readyCls = typeof waveReadyClass === 'function' ? waveReadyClass(voiceMedia.url, barCount) : '';
  const safePath = String(voiceMedia.path || '').replace(/"/g, '"');
  return `<div class="chat-voice-msg" data-url="${safeUrl}" data-path="${safePath}" data-dur="${voiceMedia.duration||0}" data-bar-count="${barCount}" data-chat-id="${state.currentChatId||''}" data-chat-uid="${state.currentChatUid||''}" data-name="${_mpName}">
    <button class="cvm-play" onclick="window._chatPlayVoice(this)">
      <img src="./svg/media/play.svg" alt="" class="icon" width="14" height="14">
    </button>
    <div class="cvm-waveform${readyCls}">${renderVoiceWave(idx, barCount, voiceMedia.url)}</div>
    <span class="cvm-dur">${dur}</span>
  </div>`;
}

export function generateFileBubble({ m, fname, fsz, safeUrl, _isImage, hasCaption, captionHtml, time, mine, renderTicks, when = '', dm = false }) {
  const _ttl = when ? ` title="${esc(when)}"` : '';
  let bubbleClassExtra = '';
  let metaOutside = true;
  let bubbleContent = '';

  const _ext = String(m.fileName || '').toLowerCase().split('.').pop() || '';
  const _mimeL = String(m.mediaType || '').toLowerCase();
  const _isAudio = !_isImage && !_mimeL.startsWith('video') && (_mimeL.startsWith('audio') || AUD_EXT.includes(_ext));
  const _isVideo = !_isImage && !_isAudio && (_mimeL.startsWith('video') || VID_EXT.includes(_ext));


  /* 1v1 chat: rasm/video pufakka o'ralmaydi — faqat yupqa border. Izoh bo'lsa, u alohida kichik pufakda pastda.
     (Pufakka o'rash faqat guruhlar uchun.) */
  const _dmMedia = (inner, extraWrapCls = '') => {
    bubbleClassExtra = ' bubble-media-only bubble-media-dm';
    metaOutside = false;
    bubbleContent = `<div class="cfm-media-wrap cfm-media-wrap--standalone cfm-media-dm${extraWrapCls}">
        ${inner}
        <span class="chat-msg-meta cfm-media-badge">
          ${m.editedAt ? '<span class="chat-msg-edited">tahrirlangan</span>' : ''}<span class="chat-msg-time">${time}</span>
          ${mine ? renderTicks(m.status) : ''}
        </span>
      </div>${hasCaption ? `<div class="cfm-cap-dm">${captionHtml}</div>` : ''}`;
  };

  const _isNote = _isVideo && isVideoNote(m.fileName);
  if (_isNote) {
    /* Rolik: DM va guruh uchun bitta umumiy chizuvchi — components/video-note.js */
    bubbleClassExtra = ' bubble-media-only bubble-vnote';
    metaOutside = false;
    bubbleContent = renderVideoNote({ url: safeUrl, fileName: m.fileName, time, ticks: mine ? renderTicks(m.status) : '', ttl: _ttl });
  } else if (_isVideo) {
    const vid = `<div class="cfm-vid-box"${_ttl}>
        <video class="cfm-vid" src="${esc(safeUrl)}" preload="metadata" playsinline disablepictureinpicture${imgRatioAttr(safeUrl.split('#')[0])} onloadedmetadata="window._chatVidMeta&&window._chatVidMeta(this)"></video>
        <button type="button" class="cfm-vid-play" aria-label="Ijro etish">${PLAY_SVG}</button>
        <span class="cfm-vid-dur"></span>
      </div>`;
    if (dm) {
      _dmMedia(vid, ' cfm-vid-wrap');
    } else if (!hasCaption) {
      bubbleClassExtra = ' bubble-media-only';
      metaOutside = false;
      bubbleContent = `<div class="cfm-media-wrap cfm-media-wrap--standalone cfm-vid-wrap">
        ${vid}
        <span class="chat-msg-meta cfm-media-badge">
          ${m.editedAt ? '<span class="chat-msg-edited">tahrirlangan</span>' : ''}<span class="chat-msg-time">${time}</span>
          ${mine ? renderTicks(m.status) : ''}
        </span>
      </div>`;
    } else {
      bubbleClassExtra = ' bubble-media-caption';
      bubbleContent = `<div class="cfm-media-wrap cfm-vid-wrap">
        ${vid}
        ${captionHtml}
      </div>`;
    }
  } else if (_isImage) {
    if (dm) {
      _dmMedia(`<a href="${safeUrl}" class="cfm-img-link"${_ttl}>
          <img class="cfm-img-preview" src="${esc(safeUrl)}" alt="${fname}" loading="lazy"${imgRatioAttr(safeUrl)} onload="this.classList.add('loaded');window._chatImgLoaded&&window._chatImgLoaded(this)">
        </a>`);
    } else if (!hasCaption) {
      bubbleClassExtra = ' bubble-media-only';
      metaOutside = false;
      bubbleContent = `<div class="cfm-media-wrap cfm-media-wrap--standalone">
        <a href="${safeUrl}" class="cfm-img-link"${_ttl}>
          <img class="cfm-img-preview" src="${esc(safeUrl)}" alt="${fname}" loading="lazy"${imgRatioAttr(safeUrl)} onload="this.classList.add('loaded');window._chatImgLoaded&&window._chatImgLoaded(this)">
        </a>
        <span class="chat-msg-meta cfm-media-badge">
          ${m.editedAt ? '<span class="chat-msg-edited">tahrirlangan</span>' : ''}<span class="chat-msg-time">${time}</span>
          ${mine ? renderTicks(m.status) : ''}
        </span>
      </div>`;
    } else {
      bubbleClassExtra = ' bubble-media-caption';
      bubbleContent = `<div class="cfm-media-wrap">
        <a href="${safeUrl}" class="cfm-img-link"${_ttl}>
          <img class="cfm-img-preview" src="${esc(safeUrl)}" alt="${fname}" loading="lazy"${imgRatioAttr(safeUrl)} onload="this.classList.add('loaded');window._chatImgLoaded&&window._chatImgLoaded(this)">
        </a>
        ${captionHtml}
      </div>`;
    }
  } else if (_isAudio) {
    /* Yuklangan audio fayl (mp3...) — TO'LQIN YO'Q: Telegramdagidek play + nom + oddiy progress chiziq.
       To'lqin faqat yozib olingan ovozli xabar (type='voice') uchun. Pleyer mantig'i umumiy (chat-voice-player.js). */
    const _title = esc(String(m.fileName || 'Audio').replace(/\.[^.]+$/, '') || 'Audio');
    bubbleContent = `<div class="cfm-file-wrap cfm-audio-wrap">
      <div class="chat-voice-msg cvm-file" data-url="${safeUrl}" data-dur="0" data-name="${_title}">
        <button class="cvm-play" type="button" onclick="window._chatPlayVoice(this)" aria-label="Ijro etish">
          <img src="./svg/media/play.svg" alt="" class="icon" width="14" height="14">
        </button>
        <div class="cvm-fmeta">
          <div class="cvm-ftitle">${_title}</div>
          <div class="cvm-track" role="slider" aria-label="Ijro joyi" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="cvm-track-fill"></i></div>
          <span class="cvm-dur" data-sub="${fsz}">${fsz}</span>
        </div>
        <a class="cfm-dl" href="${safeUrl}" download="${fname}" title="Yuklab olish">
          <img src="./svg/extra/icon-2f7c262fe1e7.svg" alt="" class="icon" width="14" height="14">
        </a>
      </div>
      ${captionHtml}
    </div>`;
  } else {
    // Other files
    bubbleContent = `<div class="cfm-file-wrap">
      <div class="chat-file-msg">
        <div class="cfm-icon">${getChatFileIcon(m.fileName, m.mediaType)}</div>
        <div class="cfm-info">
          <a class="cfm-name cfm-name--link" href="${safeUrl}" title="Ochish">${fname}</a>
          ${fsz ? `<div class="cfm-size">${fsz}</div>` : ''}
        </div>
        <a class="cfm-dl" href="${safeUrl}" download="${fname}" title="Yuklab olish">
          <img src="./svg/extra/icon-2f7c262fe1e7.svg" alt="" class="icon" width="14" height="14">
        </a>
      </div>
      ${captionHtml}
    </div>`;
  }
  return { bubbleClassExtra, metaOutside, bubbleContent };
}

/* ── Qo'ng'iroq yozuvi pufagi (Telegram uslubi): sarlavha + o'q + vaqt, davomiylik + o'ng tomonda trubka ── */
const CALL_ARROW = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
const CALL_PHONE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.6 21 3 13.4 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>';
export function generateCallBubble({ cl, mine, time }) {
  const info = callLogInfo(cl, mine);
  const out = info.kind === 'out' || info.kind === 'cancel';
  const bad = info.kind === 'miss' || info.kind === 'cancel';
  const sub = time + (cl.ok ? ', ' + fmtCallDur(cl.d) : '');
  return {
    bubbleClassExtra: ' bubble-call',
    bubbleContent: `<div class="chat-call-msg ${bad ? 'bad' : 'good'}">
      <div class="ccm-info">
        <div class="ccm-title">${esc(info.title)}</div>
        <div class="ccm-sub"><span class="ccm-arrow${out ? ' out' : ''}">${CALL_ARROW}</span><span>${esc(sub)}</span></div>
      </div>
      <button type="button" class="ccm-btn" data-ccm-call title="Qo'ng'iroq qilish" aria-label="Qo'ng'iroq qilish">${CALL_PHONE}</button>
    </div>`,
  };
}
if (!window.__chatCallBound) {
  window.__chatCallBound = true;
  document.addEventListener('click', e => {
    const b = e.target?.closest?.('[data-ccm-call]');
    if (!b || e.button !== 0) return;
    if (b.closest('.msg-selecting')) return;   // tanlash rejimida — xabar tanlanadi
    e.preventDefault(); e.stopPropagation();
    document.getElementById('chatVoiceCallBtn')?.click();
  }, true);
}

export function generateTextBubble({ m, postShare, renderChatPostCard, wrapEmojiNoSelect, renderMarkdown, emojiOnlyClass }) {
  let bubbleClassExtra = '';
  let bubbleContent = '';
  let emoCls = '';

  if (postShare) {
    bubbleClassExtra = ' bubble-post-card';
    bubbleContent = renderChatPostCard(postShare);
  } else {
    emoCls = emojiOnlyClass(m.text);   // 1–3 ta emoji (bubblesiz) bo'lsa — 3D rasm, aks holda 2D
    bubbleContent = `<div class="chat-bubble-text">${wrapEmojiNoSelect(renderMarkdown(m.text || ''), emoCls ? '3d' : '2d')}</div>`;
  }
  return { bubbleClassExtra, bubbleContent, emoCls };
}

/** GIF xabar — rasm (media) pufagi bilan bir xil: fonsiz, vaqt rasm ustida (cfm-media-badge). dm=true: yupqa border. */
export function generateGifBubble({ gif, m, time, mine, renderTicks, dm = false }) {
  const ar = gif.w && gif.h ? ` style="aspect-ratio:${gif.w}/${gif.h}"` : '';
  return {
    bubbleClassExtra: dm ? ' bubble-media-only bubble-media-dm' : ' bubble-media-only',
    metaOutside: false,
    bubbleContent: `<div class="cfm-media-wrap cfm-media-wrap--standalone${dm ? ' cfm-media-dm' : ''}">
        <img class="cfm-img-preview chat-gif" src="${esc(gif.u)}" alt="GIF" loading="lazy" decoding="async" draggable="false"${ar}>
        <span class="chat-msg-meta cfm-media-badge">
          ${m.editedAt ? '<span class="chat-msg-edited">tahrirlangan</span>' : ''}<span class="chat-msg-time">${time}</span>
          ${mine ? renderTicks(m.status) : ''}
        </span>
      </div>`,
  };
}

/** Outer bubble shell — DM va guruh uchun bir xil */
export function wrapChatBubble({ bubbleContent, bubbleClassExtra = '', outerMeta = '', gHead = '', replyHtml = '' }) {
  return `<div class="chat-bubble${bubbleClassExtra}">
        <div class="chat-bubble-wrap">
          ${gHead}${replyHtml}${bubbleContent}
          ${outerMeta}
        </div>
      </div>`;
}

/** Bitta xabar qatori (date sep + msg) */
export function assembleMessageHtml({
  dateSep = '',
  mine,
  isNew,
  emoCls = '',
  msgId = '',
  animStyle = '',
  bubbleHtml,
  gAvi = '',
}) {
  return `${dateSep}<div class="chat-msg ${mine ? 'mine' : 'theirs'}${isNew ? ' anim-in' : ''}${emoCls}" data-msg-id="${msgId || ''}"${animStyle}>
      ${gAvi}
      ${bubbleHtml}
    </div>`;
}

/** Optimistic voice (yuborishdan oldin local blob) */
export function generateOptimisticVoiceHtml({
  safeUrl, duration, barCount, dur, time, chatId, chatUid, renderVoiceWave, renderTicks,
}) {
  return `<div class="chat-bubble">
    <div class="chat-bubble-wrap">
      <div class="chat-voice-msg" data-url="${safeUrl}" data-dur="${Math.round(duration || 0)}" data-bar-count="${barCount}" data-chat-id="${chatId || ''}" data-chat-uid="${chatUid || ''}" data-name="Siz">
        <button class="cvm-play" onclick="window._chatPlayVoice(this)">
          <img src="./svg/media/play.svg" alt="" class="icon" width="14" height="14">
        </button>
        <div class="cvm-waveform">${renderVoiceWave(0, barCount)}</div>
        <span class="cvm-dur">${dur}</span>
      </div>
      <span class="chat-msg-meta">
        <span class="chat-msg-time">${time}</span>
        ${renderTicks('sending')}
      </span>
    </div>
  </div>`;
}
