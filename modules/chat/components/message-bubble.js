import { esc } from '../../core/utils.js';

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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    </button>
    <div class="cvm-waveform${readyCls}">${renderVoiceWave(idx, barCount, voiceMedia.url)}</div>
    <span class="cvm-dur">${dur}</span>
  </div>`;
}

export function generateFileBubble({ m, fname, fsz, safeUrl, _isImage, hasCaption, captionHtml, time, mine, renderTicks }) {
  let bubbleClassExtra = '';
  let metaOutside = true;
  let bubbleContent = '';

  if (_isImage) {
    if (!hasCaption) {
      bubbleClassExtra = ' bubble-media-only';
      metaOutside = false;
      bubbleContent = `<div class="cfm-media-wrap cfm-media-wrap--standalone">
        <a href="${safeUrl}" target="_blank" rel="noopener" class="cfm-img-link">
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
        <a href="${safeUrl}" target="_blank" rel="noopener" class="cfm-img-link">
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
          <a class="cfm-name cfm-name--link" href="${safeUrl}" target="_blank" rel="noopener" title="Ochish">${fname}</a>
          ${fsz ? `<div class="cfm-size">${fsz}</div>` : ''}
        </div>
        <a class="cfm-dl" href="${safeUrl}" download="${fname}" target="_blank" title="Yuklab olish">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
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

function getChatFileIcon(name, mime) {
  const n = (name || '').toLowerCase();
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic)$/i.test(n)) {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  }
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}
