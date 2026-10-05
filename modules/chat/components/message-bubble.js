import './chat-image-zoom.js';
import { esc } from '../../core/utils.js';
import { getChatFileIcon } from '../chat-shared.js';

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

export function generateFileBubble({ m, fname, fsz, safeUrl, _isImage, hasCaption, captionHtml, time, mine, renderTicks, when = '' }) {
  const _ttl = when ? ` title="${esc(when)}"` : '';
  let bubbleClassExtra = '';
  let metaOutside = true;
  let bubbleContent = '';

  if (_isImage) {
    if (!hasCaption) {
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
