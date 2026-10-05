// test 4: diff uchun izoh
import { state }  from './config.js';
import { toast }  from '../ui/toast.js';

/* ── DOM / formatting helpers ─────────────────────────────────────────── */
export const $    = id => document.getElementById(id);
export const esc  = s  => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') : '';

/**
 * Foydalanuvchi yozgan oddiy Markdown belgilarini xavfsiz
 * HTML'ga aylantiradi: **qalin**, *egik*, ~~chizilgan~~, `kod`, ```kod bloki```,
 * # ## ### sarlavhalar, - / * ro'yxat elementlari (ichma-ich/indent bilan ham),
 * 1. raqamlangan ro'yxat, > iqtibos, [matn](url) havolalar. Butun SpaceMR
 * bo'ylab ishlatiladi (shaxsiy/guruh chatlar, post tavsiflari, izohlar) —
 * HAR QANDAY foydalanuvchi shu belgilardan foydalansa
 * chiroyli ko'rinadi.
 *
 * XAVFSIZLIK: eng avval esc() orqali butun matn HTML-escape qilinadi (< > &
 * xavfli belgilar zararsizlantiriladi), FAQAT shundan keyin Markdown
 * belgilari (*, #, `, -, >, []()) HTML teglariga aylantiriladi — shuning
 * uchun foydalanuvchi hech qachon o'zboshimcha HTML/skript kiritib ulgira
 * olmaydi. Havolalarda ham faqat http(s)/mailto sxemalariga ruxsat
 * beriladi (masalan "javascript:" kabi xavfli sxemalar rad etiladi).
 */
export function renderMarkdown(rawText) {
  if (!rawText) return '';
  let s = esc(String(rawText));

  const codeBlocks = [];
  s = s.replace(/```([a-z0-9]*)\n([\s\S]*?)```/gi, (_m, lang, code) => {
    const safeCode = code.trim();
    const idx = codeBlocks.push(
      '<div class="md-code-wrapper">' +
        '<div class="md-code-header">' +
          '<span class="md-code-lang">' + (lang || 'code') + '</span>' +
          '<button class="md-code-copy" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText); const t=this.innerText; this.innerText=\'Nusxa olindi!\'; setTimeout(()=>this.innerText=t,2000)">Nusxa olish</button>' +
        '</div>' +
        '<pre class="md-codeblock"><code class="language-' + (lang || 'none') + '">' + safeCode + '</code></pre>' +
      '</div>'
    ) - 1;
    return '\u0000CB' + idx + '\u0000';
  });

  const inlineCodes = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = inlineCodes.push('<code class="md-code">' + code + '</code>') - 1;
    return '\u0000IC' + idx + '\u0000';
  });

  s = s.replace(/\|\|([\s\S]*?)\|\|/g, '<span class="md-spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');

  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+?)(?:\s+"[^"]*")?\)/g,
    '<a href="$2" class="md-link">$1</a>');

  const htmlTags = [];
  s = s.replace(/<[^>]+>/g, m => {
    const idx = htmlTags.push(m) - 1;
    return '\u0000TG' + idx + '\u0000';
  });

  // \u0000 (placeholder) va qo'shtirnoqlarda to'xtaydi — aks holda tayyor <a> tegi href ichiga tushib, atribut in'ektsiyasi bo'ladi
  s = s.replace(/(https?:\/\/[^\s<\u0000"']+)/g, '<a href="$1" class="md-link">$1</a>');

  s = s.replace(/\u0000TG(\d+)\u0000/g, (_m, idx) => htmlTags[parseInt(idx, 10)]);

  const htmlTags2 = [];
  s = s.replace(/<[^>]+>/g, m => {
    const idx = htmlTags2.push(m) - 1;
    return '\u0000TH' + idx + '\u0000';
  });

  s = s.replace(/(^|\s)@([a-zA-Z0-9_.]+)(?=\s|[.,!?]|$)/g, '$1<span class="md-mention" onclick="window.dispatchEvent(new CustomEvent(\'open-mention\', {detail: \'$2\'}))">@$2</span>');

  s = s.replace(/\u0000TH(\d+)\u0000/g, (_m, idx) => htmlTags2[parseInt(idx, 10)]);

  s = s.replace(/^[ \t]*###\s+(.+)$/gm, '<div class="md-h3">$1</div>');
  s = s.replace(/^[ \t]*##\s+(.+)$/gm,  '<div class="md-h2">$1</div>');
  s = s.replace(/^[ \t]*#\s+(.+)$/gm,   '<div class="md-h1">$1</div>');

  s = s.replace(/^[ \t]*&gt;\s?(.+)$/gm, '<div class="md-quote">$1</div>');

  s = s.replace(/^([ \t]*)(\d+)\.\s+(.+)$/gm, (_m, indent, num, txt) => {
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    return '<div class="md-li md-li-ol" style="padding-left:' + (2 + depth * 16) + 'px">' + num + '. ' + txt + '</div>';
  });
  s = s.replace(/^([ \t]*)[-*]\s+\[([ xX])\]\s+(.+)$/gm, (_m, indent, checked, txt) => {
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    const isChecked = checked.toLowerCase() === 'x';
    return '<div class="md-li md-task-list" style="padding-left:' + (2 + depth * 16) + 'px">' +
      '<input type="checkbox" disabled ' + (isChecked ? 'checked' : '') + ' class="md-task-checkbox"> ' + txt + '</div>';
  });
  s = s.replace(/^([ \t]*)[-*]\s+(.+)$/gm, (_m, indent, txt) => {
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    return '<div class="md-li" style="padding-left:' + (2 + depth * 16) + 'px">• ' + txt + '</div>';
  });

  const tables = [];
  s = s.replace(/(?:^[ \t]*\|.*\|[ \t]*\n)+^[ \t]*\|.*\|[ \t]*/gm, (match) => {
    let rows = match.trim().split('\n');
    let html = '<div class="md-table-wrap"><table class="md-table">';
    rows.forEach((row, i) => {
      if (row.match(/^\|?[ \t:-]+\|[ \t:-|]+$/)) return;
      const tag = (i === 0 && rows.length > 1 && rows[1].match(/^\|?[ \t:-]+\|[ \t:-|]+$/)) ? 'th' : 'td';
      let cols = row.trim().replace(/^\||\|$/g, '').split('|');
      html += '<tr>' + cols.map(c => '<' + tag + '>' + c.trim() + '</' + tag + '>').join('') + '</tr>';
    });
    html += '</table></div>';
    const idx = tables.push(html) - 1;
    return '\u0000TB' + idx + '\u0000';
  });

  s = s.replace(/~~([^~\n]+)~~/g, '<del class="md-del">$1</del>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

  s = s.replace(/\n/g, '<br>');

  s = s.replace(/\u0000TB(\d+)\u0000/g, (_m, idx) => tables[parseInt(idx, 10)]);
  s = s.replace(/\u0000IC(\d+)\u0000/g, (_m, idx) => inlineCodes[parseInt(idx, 10)]);
  s = s.replace(/\u0000CB(\d+)\u0000/g, (_m, idx) => codeBlocks[parseInt(idx, 10)]);

  return s;
}


/* X uslubidagi qisqa vaqt: "hozir", "5 daq", "3 soat", "4-okt", "4-okt, 2025" */
const UZ_MON = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
export const fmt  = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return 'hozir';
  if (sec < 3600) return Math.floor(sec / 60) + ' daq';
  if (sec < 86400) return Math.floor(sec / 3600) + ' soat';
  const day = `${d.getDate()}-${UZ_MON[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? day : `${day}, ${d.getFullYear()}`;
};

/* Faqat soat:minut (chat xabarlari ostidagi vaqt uchun, masalan "11:55") */
export const fmtTime = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
};

export const fmtSz  = b  => b > 1048576 ? (b/1048576).toFixed(1)+' MB' : (b/1024).toFixed(0)+' KB';

/* ── Onlayn holat / oxirgi faollik ────────────────────────────────────
 * Presence uchun alohida "online" maydon ishlatilmaydi — buning o'rniga
 * `lastSeenAt` (heartbeat orqali har ~25s da yangilanadi) asos qilib
 * olinadi. Agar oxirgi yangilanishdan beri ONLINE_THRESHOLD_MS dan kam
 * vaqt o'tgan bo'lsa — foydalanuvchi "onlayn" hisoblanadi.
 */
export const ONLINE_THRESHOLD_MS = 60 * 1000; // faqat shina (presence) uzilganda zaxira: heartbeat 25s, 2 ta o'tkazib yuborishga bufer

export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const d = new Date(lastSeenAt);
  return (Date.now() - d.getTime()) < ONLINE_THRESHOLD_MS;
}

export function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return "faollik ma'lumoti yo'q";
  // 'onlayn' bu yerda qaytarilmaydi: onlayn/oflayn qarorini rt-bus (presence) beradi.

  const d = new Date(lastSeenAt);
  // Soat daqiqalari bo'yicha: hozir 12:45 bo'lsa, 12:44 (yoki 12:45) — "hozirgina"; 12:43 va undan oldin — aniq vaqt
  const minAgo = Math.floor(Date.now() / 60000) - Math.floor(d.getTime() / 60000);
  if (minAgo <= 1) return 'hozirgina faol edi';

  // Aniq vaqt — bugun "23:45", kecha "kecha 23:45", undan oldin "23-avgust 22:45"
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const isYesterday = d.toDateString() === y.toDateString();

  if (isToday)     return `oxirgi marta ${timeStr} da faol edi`;
  if (isYesterday) return `oxirgi marta kecha ${timeStr} da faol edi`;
  const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  const yr = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `oxirgi marta ${d.getDate()}-${MONTHS[d.getMonth()]}${yr} ${timeStr} da faol edi`;
}
export const initL  = n  => (n && n[0] ? n[0].toUpperCase() : 'U');
export const uToEmail = u => `${u.toLowerCase().replace(/[^a-z0-9_]/g,'')}@gmail.com`;
export const clr    = n  => {
  const c = ['#202327','#2f3336','#71767b'];
  return c[Math.abs((n||'').length) % c.length];
};
export const defAvi = n => {
  const l = initL(n), c = clr(n);
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='${encodeURIComponent(c)}' rx='50'/%3E%3Ctext x='50' y='68' text-anchor='middle' fill='%23e7e9ea' font-size='44' font-weight='700' font-family='-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'%3E${l}%3C/text%3E%3C/svg%3E`;
};

/* ── Tasdiqlash dialog ───────────────────────────────────────────────────── */
export function showConfirm(msg, onOk, title = 'Aniqmi?', okLabel = 'Mayli', onCancel = null) {
  const confirmTitle   = $('confirmTitle');
  const confirmMsg     = $('confirmMsg');
  const confirmOverlay = $('confirmOverlay');
  const ok             = $('confirmOkBtn');
  const cancel         = $('confirmCancelBtn');
  if (!confirmTitle || !confirmMsg || !confirmOverlay || !ok || !cancel) {
    if (window.confirm(msg)) onOk();
    return;
  }
  confirmTitle.textContent = title;
  confirmMsg.textContent   = msg;
  ok.textContent = okLabel; // klon ham shu matnni oladi
  confirmOverlay.classList.add('show');
  const close  = () => confirmOverlay.classList.remove('show');
  const newOk  = ok.cloneNode(true);
  ok.parentNode.replaceChild(newOk, ok);
  newOk.onclick  = () => { close(); onOk(); };
  cancel.onclick = () => { close(); onCancel?.(); };
}

/* ── Heart burst animation ────────────────────────────────────────────── */
export function showHeartBurst(x, y, container) {
  const el = document.createElement('div');
  el.className = 'heart-burst';
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.innerHTML = `<img src="./svg/extra/icon-9d6229c40a8d.svg" alt="" class="icon" width="80" height="80">`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

/* ── File download ────────────────────────────────────────────────────── */
export async function dlFile(url, name) {
  toast('Yuklab olinmoqda...', 'info', 8000);
  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error('Tarmoq xatosi');
    const blob = await res.blob();
    const burl = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = burl;
    a.download = name || 'file';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(burl); a.remove(); }, 1000);
    toast('Yuklab olindi!', 'success');
  } catch {
    location.assign(url);
  }
}

/* ── Zoom modal ───────────────────────────────────────────────────────── */
/* ── Zoom lightbox: qorong'u fon, pinch / trackpad zoom, tashqariga bosib yopish ── */
let _z = { scale: 1, x: 0, y: 0, base: 1, px: 0, py: 0, pinching: false, panning: false, lastTap: 0, didDrag: false };

function _zApply() {
  const im = $('zoomImg');
  if (!im) return;
  im.style.transform = `translate(${_z.x}px, ${_z.y}px) scale(${_z.scale})`;
}

function _zReset() {
  _z.scale = 1; _z.x = 0; _z.y = 0; _z.base = 1; _z.px = 0; _z.py = 0;
  _z.pinching = false; _z.panning = false;
  _zApply();
}

function _zClose() {
  const zm = $('zoomModal');
  if (!zm) return;
  zm.classList.remove('show');
  _zReset();
  const im = $('zoomImg');
  if (im) { im.src = ''; im.style.display = 'none'; }
}

function _zDist(t) {
  const a = t[0], b = t[1];
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}
function _zMid(t) {
  return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
}

export function openZoom(url, type) {
  const im = $('zoomImg'), zm = $('zoomModal');
  if (!im || !zm) { location.assign(url); return; }
  _zReset();
  const isAvi = type === 'avatar';
  zm.classList.toggle('zoom-avatar', isAvi);
  zm.classList.toggle('zoom-image', !isAvi && type === 'image');
  im.style.display = 'block';
  im.src = url;
  if (isAvi) {
    im.style.borderRadius = '50%';
    im.style.width = 'min(72vw, 340px)';
    im.style.height = 'min(72vw, 340px)';
    im.style.objectFit = 'cover';
    im.style.maxWidth = 'none';
    im.style.maxHeight = 'none';
  } else if (type === 'image') {
    im.style.borderRadius = '0';
    im.style.width = '';
    im.style.height = '';
    im.style.objectFit = 'contain';
    im.style.maxWidth = '96vw';
    im.style.maxHeight = '96dvh';
  } else {
    location.assign(url);
    return;
  }
  im.style.transform = 'translate(0,0) scale(1)';
  im.style.transformOrigin = 'center center';
  im.style.transition = 'none';
  zm.classList.add('show');
}

function _bindZoomOnce() {
  const zm = $('zoomModal');
  const im = $('zoomImg');
  if (!zm || !im || zm._zoomBound) return;
  zm._zoomBound = true;

  const zoomClose = $('zoomClose');
  if (zoomClose) zoomClose.onclick = (e) => { e.stopPropagation(); _zClose(); };

  // Fon bosilsa yopish (rasm emas)
  zm.addEventListener('click', e => {
    if (e.target === zm && !_z.didDrag) _zClose();
    _z.didDrag = false;
  });

  // Double-tap / double-click → 2.5x / 1x
  im.addEventListener('click', e => {
    e.stopPropagation();
    if (_z.didDrag) { _z.didDrag = false; return; }
    const now = Date.now();
    if (now - _z.lastTap < 280) {
      if (_z.scale > 1.05) { _z.scale = 1; _z.x = 0; _z.y = 0; }
      else { _z.scale = 2.5; }
      _zApply();
    }
    _z.lastTap = now;
  });

  // Trackpad: ctrl/pinch wheel = zoom; 2-barmoq scroll = pan (kattalashtirilganda)
  zm.addEventListener('wheel', e => {
    if (!zm.classList.contains('show')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const delta = -e.deltaY * 0.01;
      const next = Math.min(6, Math.max(1, _z.scale * (1 + delta)));
      if (next <= 1.02) { _z.scale = 1; _z.x = 0; _z.y = 0; }
      else _z.scale = next;
      _zApply();
    } else if (_z.scale > 1.05) {
      _z.x -= e.deltaX;
      _z.y -= e.deltaY;
      _zApply();
    }
  }, { passive: false });

  // ── Touch: 2 barmoq pinch + 1 barmoq pan (zoom > 1) ──
  let startDist = 0, startScale = 1, startX = 0, startY = 0, mid0 = null, pan0x = 0, pan0y = 0;
  zm.addEventListener('touchstart', e => {
    if (!zm.classList.contains('show')) return;
    _z.didDrag = false;
    if (e.touches.length === 2) {
      e.preventDefault();
      _z.pinching = true;
      _z.panning = false;
      startDist = _zDist(e.touches);
      startScale = _z.scale;
      mid0 = _zMid(e.touches);
      pan0x = _z.x; pan0y = _z.y;
    } else if (e.touches.length === 1 && _z.scale > 1.05) {
      _z.panning = true;
      startX = e.touches[0].clientX - _z.x;
      startY = e.touches[0].clientY - _z.y;
    }
  }, { passive: false });

  zm.addEventListener('touchmove', e => {
    if (!zm.classList.contains('show')) return;
    if (_z.pinching && e.touches.length === 2) {
      e.preventDefault();
      const d = _zDist(e.touches);
      const mid = _zMid(e.touches);
      if (startDist > 0) {
        _z.scale = Math.min(6, Math.max(1, startScale * (d / startDist)));
        if (_z.scale <= 1.02) { _z.scale = 1; _z.x = 0; _z.y = 0; }
        else if (mid0) {
          // Pinch markaziga nisbatan pan
          _z.x = pan0x + (mid.x - mid0.x);
          _z.y = pan0y + (mid.y - mid0.y);
        }
        _z.didDrag = true;
        _zApply();
      }
    } else if (_z.panning && e.touches.length === 1) {
      e.preventDefault();
      _z.x = e.touches[0].clientX - startX;
      _z.y = e.touches[0].clientY - startY;
      _z.didDrag = true;
      _zApply();
    }
  }, { passive: false });

  zm.addEventListener('touchend', e => {
    if (e.touches.length < 2) _z.pinching = false;
    if (e.touches.length === 0) {
      _z.panning = false;
      if (_z.scale < 1.05) { _z.scale = 1; _z.x = 0; _z.y = 0; _zApply(); }
    }
  });

  // ── Mouse: left-click ushlab surish (faqat zoom > 1) ──
  let mousePan = false, mStartX = 0, mStartY = 0;
  im.addEventListener('pointerdown', e => {
    if (!zm.classList.contains('show')) return;
    if (e.pointerType === 'touch') return; // touch alohida
    if (e.button !== 0) return;
    if (_z.scale <= 1.05) return;
    mousePan = true;
    _z.didDrag = false;
    mStartX = e.clientX - _z.x;
    mStartY = e.clientY - _z.y;
    im.setPointerCapture?.(e.pointerId);
    im.style.cursor = 'grabbing';
    e.preventDefault();
  });
  im.addEventListener('pointermove', e => {
    if (!mousePan) return;
    _z.x = e.clientX - mStartX;
    _z.y = e.clientY - mStartY;
    _z.didDrag = true;
    _zApply();
  });
  const endMouse = e => {
    if (!mousePan) return;
    mousePan = false;
    im.style.cursor = '';
    try { im.releasePointerCapture?.(e.pointerId); } catch (_) {}
  };
  im.addEventListener('pointerup', endMouse);
  im.addEventListener('pointercancel', endMouse);

  // Capture + stopPropagation: Esc faqat rasmni yopadi. Aks holda umumiy Esc (shortcuts.js)
  // ham ishlab, rasm ostidagi oyna/profil/chatni ham yopib, bosh sahifagacha qaytarib yuborardi.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && zm.classList.contains('show')) {
      e.stopPropagation();
      e.preventDefault();
      _zClose();
    }
  }, true);
}

// DOM tayyor bo'lganda bir marta bog'lash
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bindZoomOnce);
  else _bindZoomOnce();
}

// Offline/online notifications o'chirildi
/* ═══════════════════════════════════════════════════════════════════════
   iOS 27 HAPTIC ENGINE
   navigator.vibrate — iOS Safari 16.4+ qo'llab-quvvatlaydi
   Fallback: CSS .haptic-flash animatsiyasi
   ═══════════════════════════════════════════════════════════════════════ */

const _hap = () => 'vibrate' in navigator;

export const haptic = {
  /** Engil tap — nav, like, checkbox */
  light  () { _hap() && navigator.vibrate(6);  },
  /** O'rta tap — tugmalar, post yuborish */
  medium () { _hap() && navigator.vibrate(10); },
  /** Og'ir tap — xato, ogohlantirish */
  heavy  () { _hap() && navigator.vibrate([12, 6, 12]); },
  /** Muvaffaqiyat — post, xabar yuborildi */
  success() { _hap() && navigator.vibrate([6, 4, 8]); },
  /** Xato — form validation, network error */
  error  () { _hap() && navigator.vibrate([14, 6, 14, 6, 14]); },
  /** Tanlash o'zgardi — tab, toggle, picker */
  select () { _hap() && navigator.vibrate(4);  },
};

/** Elementga visual + haptic touch feedback qo'shish */
export function addHapticTouch(el, type = 'light') {
  el.addEventListener('pointerdown', () => {
    haptic[type]?.();
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SCROLL LOCK — modal/sheet ochilganda orqa sahifa scroll bo'lmasin
   ═══════════════════════════════════════════════════════════════════════ */

/* Scroll qulfi. MUHIM: har qulf o'z KALITI bilan ro'yxatga olinadi (masalan 'uploadOverlay'):
   - bir kalit bilan takror lockScroll — qo'shimcha hisoblanmaydi (qulf "oqib" qolmaydi, scroll o'lmaydi);
   - qulflanmagan kalit bilan unlockScroll — hech narsa qilmaydi (eski xato: ortiqcha unlock
     window.scrollTo(0, eski_scrollY) chaqirib lentani tepaga otib yuborardi).
   Kalitsiz chaqiruv (eski kod) — oddiy hisoblagich, lekin u ham 0 dan pastga tushmaydi. */
const _scrollLocks = new Set();
let _scrollLockAnon = 0;
let _scrollLockApplied = false;   // body haqiqatan qulflanganmi
let _scrollY = 0;

const _scrollLockTotal = () => _scrollLocks.size + _scrollLockAnon;

function _applyScrollLock() {
  if (_scrollLockApplied) return;
  _scrollLockApplied = true;
  _scrollY = window.scrollY;
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${_scrollY}px`;
  document.body.style.width = '100%';
}

function _releaseScrollLock(restore) {
  if (!_scrollLockApplied) return;   // qulflanmagan bo'lsa — scroll joyiga umuman tegmaymiz
  _scrollLockApplied = false;
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  if (restore) window.scrollTo(0, _scrollY);
}

/** Body scrollini bloklash — modal/sheet ochilganda. key = qulf egasi (masalan overlay id). */
export function lockScroll(key) {
  if (key) _scrollLocks.add(key); else _scrollLockAnon++;
  _applyScrollLock();
}

/** Body scrollini qayta ochish — modal/sheet yopilganda. Shu key bilan lock qilinmagan bo'lsa — e'tiborsiz. */
export function unlockScroll(key) {
  if (key) { if (!_scrollLocks.delete(key)) return; }
  else { if (_scrollLockAnon === 0) return; _scrollLockAnon--; }
  if (_scrollLockTotal() === 0) _releaseScrollLock(true);
}

/** Barcha qulflarni majburan tozalash (sahifa/route almashganda). Scroll joyi tiklanmaydi. */
export function resetScrollLock() {
  _scrollLocks.clear();
  _scrollLockAnon = 0;
  _releaseScrollLock(false);
}

/** 1234 -> "1.2K", 0 -> "" (X uslubi) */
export const fmtCount = n => {
  n = Number(n) || 0;
  if (!n) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
};

/* ── Clipboard nusxalash (barcha brauzer lar uchun xavfsiz) ─────────────── */
export async function copyToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), {
      value: text,
    });
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
}

/* ── Foydalanuvchi holati tekshiruvi (chat.js va groups.js umumiy) ───── */
/** Tasdiqlangan va (muddati o'tmagan) bloklanmagan foydalanuvchi */
export function isActiveUser(u) {
  if (u.approval !== 'approved') return false;
  if (!u.blocked) return true;
  return !!(u.blockedUntil && u.blockedUntil < Date.now());
}
