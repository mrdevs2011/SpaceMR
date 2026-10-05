/* video-note.js — Rolik (dumaloq video xabar): 1v1 chat VA guruh uchun BITTA umumiy modul.
   Fayl nomi, chizish (markup), oxirgi-xabar prevyusi shu yerda. Uslub: CSS/video-note.css.
   Yozish: chat-voice-record.js, yuborish: sendChatFile (DM/guruhga o'zi yo'naltiradi), chizish: message-bubble.js. */
import { esc } from '../../core/utils.js';

export const PLAY_SVG = '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,.55)"/><path d="M19 15.5v17l14-8.5z" fill="#fff"/></svg>';
export const fmtDur = t => { t = Math.max(0, Math.round(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

/* Fayl nomi: vnote_<ts>_<sek>.<ext> */
export const isVideoNote = name => /^vnote_/i.test(String(name || ''));
export const videoNoteFileName = (sec, ext) => `vnote_${Date.now()}_${sec}.${ext}`;
export function videoNoteSec(name) {
  const m = /^vnote_\d+_(\d+)\./i.exec(String(name || ''));
  return m ? +m[1] : null;
}

/* Fayl-xabar prevyusi (chatlar ro'yxati / inbox). icons=true: prefix bilan */
export function fileMsgPreview({ caption = '', fileName = '', icons = true } = {}) {
  const note = isVideoNote(fileName);
  if (icons) return caption ? caption : note ? 'Video xabar' : (fileName || 'Fayl');
  return caption || (note ? 'Video xabar' : fileName) || 'Fayl';
}

/* Rolik pufagining ichi. url — allaqachon `"` dan tozalangan; ticks — tayyor HTML; ttl — ' title="..."' */
export function renderVideoNote({ url, fileName, time, ticks = '', ttl = '' }) {
  const sec = videoNoteSec(fileName);
  return `<div class="cfm-note-wrap"${ttl}>
        <div class="cfm-note">
          <video class="cfm-note-vid" src="${esc(url)}" preload="metadata" playsinline webkit-playsinline disablepictureinpicture></video>
          <button type="button" class="cfm-note-play" aria-label="Ijro etish">${PLAY_SVG}</button>
        </div>
        <span class="chat-msg-meta cfm-media-badge cfm-note-badge">
          ${sec !== null ? `<span class="chat-msg-time">${fmtDur(sec)}</span><span aria-hidden="true">·</span>` : ''}<span class="chat-msg-time">${time}</span>
          ${ticks}
        </span>
      </div>`;
}
