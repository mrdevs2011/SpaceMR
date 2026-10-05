import './chat-image-zoom.js';
import { esc } from '../../core/utils.js';
import { getChatFileIcon, callLogInfo, fmtCallDur } from '../chat-shared.js';

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
const PLAY_SVG = '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,.55)"/><path d="M19 15.5v17l14-8.5z" fill="#fff"/></svg>';
const fmtDur = t => { t = Math.max(0, Math.round(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
window._chatVidMeta = function (v) {
  try {
    rememberImgRatio({ getAttribute: () => v.getAttribute('src').split('#')[0], naturalWidth: v.videoWidth, naturalHeight: v.videoHeight });
    if (v.videoWidth && v.videoHeight) v.style.aspectRatio = `${v.videoWidth}/${v.videoHeight}`;
    const d = v.closest('.cfm-vid-wrap')?.querySelector('.cfm-vid-dur');
    if (d && isFinite(v.duration)) d.textContent = fmtDur(v.duration);
  } catch (_) {}
  window._chatImgLoaded && window._chatImgLoaded(v);
};
function vidStop(wrap) {
  const v = wrap?.querySelector('video');
  if (!v) return;
  wrap.classList.remove('playing');
  v.controls = false;
}
if (!window.__chatVidBound) {
  window.__chatVidBound = true;
  document.addEventListener('click', e => {
    const wrap = e.target?.closest?.('.cfm-vid-wrap');
    if (!wrap || e.button !== 0) return;
    if (wrap.closest('.msg-selecting')) return;          // tanlash rejimida — xabar tanlanadi
    const v = wrap.querySelector('video');
    if (!v || wrap.classList.contains('playing')) return; // ijro paytida — o'zining boshqaruvi
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll('.cfm-vid-wrap.playing video').forEach(o => o.pause());
    wrap.classList.add('playing');
    v.controls = true;
    v.play().catch(() => {});
  }, true);
  document.addEventListener('ended', e => { if (e.target?.matches?.('.cfm-vid-wrap video')) { vidStop(e.target.closest('.cfm-vid-wrap')); try { e.target.currentTime = 0.1; } catch (_) {} } }, true);
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
    v.play().catch(() => w.classList.remove('playing'));
  }, true);
  document.addEventListener('ended', e => {
    if (!e.target?.matches?.('.cfm-note-vid')) return;
    e.target.closest('.cfm-note-wrap')?.classList.remove('playing');
    try { e.target.currentTime = 0.1; } catch (_) {}
  }, true);
}

export function generateVoiceBubble({ voiceMedia, dur, barCount, safeUrl, _mpName, renderVoiceWave, waveReadyClass, idx, state }) {
  const readyCls = typeof waveReadyClass === 'function' ? waveReadyClass(voiceMedia.url, barCount) : '';
  return `<div class="chat-voice-msg" data-url="${safeUrl}" data-dur="${voiceMedia.duration||0}" data-bar-count="${barCount}" data-chat-id="${state.currentChatId||''}" data-chat-uid="${state.currentChatUid||''}" data-name="${_mpName}">
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
  const _isVideo = !_isImage && (String(m.mediaType || '').toLowerCase().startsWith('video') || VID_EXT.includes(_ext));


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

  const _isNote = _isVideo && /^vnote_/i.test(String(m.fileName || ''));
  if (_isNote) {
    /* Rolik (dumaloq video xabar): vnote_<ts>_<sek>.webm */
    const _nd = /^vnote_\d+_(\d+)\./i.exec(String(m.fileName || ''));
    bubbleClassExtra = ' bubble-media-only bubble-vnote';
    metaOutside = false;
    bubbleContent = `<div class="cfm-note-wrap"${_ttl}>
        <div class="cfm-note">
          <video class="cfm-note-vid" src="${esc(safeUrl)}#t=0.1" preload="metadata" playsinline disablepictureinpicture></video>
          <button type="button" class="cfm-note-play" aria-label="Ijro etish">${PLAY_SVG}</button>
        </div>
        <span class="chat-msg-meta cfm-media-badge cfm-note-badge">
          ${_nd ? `<span class="chat-msg-time">${fmtDur(+_nd[1])}</span><span aria-hidden="true">·</span>` : ''}<span class="chat-msg-time">${time}</span>
          ${mine ? renderTicks(m.status) : ''}
        </span>
      </div>`;
  } else if (_isVideo) {
    const vid = `<div class="cfm-vid-box"${_ttl}>
        <video class="cfm-vid" src="${esc(safeUrl)}#t=0.1" preload="metadata" playsinline disablepictureinpicture${imgRatioAttr(safeUrl.split('#')[0])} onloadedmetadata="window._chatVidMeta&&window._chatVidMeta(this)"></video>
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
    bubbleContent = `<div class="chat-bubble-text">${wrapEmojiNoSelect(renderMarkdown(m.text || ''))}</div>`;
    emoCls = emojiOnlyClass(m.text);
  }
  return { bubbleClassExtra, bubbleContent, emoCls };
}

/** Outer bubble shell — DM va guruh uchun bir xil */
export function wrapChatBubble({ bubbleContent, bubbleClassExtra = '', outerMeta = '', gHead = '' }) {
  return `<div class="chat-bubble${bubbleClassExtra}">
        <div class="chat-bubble-wrap">
          ${gHead}${bubbleContent}
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
