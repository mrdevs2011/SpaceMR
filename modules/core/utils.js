// test 4: diff uchun izoh
import { state, sb }  from './config.js';
import { toast }  from '../ui/toast.js';
import { protectSecrets } from './secrets.js';

/* ── DOM / formatting helpers ─────────────────────────────────────────── */
export const $    = id => document.getElementById(id);
export const esc  = s  => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') : '';

/* ── Spoiler vault: maxfiy matn DOM/HTML da EMAS — faqat xotirada.
   Kenglik character soniga mos (--spoiler-ch). Ochilganda vault dan ~0ms. */
const _spoilerVault = new Map();
let _spoilerSeq = 0;

export function spoilerVaultGet(id) {
  return _spoilerVault.get(String(id)) ?? null;
}

export function spoilerVaultHas(id) {
  return _spoilerVault.has(String(id));
}

/* SPOILER_DEPLOY t-1792259696568 */
/** Approximate display width in "ch" units (emoji/CJK wider). */
function spoilerChCount(text) {
  let n = 0;
  for (const ch of String(text || '')) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    const cp = ch.codePointAt(0);
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
    if (cp > 0xffff || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf)) n += 2;
    else if (cp >= 0x1100 && cp <= 0xd7af) n += 2;
    else if (cp >= 0x2e80 && cp <= 0x9fff) n += 2;
    else n += 1;
  }
  return Math.max(2, n);
}

/** Per-line metrics for multi-line spoilers (matches real text shape). */
function spoilerLineMetrics(text) {
  const raw = String(text || '');
  let parts = raw.length ? raw.split(/\r?\n/) : [''];
  while (parts.length > 1 && !String(parts[0]).trim()) parts.shift();
  while (parts.length > 1 && !String(parts[parts.length - 1]).trim()) parts.pop();
  if (!parts.length) parts = [''];
  return parts.map(line => ({
    ch: Math.max(3, spoilerChCount(line.length ? line : '...')),
    line: line
  }));
}

function measureSpoilerPx(text, fontSourceEl, chHint) {
  let t = String(text || '').replace(/[\r\n\t]+/g, ' ');
  // Matn yo'q (marker-only) — ch soniga mos probe string
  if (!t && chHint > 0) {
    t = 'n'.repeat(Math.max(1, Math.min(200, chHint | 0)));
  }
  if (!t) return 0;
  try {
    const cs = getComputedStyle(fontSourceEl || document.body);
    const canvas = measureSpoilerPx._c || (measureSpoilerPx._c = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const size = cs.fontSize || '15px';
    const family = cs.fontFamily || 'sans-serif';
    const weight = cs.fontWeight || '400';
    const style = cs.fontStyle || 'normal';
    ctx.font = style + ' ' + weight + ' ' + size + ' ' + family;
    const w = ctx.measureText(t).width;
    let ls = 0;
    try {
      const raw = cs.letterSpacing;
      if (raw && raw !== 'normal') ls = parseFloat(raw) || 0;
    } catch (_) {}
    if (ls) return Math.ceil(w + ls * Math.max(0, t.length - 1));
    return Math.ceil(w);
  } catch (_) {
    return 0;
  }
}

function spoilerLineBarsHtml(metrics) {
  return metrics.map(m => {
    const ch = Math.max(3, m.ch || 3);
    // Absolute ch width — NOT min(100%,…) — flex parent width:auto da % circular collapse qiladi
    return '<span class="md-spoiler-line" style="--spoiler-ch:' + ch +
      ';width:' + ch + 'ch;min-width:3ch;max-width:100%" aria-hidden="true"></span>';
  }).join('');
}

function spoilerPlaceholder(rawInner, meta) {
  meta = meta || {};
  const text = String(rawInner ?? '');
  let metrics;
  if (text) {
    metrics = spoilerLineMetrics(text);
  } else if (meta.lineCh && meta.lineCh.length) {
    metrics = meta.lineCh.map(ch => ({ ch: Math.max(2, Number(ch) || 2), line: '' }));
  } else {
    metrics = [{ ch: Math.max(2, meta.ch != null ? Number(meta.ch) : 4), line: '' }];
  }
  const totalCh = metrics.reduce((s, m) => s + m.ch, 0);
  const ch = Math.max(2, meta.ch != null ? Number(meta.ch) : totalCh);
  const multi = metrics.length > 1;
  const bars = multi ? spoilerLineBarsHtml(metrics) : '';
  const cls = 'md-spoiler' + (bars ? ' md-spoiler-block' : '');
  const style = bars
    ? '--spoiler-ch:' + ch
    : '--spoiler-ch:' + ch + ';min-width:min(100%,' + ch + 'ch);width:min(100%,' + ch + 'ch)';

  if (meta.msgId != null && meta.ord != null) {
    return '<span class="' + cls + '" data-scope="' + (meta.scope || 'dm') +
      '" data-msg="' + String(meta.msgId).replace(/"/g, '') +
      '" data-ord="' + String(meta.ord) +
      '" data-ch="' + ch +
      '" data-lines="' + metrics.length +
      '" style="' + style +
      '" role="button" tabindex="0" aria-label="Spoiler">' + bars + '</span>';
  }
  const id = 'sp' + (++_spoilerSeq);
  _spoilerVault.set(id, text);
  return '<span class="' + cls + '" data-sid="' + id + '" data-ch="' + ch +
    '" data-lines="' + metrics.length +
    '" style="' + style +
    '" role="button" tabindex="0" aria-label="Spoiler">' + bars + '</span>';
}

/** Har qanday konteynerdagi blur bar kengligini aniq qil (post, chat, izoh, ...). */
export function layoutSpoilers(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('.md-spoiler:not(.revealed)').forEach(el => {
    const id = el.getAttribute('data-sid');
    const text = id ? _spoilerVault.get(id) : null;
    const lines = el.querySelectorAll('.md-spoiler-line');

    if (text != null && text.length && lines.length) {
      const metrics = spoilerLineMetrics(text);
      // Rebuild bars if line count mismatch
      if (metrics.length !== lines.length) {
        el.innerHTML = spoilerLineBarsHtml(metrics);
        el.classList.add('md-spoiler-block');
        el.setAttribute('data-lines', String(metrics.length));
      }
      const bars = el.querySelectorAll('.md-spoiler-line');
      let maxPx = 0;
      metrics.forEach((m, i) => {
        const bar = bars[i];
        if (!bar) return;
        const ch = Math.max(2, m.ch);
        const px = measureSpoilerPx(m.line.length ? m.line : '', el.parentElement || el, ch);
        // Absolute width — min(100%,…) flex column da circular collapse beradi
        if (px > 0) {
          bar.style.width = px + 'px';
          bar.style.minWidth = Math.min(px, 24) + 'px';
          bar.style.maxWidth = '100%';
          if (px > maxPx) maxPx = px;
        } else {
          bar.style.width = ch + 'ch';
          bar.style.minWidth = '3ch';
          bar.style.maxWidth = '100%';
        }
        bar.style.setProperty('--spoiler-ch', String(ch));
      });
      if (maxPx > 0) {
        el.style.width = 'auto';
        el.style.maxWidth = '100%';
      }
      el.setAttribute('data-ch', String(metrics.reduce((s, m) => s + m.ch, 0)));
      return;
    }

    if (text != null && text.length && !lines.length) {
      // single-line bar (or upgrade to multi)
      const metrics = spoilerLineMetrics(text);
      if (metrics.length > 1) {
        el.innerHTML = spoilerLineBarsHtml(metrics);
        el.classList.add('md-spoiler-block');
        el.style.width = 'auto';
        el.style.height = 'auto';
        el.setAttribute('data-lines', String(metrics.length));
        layoutSpoilers(el.parentElement || el);
        return;
      }
      const px = measureSpoilerPx(text, el.parentElement || el);
      const ch = Math.max(2, spoilerChCount(text));
      if (px > 0) {
        el.style.width = 'min(100%, ' + px + 'px)';
        el.style.minWidth = Math.min(px, 48) + 'px';
      } else {
        el.style.width = 'min(100%, ' + ch + 'ch)';
      }
      el.style.setProperty('--spoiler-ch', String(ch));
      el.setAttribute('data-ch', String(ch));
      return;
    }

    // marker-only: multi-line bars already present (lineCh from server marker)
    if (lines.length) {
      // data-lines bilan bar soni mos kelmasa — qayta chizamiz
      const wantLines = parseInt(el.getAttribute('data-lines') || '0', 10) || lines.length;
      if (wantLines > 1 && lines.length !== wantLines) {
        const totalCh = parseInt(el.getAttribute('data-ch') || '0', 10) || 0;
        const per = Math.max(3, Math.ceil((totalCh || wantLines * 8) / wantLines));
        const metrics = Array.from({ length: wantLines }, () => ({ ch: per, line: '' }));
        el.innerHTML = spoilerLineBarsHtml(metrics);
        el.classList.add('md-spoiler-block');
        el.setAttribute('data-lines', String(wantLines));
        // yangi barlar bilan davom etamiz
        const bars2 = el.querySelectorAll('.md-spoiler-line');
        bars2.forEach(bar => {
          let lch = parseInt(bar.style.getPropertyValue('--spoiler-ch') || '0', 10) || per;
          lch = Math.max(3, lch);
          const px = measureSpoilerPx('', el.parentElement || el, lch);
          if (px > 0) {
            bar.style.width = px + 'px';
            bar.style.minWidth = Math.min(px, 24) + 'px';
          } else {
            bar.style.width = lch + 'ch';
            bar.style.minWidth = '3ch';
          }
          bar.style.maxWidth = '100%';
          bar.style.setProperty('--spoiler-ch', String(lch));
        });
        el.style.width = 'auto';
        el.style.maxWidth = '100%';
        el.style.height = 'auto';
        return;
      }
      lines.forEach(bar => {
        let lch = parseInt(bar.style.getPropertyValue('--spoiler-ch') || '0', 10);
        if (!lch) lch = parseInt(bar.getAttribute('data-ch') || '0', 10);
        lch = Math.max(3, lch || 3);
        // Canvas bilan aniq px — ch birligi shriftga bog'liq, noto'g'ri chiqishi mumkin
        const px = measureSpoilerPx('', el.parentElement || el, lch);
        if (px > 0) {
          bar.style.width = px + 'px';
          bar.style.minWidth = Math.min(px, 24) + 'px';
        } else {
          bar.style.width = lch + 'ch';
          bar.style.minWidth = '3ch';
        }
        bar.style.maxWidth = '100%';
        bar.style.setProperty('--spoiler-ch', String(lch));
      });
      el.classList.add('md-spoiler-block');
      el.style.width = 'auto';
      el.style.maxWidth = '100%';
      el.style.height = 'auto';
      return;
    }

    // marker-only: single bar from data-ch
    // Uzun matn uchun oldindan taxminiy qatorlar ajrat (bubble kengligiga qarab)
    let ch = parseInt(el.getAttribute('data-ch') || '0', 10);
    ch = Math.max(2, ch || 4);
    el.style.setProperty('--spoiler-ch', String(ch));

    if (!lines.length && ch > 28) {
      // Uzun blur: bitta to'liq kenglikdagi blok, balandligi taxminiy qatorlar soniga mos
      // (to'p-to'p qisqa barlar o'rniga)
      let charsPerLine = 32;
      try {
        const parent = el.closest('.chat-bubble') || el.parentElement || el;
        const pw = parent.getBoundingClientRect().width;
        if (pw > 60) {
          const cs = getComputedStyle(el);
          const fs = parseFloat(cs.fontSize) || 14;
          charsPerLine = Math.max(22, Math.floor((pw - 24) / (fs * 0.52)));
        }
      } catch (_) {}
      const lineCount = Math.max(1, Math.min(6, Math.ceil(ch / charsPerLine)));
      if (lineCount >= 1) {
        // Bitta keng bar, balandligi lineCount * 1.25em
        el.style.width = '100%';
        el.style.maxWidth = '100%';
        el.style.minWidth = '0';
        el.style.height = (lineCount * 1.25) + 'em';
        el.style.display = 'block';
        el.classList.remove('md-spoiler-block');
        el.innerHTML = ''; // ::before pattern butun maydonni qoplasin
        el.setAttribute('data-lines', String(lineCount));
        el.setAttribute('data-ch', String(ch));
        return;
      }
    }

    if (!lines.length) {
      el.style.width = 'min(100%, ' + ch + 'ch)';
      el.style.minWidth = Math.min(ch, 8) + 'ch';
    }
    el.setAttribute('data-ch', String(ch));
  });
}

function _revealSpoilerApply(el, text) {
  /* Serverdan kelgan matn — newline saqlanadi, pre-wrap bilan ko'rsatiladi */
  let body = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.classList.remove('md-spoiler-block', 'md-spoiler-loading');
  el.innerHTML = '';
  el.textContent = body;
  el.classList.add('revealed');
  el.style.removeProperty('--spoiler-ch');
  el.style.boxSizing = 'border-box';
  el.style.whiteSpace = 'pre-wrap';
  el.style.display = 'inline-block';
  /* Blur box o'lchamini saqlab surilishni kamaytiramiz */
  if (w > 0) el.style.width = w + 'px';
  if (h > 0) el.style.minHeight = h + 'px';
  el.style.removeProperty('height');
  el.style.removeProperty('min-width');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!el.classList.contains('revealed')) return;
      el.style.removeProperty('width');
      el.style.removeProperty('min-height');
    });
  });
}

async function revealSpoilerEl(el) {
  if (!el || el.classList.contains('revealed')) return false;
  const id = el.getAttribute('data-sid');
  if (id) {
    const text = _spoilerVault.get(id);
    if (text == null) return false;
    _revealSpoilerApply(el, text);
    return true;
  }
  const msg = el.getAttribute('data-msg');
  const ord = el.getAttribute('data-ord');
  const scope = el.getAttribute('data-scope') || 'dm';
  if (!msg || ord == null) return false;
  el.classList.add('md-spoiler-loading');
  try {
    const { data, error } = await sb.rpc('reveal_spoiler', {
      p_scope: scope,
      p_message_id: msg,
      p_ordinal: parseInt(ord, 10)
    });
    if (error || data == null) {
      el.classList.remove('md-spoiler-loading');
      return false;
    }
    const text = String(data);
    const vid = 'rpc:' + scope + ':' + msg + ':' + ord;
    _spoilerVault.set(vid, text);
    el.setAttribute('data-sid', vid);
    _revealSpoilerApply(el, text);
    return true;
  } catch (_) {
    el.classList.remove('md-spoiler-loading');
    return false;
  }
}

function hideSpoilerEl(el) {
  if (!el || !el.classList.contains('revealed')) return;
  const id = el.getAttribute('data-sid');
  const text = id ? _spoilerVault.get(id) : null;
  /* Yopishdan oldin box o'lchamini saqlaymiz — surilish bo'lmasin */
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.textContent = '';
  el.classList.remove('revealed');
  el.style.boxSizing = 'border-box';
  if (w > 0) el.style.width = w + 'px';
  if (h > 0) el.style.minHeight = h + 'px';
  if (text != null && text.length) {
    const metrics = spoilerLineMetrics(text);
    if (metrics.length > 1) {
      el.innerHTML = spoilerLineBarsHtml(metrics);
      el.classList.add('md-spoiler-block');
      el.setAttribute('data-lines', String(metrics.length));
    } else {
      const ch = Math.max(2, metrics[0]?.ch || 4);
      el.classList.remove('md-spoiler-block');
      el.style.setProperty('--spoiler-ch', String(ch));
      el.setAttribute('data-ch', String(ch));
    }
  } else {
    const ch = parseInt(el.getAttribute('data-ch') || '4', 10) || 4;
    const lines = parseInt(el.getAttribute('data-lines') || '1', 10) || 1;
    el.style.setProperty('--spoiler-ch', String(ch));
    if (lines > 1) {
      /* marker-only multi-line: data-ch jami, lineCh yo'q — taxminiy teng qatorlar */
      const per = Math.max(3, Math.ceil(ch / lines));
      const metrics = Array.from({ length: lines }, () => ({ ch: per, line: '' }));
      el.innerHTML = spoilerLineBarsHtml(metrics);
      el.classList.add('md-spoiler-block');
    } else {
      el.classList.remove('md-spoiler-block');
    }
  }
  requestAnimationFrame(() => {
    layoutSpoilers(el.parentElement || document);
    requestAnimationFrame(() => {
      if (el.classList.contains('revealed')) return;
      el.style.removeProperty('width');
      el.style.removeProperty('min-height');
      el.style.height = 'auto';
    });
  });
}

let _spoilerUiBound = false;
export function bindSpoilerUI() {
  if (_spoilerUiBound) return;
  if (typeof document === 'undefined') return; // Node / SSR
  _spoilerUiBound = true;
  let _lastSpoilerAct = 0;
  /* Qisqa bosish = ochish/yopish; uzun bosish (select) = hech narsa */
  let _spDown = null; // { t, x, y, el, pid }
  const TAP_MS = 380;
  const TAP_MOVE = 12; // px
  const act = (el) => {
    if (!el || !el.classList.contains('md-spoiler')) return;
    const now = Date.now();
    if (now - _lastSpoilerAct < 350) return; // click+pointerup double-fire
    _lastSpoilerAct = now;
    if (el.classList.contains('revealed')) hideSpoilerEl(el);
    else revealSpoilerEl(el);
  };
  const isShortTap = (e, down) => {
    if (!down) return false;
    const dt = Date.now() - down.t;
    const dx = Math.abs((e.clientX ?? 0) - down.x);
    const dy = Math.abs((e.clientY ?? 0) - down.y);
    return dt < TAP_MS && dx < TAP_MOVE && dy < TAP_MOVE;
  };
  const hasTextSelection = () => {
    try {
      const s = window.getSelection();
      return !!(s && !s.isCollapsed && s.toString().trim());
    } catch (_) { return false; }
  };
  document.addEventListener('pointerdown', (e) => {
    const el = e.target?.closest?.('.md-spoiler');
    if (!el) { _spDown = null; return; }
    if (e.button != null && e.button !== 0) { _spDown = null; return; }
    _spDown = { t: Date.now(), x: e.clientX || 0, y: e.clientY || 0, el, pid: e.pointerId };
  }, true);
  document.addEventListener('pointercancel', () => { _spDown = null; }, true);
  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('.md-spoiler');
    if (!el) return;
    if (e.button != null && e.button !== 0) return;
    // Select rejimi yoki uzun bosish — ochma/yopma
    if (hasTextSelection()) return;
    if (_spDown && _spDown.el === el && !isShortTap(e, _spDown)) {
      _spDown = null;
      return;
    }
    _spDown = null;
    e.preventDefault();
    e.stopPropagation();
    act(el);
  }, true);
  document.addEventListener('pointerup', (e) => {
    // iOS/Android: click ba'zan yutiladi — faqat qisqa tap
    if (e.pointerType === 'mouse') return;
    const el = e.target?.closest?.('.md-spoiler');
    if (!el) { _spDown = null; return; }
    if (hasTextSelection()) { _spDown = null; return; }
    if (!_spDown || _spDown.el !== el || !isShortTap(e, _spDown)) {
      _spDown = null;
      return;
    }
    _spDown = null;
    e.preventDefault();
    e.stopPropagation();
    act(el);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest?.('.md-spoiler');
    if (!el) return;
    e.preventDefault();
    act(el);
  }, true);
  // Yangi .md-spoiler qo'shilganda kenglikni aniqla (debounce, faqat spoiler node)
  try {
    let _layoutSched = false;
    const scheduleLayout = () => {
      if (_layoutSched) return;
      _layoutSched = true;
      requestAnimationFrame(() => {
        _layoutSched = false;
        try { layoutSpoilers(document); } catch (_) {}
      });
    };
    const hasSpoiler = (node) => {
      if (!node || node.nodeType !== 1) return false;
      if (node.classList && node.classList.contains('md-spoiler')) return true;
      return !!(node.querySelector && node.querySelector('.md-spoiler'));
    };
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (!m.addedNodes) continue;
        for (const n of m.addedNodes) {
          if (hasSpoiler(n)) { scheduleLayout(); return; }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  if (document.readyState !== 'loading') requestAnimationFrame(() => layoutSpoilers(document));
  else document.addEventListener('DOMContentLoaded', () => layoutSpoilers(document));
}


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
const YT_IFRAME_RE = /(?:<|&lt;)iframe\b[^>]*(?:src|SRC)=["'&quot;](?:https?:)?\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\/([a-zA-Z0-9_-]{11})[^"'&]*["'&quot;][^>]*(?:>|&gt;)(?:[\s\S]*?(?:<|&lt;)\/iframe(?:>|&gt;))?/gi;
const YT_URL_RE = /(?:https?:\/\/)?(?:(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^\s<"'\`)]*&)?v=|shorts\/|embed\/))|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&][^\s<"'\`)]*)?/gi;

const IG_RE = /(?:https?:\/\/)?(?:www\.)?instagr(?:\.am|am\.com)\/(p|reel|tv)\/([a-zA-Z0-9_-]+)(?:[/?&][^\s<"'\`)]*)?/gi;
const TT_RE = /(?:https?:\/\/)?(?:(?:www\.|m\.)?tiktok\.com\/@[a-zA-Z0-9_.-]+\/video\/(\d+)|(?:vm|vt)\.tiktok\.com\/([a-zA-Z0-9_-]+)\/?|(?:www\.)?tiktok\.com\/t\/([a-zA-Z0-9_-]+)\/?)(?:[?&][^\s<"'\`)]*)?/gi;
const FB_RE = /(?:https?:\/\/)?(?:(?:www\.|m\.|web\.)?facebook\.com\/(?:watch\/?\?(?:[^\s<"'\`)]*&)?v=(\d+)|reel\/(\d+)|[^\/\s<"'\`)]+\/videos\/(\d+))|fb\.watch\/([a-zA-Z0-9_-]+))(?:[?&][^\s<"'\`)]*)?/gi;
const VID_RE = /https?:\/\/[^\s<"'\`)]+?\.(?:mp4|webm|mov|m4v)(?:\?[^\s<"'\`)]*)?/gi;
const IMG_RE = /https?:\/\/[^\s<"'\`)]+?\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^\s<"'\`)]*)?/gi;

export const PLATFORM_LOGOS = {
  youtube: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#ff0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  tiktok: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#ffffff"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.47 6.27 6.27 0 0 0 1.87-4.47V8.78a8.28 8.28 0 0 0 4.84 1.54V6.87a4.84 4.84 0 0 1-.94-.18z"/></svg>`,
  instagram: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16"><defs><radialGradient id="smIgG" r="150%" cx="30%" cy="107%"><stop stop-color="#fdf497" offset="0%"/><stop stop-color="#fd5949" offset="45%"/><stop stop-color="#d6249f" offset="60%"/><stop stop-color="#285AEB" offset="90%"/></radialGradient></defs><rect x="2" y="2" width="20" height="20" rx="5.5" fill="url(#smIgG)"/><path fill="#ffffff" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zm5.2-8.4a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z"/></svg>`,
  facebook: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  x: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="15" height="15" fill="#ffffff"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  telegram: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#24A1DE"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z"/></svg>`,
  spotify: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#1DB954"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 1 1-.277-1.218c3.808-.87 7.076-.496 9.712 1.118a.625.625 0 0 1 .207.857zm1.224-2.719a.78.78 0 0 1-1.073.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.453-1.493c3.632-1.102 8.147-.568 11.234 1.329a.78.78 0 0 1 .257 1.073zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.936.936 0 1 1-.543-1.791c3.528-1.071 9.398-.865 13.18 1.381a.936.936 0 0 1-1.02 1.57z"/></svg>`,
  github: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#ffffff"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
  reddit: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#FF4500"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.56 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.197-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>`,
  wikipedia: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#ffffff"><path d="M12.09 13.12 9.68 6.42H7.4L3.06 17.58h2.09l1.1-2.92h4.52l1.08 2.92h2.24zm-4.99-.04 1.72-4.57 1.69 4.57zm13.84 4.5h-2.1l-2.45-6.6-2.42 6.6h-2.12l3.49-8.94-1.42-3.82h2.15l1.37 3.84 1.39-3.84h2.14l-1.45 3.86z"/></svg>`,
  pinterest: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#E60023"><path d="M12 0a12 12 0 0 0-4.37 23.18c-.05-.98-.1-2.5.02-3.58l.74-3.15s-.19-.38-.19-.94c0-.88.51-1.54 1.15-1.54.54 0 .8.41.8.9 0 .55-.35 1.37-.53 2.13-.15.64.32 1.16.95 1.16 1.14 0 2.02-1.2 2.02-2.94 0-1.54-1.1-2.61-2.68-2.61-1.83 0-2.9 1.37-2.9 2.78 0 .55.21 1.14.48 1.46.05.06.06.12.04.18l-.18.73c-.03.11-.1.15-.22.1-1-.46-1.62-1.92-1.62-3.1 0-2.52 1.83-4.84 5.28-4.84 2.77 0 4.93 1.98 4.93 4.62 0 2.76-1.74 4.98-4.15 4.98-.81 0-1.57-.42-1.83-.92l-.5 1.9c-.18.7-.67 1.57-1 2.1A12 12 0 1 0 12 0z"/></svg>`,
  linkedin: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="#0A66C2"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/></svg>`,
  image: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  video: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  web: `<svg class="chat-media-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"/></svg>`
};

export function getDomainPlatform(urlStr) {
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : ('https://' + urlStr));
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    if (h.includes('youtube.com') || h === 'youtu.be') return 'youtube';
    if (h.includes('tiktok.com')) return 'tiktok';
    if (h.includes('instagram.com') || h === 'instagr.am') return 'instagram';
    if (h.includes('facebook.com') || h === 'fb.watch' || h === 'fb.com') return 'facebook';
    if (h === 'x.com' || h.includes('twitter.com')) return 'x';
    if (h === 't.me' || h.includes('telegram.me') || h.includes('telegram.org')) return 'telegram';
    if (h.includes('spotify.com')) return 'spotify';
    if (h.includes('github.com')) return 'github';
    if (h.includes('reddit.com') || h === 'redd.it') return 'reddit';
    if (h.includes('wikipedia.org')) return 'wikipedia';
    if (h.includes('pinterest.com') || h === 'pin.it') return 'pinterest';
    if (h.includes('linkedin.com')) return 'linkedin';
    return 'web';
  } catch (_) {
    return 'web';
  }
}

export function renderMediaCard({ type = 'youtube', videoId = '', canonicalUrl = '', displayUrl = '', isShorts = false, badgeHtml = '', standalone = false, meta = {} }) {
  const vId = esc(videoId);
  const cUrl = esc(canonicalUrl);
  const dUrl = esc(displayUrl || canonicalUrl);
  const shortsCls = isShorts ? ' is-shorts' : '';
  const standaloneCls = standalone ? ' chat-yt-standalone' : '';

  let domain = '';
  try {
    const u = new URL(canonicalUrl.startsWith('http') ? canonicalUrl : ('https://' + canonicalUrl));
    domain = u.hostname.replace(/^www\./, '');
  } catch (_) {
    domain = canonicalUrl;
  }

  const platform = (type && type !== 'web') ? type : getDomainPlatform(canonicalUrl);
  const logoSvg = (platform !== 'web' && PLATFORM_LOGOS[platform])
    ? PLATFORM_LOGOS[platform]
    : `<img class="chat-media-icon chat-media-favicon" src="https://www.google.com/s2/favicons?domain=${esc(domain)}&sz=32" alt="" loading="lazy" onerror="this.outerHTML='${esc(PLATFORM_LOGOS.web)}'">`;

  let badgeText = '';
  if (isShorts) badgeText = 'Shorts';
  else if (type === 'tiktok') badgeText = 'TikTok';
  else if (type === 'instagram') badgeText = meta.subType === 'p' ? 'Post' : 'Reel';
  else if (type === 'facebook') badgeText = 'Facebook';
  else if (type === 'image') badgeText = 'Rasm';
  else if (type === 'video') badgeText = 'Video';
  const badgeDom = badgeText ? `<span class="chat-yt-shorts-badge">${badgeText}</span>` : '';

  let boxContent = '';
  if (type === 'image') {
    boxContent = `<img class="chat-media-thumb" src="${cUrl}" alt="Rasm" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'chat-media-broken\\'>Rasm yuklanmadi</div>'">${badgeDom}${badgeHtml}`;
  } else if (type === 'video') {
    boxContent = `<video class="chat-media-video" src="${cUrl}" preload="metadata" playsinline muted></video>` +
      `<button type="button" class="chat-media-play-btn" aria-label="Ijro etish">` +
        `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,.6)"/><path d="M19 15.5v17l14-8.5z" fill="#fff"/></svg>` +
      `</button>` +
      badgeDom + (badgeHtml || '');
  } else if (type === 'youtube') {
    boxContent = `<img class="chat-yt-thumb" src="https://i.ytimg.com/vi/${vId}/hqdefault.jpg" alt="YouTube video" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${vId}/0.jpg'">` +
      `<button type="button" class="chat-media-play-btn" aria-label="Ijro etish">` +
        `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,.6)"/><path d="M19 15.5v17l14-8.5z" fill="#fff"/></svg>` +
      `</button>` +
      badgeDom + (badgeHtml || '');
  } else if (type === 'tiktok') {
    boxContent = `<div class="chat-media-placeholder chat-media-tt-ph"><div class="chat-media-ph-bg"></div>${logoSvg}</div>` +
      `<button type="button" class="chat-media-play-btn" aria-label="Ijro etish">` +
        `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,.6)"/><path d="M19 15.5v17l14-8.5z" fill="#fff"/></svg>` +
      `</button>` +
      badgeDom + (badgeHtml || '');
  } else if (type === 'instagram') {
    boxContent = `<div class="chat-media-placeholder chat-media-ig-ph"><div class="chat-media-ph-bg"></div>${logoSvg}</div>` +
      `<button type="button" class="chat-media-play-btn" aria-label="Ijro etish">` +
        `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,.6)"/><path d="M19 15.5v17l14-8.5z" fill="#fff"/></svg>` +
      `</button>` +
      badgeDom + (badgeHtml || '');
  } else if (type === 'facebook') {
    boxContent = `<div class="chat-media-placeholder chat-media-fb-ph"><div class="chat-media-ph-bg"></div>${logoSvg}</div>` +
      `<button type="button" class="chat-media-play-btn" aria-label="Ijro etish">` +
        `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,.6)"/><path d="M19 15.5v17l14-8.5z" fill="#fff"/></svg>` +
      `</button>` +
      badgeDom + (badgeHtml || '');
  } else {
    // Har qanday veb-havola (butun dunyo bo'ylab)
    boxContent = `<div class="chat-link-box" data-preview-url="${cUrl}">` +
      `<div class="chat-link-thumb-wrap" style="display:none;"><img class="chat-media-thumb chat-link-thumb" alt="" loading="lazy"></div>` +
      `<div class="chat-link-info">` +
        `<div class="chat-link-site">${esc(domain)}</div>` +
        `<div class="chat-link-title">${esc(domain)}</div>` +
        `<div class="chat-link-desc" style="display:none;"></div>` +
      `</div>` +
    `</div>` +
    (badgeHtml || '');
  }

  const metaJson = esc(JSON.stringify(meta || {}));
  const dataAttrs = `data-media-type="${esc(type)}" data-video-id="${vId}" data-url="${cUrl}" data-shorts="${isShorts ? '1' : '0'}" data-meta="${metaJson}"`;

  return `<div class="chat-yt-card${shortsCls}${standaloneCls} is-media-${type}" data-media-type="${esc(type)}">` +
    `<div class="chat-yt-header" onclick="window._copyChatYtSource&&window._copyChatYtSource(this, '${cUrl}')" title="Haqiqiy media havolasidan nusxa olish">` +
      logoSvg +
      `<span class="chat-yt-url">${dUrl}</span>` +
      `<span class="chat-yt-copy-badge">` +
        `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
        `<span class="chat-yt-copy-text">Nusxa</span>` +
      `</span>` +
    `</div>` +
    `<div class="chat-yt-box chat-media-box" ${dataAttrs} onclick="window._chatPlayMedia&&window._chatPlayMedia(this)">` +
      boxContent +
    `</div>` +
  `</div>`;
}

export function renderYouTubeCard(opts) {
  return renderMediaCard({ type: 'youtube', ...opts });
}

export function parsePureMedia(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;

  // 1) YouTube iframe
  YT_IFRAME_RE.lastIndex = 0;
  const iframes = [...t.matchAll(YT_IFRAME_RE)];
  if (iframes.length === 1) {
    YT_IFRAME_RE.lastIndex = 0;
    if (!t.replace(YT_IFRAME_RE, '').trim()) {
      const vid = iframes[0][1];
      const canUrl = `https://www.youtube.com/watch?v=${vid}`;
      return { type: 'youtube', videoId: vid, canonicalUrl: canUrl, displayUrl: canUrl, isShorts: false };
    }
  }

  // 2) YouTube URL
  YT_URL_RE.lastIndex = 0;
  const ytUrls = [...t.matchAll(YT_URL_RE)];
  if (ytUrls.length === 1) {
    YT_URL_RE.lastIndex = 0;
    if (!t.replace(YT_URL_RE, '').trim()) {
      const um = ytUrls[0];
      const vid = um[1];
      const matchStr = um[0];
      const isShorts = matchStr.includes('/shorts/');
      const canUrl = isShorts ? `https://www.youtube.com/shorts/${vid}` : `https://www.youtube.com/watch?v=${vid}`;
      const dispUrl = matchStr.startsWith('http') ? matchStr : ('https://' + matchStr);
      return { type: 'youtube', videoId: vid, canonicalUrl: canUrl, displayUrl: dispUrl, isShorts };
    }
  }

  // 3) Instagram
  IG_RE.lastIndex = 0;
  const igUrls = [...t.matchAll(IG_RE)];
  if (igUrls.length === 1) {
    IG_RE.lastIndex = 0;
    if (!t.replace(IG_RE, '').trim()) {
      const m = igUrls[0];
      const subType = m[1];
      const id = m[2];
      const canUrl = `https://www.instagram.com/${subType}/${id}/`;
      return { type: 'instagram', videoId: id, canonicalUrl: canUrl, displayUrl: canUrl, isShorts: subType === 'reel', meta: { subType } };
    }
  }

  // 4) TikTok
  TT_RE.lastIndex = 0;
  const ttUrls = [...t.matchAll(TT_RE)];
  if (ttUrls.length === 1) {
    TT_RE.lastIndex = 0;
    if (!t.replace(TT_RE, '').trim()) {
      const m = ttUrls[0];
      const id = m[1] || m[2] || m[3];
      const canUrl = m[0].startsWith('http') ? m[0] : ('https://' + m[0]);
      return { type: 'tiktok', videoId: id, canonicalUrl: canUrl, displayUrl: canUrl, isShorts: true };
    }
  }

  // 5) Facebook
  FB_RE.lastIndex = 0;
  const fbUrls = [...t.matchAll(FB_RE)];
  if (fbUrls.length === 1) {
    FB_RE.lastIndex = 0;
    if (!t.replace(FB_RE, '').trim()) {
      const m = fbUrls[0];
      const id = m[1] || m[2] || m[3] || m[4];
      const canUrl = m[0].startsWith('http') ? m[0] : ('https://' + m[0]);
      const isShorts = canUrl.includes('/reel/');
      return { type: 'facebook', videoId: id, canonicalUrl: canUrl, displayUrl: canUrl, isShorts };
    }
  }

  // 6) Direct Video
  VID_RE.lastIndex = 0;
  const vidUrls = [...t.matchAll(VID_RE)];
  if (vidUrls.length === 1) {
    VID_RE.lastIndex = 0;
    if (!t.replace(VID_RE, '').trim()) {
      const url = vidUrls[0][0];
      return { type: 'video', videoId: '', canonicalUrl: url, displayUrl: url, isShorts: false };
    }
  }

  // 7) Direct Image
  IMG_RE.lastIndex = 0;
  const imgUrls = [...t.matchAll(IMG_RE)];
  if (imgUrls.length === 1) {
    IMG_RE.lastIndex = 0;
    if (!t.replace(IMG_RE, '').trim()) {
      const url = imgUrls[0][0];
      return { type: 'image', videoId: '', canonicalUrl: url, displayUrl: url, isShorts: false };
    }
  }

  // 8) Butun dunyo bo'ylab har qanday veb-havola (generic web link)
  const GEN_URL_RE = /^https?:\/\/[^\s<"'\`)]+$/i;
  if (GEN_URL_RE.test(t)) {
    return { type: 'web', videoId: '', canonicalUrl: t, displayUrl: t, isShorts: false, meta: {} };
  }

  return null;
}

export const parsePureYouTube = parsePureMedia;

export function renderMarkdown(rawText, opts) {
  if (!rawText) return '';
  bindSpoilerUI();
  opts = opts || {};
  const msgId = opts.messageId || opts.msgId || null;
  const scope = opts.scope || 'dm';
  const _spHold = [];
  const _ytHold = [];

  // YouTube iframelari va havolalarini ajratib olamiz (matn ichida bo'lsa ham)
  let s = protectSecrets(String(rawText)).replace(YT_IFRAME_RE, (_m, vid) => {
    const isShorts = false;
    const canUrl = `https://www.youtube.com/watch?v=${vid}`;
    const cardHtml = renderYouTubeCard({ videoId: vid, canonicalUrl: canUrl, displayUrl: canUrl, isShorts });
    const idx = _ytHold.push(cardHtml) - 1;
    return '\n\u0000YT' + idx + '\u0000\n';
  });
  s = s.replace(YT_URL_RE, (match, vid) => {
    const isShorts = match.includes('/shorts/');
    const canUrl = isShorts ? `https://www.youtube.com/shorts/${vid}` : `https://www.youtube.com/watch?v=${vid}`;
    const dispUrl = match.startsWith('http') ? match : ('https://' + match);
    const cardHtml = renderYouTubeCard({ videoId: vid, canonicalUrl: canUrl, displayUrl: dispUrl, isShorts });
    const idx = _ytHold.push(cardHtml) - 1;
    return '\n\u0000YT' + idx + '\u0000\n';
  });

  // Instagram havolalari
  s = s.replace(IG_RE, (match, subType, id) => {
    const canUrl = `https://www.instagram.com/${subType}/${id}/`;
    const cardHtml = renderMediaCard({ type: 'instagram', videoId: id, canonicalUrl: canUrl, displayUrl: canUrl, isShorts: subType === 'reel', meta: { subType } });
    const idx = _ytHold.push(cardHtml) - 1;
    return '\n\u0000YT' + idx + '\u0000\n';
  });

  // TikTok havolalari
  s = s.replace(TT_RE, (match, v1, v2, v3) => {
    const id = v1 || v2 || v3 || '';
    const canUrl = match.startsWith('http') ? match : ('https://' + match);
    const cardHtml = renderMediaCard({ type: 'tiktok', videoId: id, canonicalUrl: canUrl, displayUrl: canUrl, isShorts: true });
    const idx = _ytHold.push(cardHtml) - 1;
    return '\n\u0000YT' + idx + '\u0000\n';
  });

  // Facebook havolalari
  s = s.replace(FB_RE, (match, v1, v2, v3, v4) => {
    const id = v1 || v2 || v3 || v4 || '';
    const canUrl = match.startsWith('http') ? match : ('https://' + match);
    const isShorts = canUrl.includes('/reel/');
    const cardHtml = renderMediaCard({ type: 'facebook', videoId: id, canonicalUrl: canUrl, displayUrl: canUrl, isShorts });
    const idx = _ytHold.push(cardHtml) - 1;
    return '\n\u0000YT' + idx + '\u0000\n';
  });

  // Direct Video havolalari
  s = s.replace(VID_RE, (match) => {
    const cardHtml = renderMediaCard({ type: 'video', canonicalUrl: match, displayUrl: match, isShorts: false });
    const idx = _ytHold.push(cardHtml) - 1;
    return '\n\u0000YT' + idx + '\u0000\n';
  });

  // Direct Image havolalari
  s = s.replace(IMG_RE, (match) => {
    const cardHtml = renderMediaCard({ type: 'image', canonicalUrl: match, displayUrl: match, isShorts: false });
    const idx = _ytHold.push(cardHtml) - 1;
    return '\n\u0000YT' + idx + '\u0000\n';
  });

  // Display-time shield: DB dagi eski ochiq kalitlar ham ||spoiler|| ga aylanadi (DOM ga tushmasdan vault)
  s = s.replace(/\|\|@(\d+):([\d,]+)\|\|/g, (_m, ord, lenSpec) => {
    const idx = _spHold.push(spoilerPlaceholder('', {
      msgId: msgId, ord: parseInt(ord, 10), ch: (String(lenSpec).split(',').reduce((a,b)=>a+(parseInt(b,10)||0),0)), lineCh: String(lenSpec).split(',').map(x=>parseInt(x,10)||2), scope: scope
    })) - 1;
    return '\u0000SP' + idx + '\u0000';
  });
  s = s.replace(/\|\|([\s\S]*?)\|\|/g, (_m, inner) => {
    if (inner.charAt(0) === '@') return _m;
    const idx = _spHold.push(spoilerPlaceholder(inner)) - 1;
    return '\u0000SP' + idx + '\u0000';
  });
  s = esc(s);
  s = s.replace(/\u0000SP(\d+)\u0000/g, (_m, i) => _spHold[parseInt(i, 10)] || '');
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

  /* spoilers already vaulted above */

  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+?)(?:\s+"[^"]*")?\)/g,
    '<a href="$2" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>');

  const htmlTags = [];
  s = s.replace(/<[^>]+>/g, m => {
    const idx = htmlTags.push(m) - 1;
    return '\u0000TG' + idx + '\u0000';
  });

  // \u0000 (placeholder) va qo'shtirnoqlarda to'xtaydi — aks holda tayyor <a> tegi href ichiga tushib, atribut in'ektsiyasi bo'ladi
  s = s.replace(/(https?:\/\/[^\s<\u0000"']+)/g, (match) => {
    const cardHtml = renderMediaCard({ type: 'web', canonicalUrl: match, displayUrl: match, isShorts: false });
    const idx = _ytHold.push(cardHtml) - 1;
    return '\n\u0000YT' + idx + '\u0000\n';
  });

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
      if (row.match(/^\|?[ \t:-]+\|[ \t:\-|]+$/)) return;
      const tag = (i === 0 && rows.length > 1 && rows[1].match(/^\|?[ \t:-]+\|[ \t:\-|]+$/)) ? 'th' : 'td';
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
  s = s.replace(/(?:<br>)*\u0000YT(\d+)\u0000(?:<br>)*/g, (_m, idx) => _ytHold[parseInt(idx, 10)] || '');
  s = s.replace(/\u0000YT(\d+)\u0000/g, (_m, idx) => _ytHold[parseInt(idx, 10)] || '');

  // Kenglikni keyingi frame da aniq o'lchaymiz (post/chat/izoh)
  try { requestAnimationFrame(() => layoutSpoilers(document)); } catch (_) {}
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

function _zClose(fromPop) {
  const zm = $('zoomModal');
  if (!zm) return;
  const wasOpen = zm.classList.contains('show');
  zm.classList.remove('show');
  _zReset();
  const im = $('zoomImg');
  if (im) { im.src = ''; im.style.display = 'none'; }
  /* Zoom ochilganda tarixga 1 ta yozuv qo'shilgan (openZoom) — tugma/Esc/fon bilan
   * yopilganda o'sha yozuvni olib tashlaymiz. Telefondagi "orqaga" bosilsa (fromPop)
   * brauzer o'zi allaqachon 1 qadam orqaga qaytgan — qayta back() qilmaymiz. */
  if (wasOpen && !fromPop && history.state && history.state.zoom) {
    _zSkipPop();
    try { history.back(); } catch (_) {}
  }
}

/* url-router ning popstate'i zoom bilan bog'liq popstate'ni sahifa almashtirish deb o'ylamasin */
function _zSkipPop() {
  window.__zoomSkipPop = true;
  setTimeout(() => { window.__zoomSkipPop = false; }, 600);
}

/* Telefondagi/brauzerdagi "orqaga": zoom ochiq bo'lsa — faqat zoom yopiladi, sahifa emas */
window.addEventListener('popstate', () => {
  const zm = document.getElementById('zoomModal');
  if (zm && zm.classList.contains('show') && !(history.state && history.state.zoom)) {
    _zSkipPop();
    _zClose(true);
  }
}, true);

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
    im.style.borderRadius = '8px';
    im.style.width = '';
    im.style.height = '';
    im.style.objectFit = 'contain';
    im.style.maxWidth = 'min(90vw, calc(100vw - 48px))';
    im.style.maxHeight = 'min(86dvh, calc(100dvh - 56px))';
  } else {
    location.assign(url);
    return;
  }
  im.style.transform = 'translate(0,0) scale(1)';
  im.style.transformOrigin = 'center center';
  im.style.transition = 'none';
  const wasShown = zm.classList.contains('show');
  zm.classList.add('show');
  /* "Orqaga" tugmasi zoomni yopsin: tarixga bitta yozuv (URL o'zgarmaydi) */
  if (!wasShown && !(history.state && history.state.zoom)) {
    try { history.pushState({ ...(history.state || {}), zoom: 1 }, '', location.href); } catch (_) {}
  }
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

/* ── SpaceMR sekin smooth scroll (barcha auto-scroll uchun) ─────────────
   Brauzer native smooth (~300ms) juda tez — bu yerda ~750ms ease-in-out. */
export const SMOOTH_MS = 750;

function _easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Scrollable konteynerda `top` ga sekin silliq scroll */
export function smoothScrollContainer(box, top, duration = SMOOTH_MS) {
  if (!box) return Promise.resolve();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const target = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight));
  if (reduced || duration <= 0) {
    box.scrollTop = target;
    return Promise.resolve();
  }
  const start = box.scrollTop;
  const delta = target - start;
  if (Math.abs(delta) < 1) return Promise.resolve();
  // native smooth ni bekor qilish uchun vaqt belgisi
  box._smoothUntil = Date.now() + duration + 80;
  const t0 = performance.now();
  return new Promise(resolve => {
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      box.scrollTop = start + delta * _easeInOutCubic(p);
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Elementni viewport yoki eng yaqin scroll ota ichida markazga sekin olib kelish */
export function smoothScrollIntoView(el, { block = 'center', duration = SMOOTH_MS } = {}) {
  if (!el || !el.isConnected) return Promise.resolve();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || duration <= 0) {
    try { el.scrollIntoView({ block, behavior: 'auto' }); } catch (_) {}
    return Promise.resolve();
  }
  // Scroll ota: overflow auto/scroll bo'lgan eng yaqin ota (yoki window)
  let box = el.parentElement;
  while (box && box !== document.body && box !== document.documentElement) {
    const st = getComputedStyle(box);
    const oy = st.overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && box.scrollHeight > box.clientHeight + 2) break;
    box = box.parentElement;
  }
  if (!box || box === document.body || box === document.documentElement) {
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    let deltaY = 0;
    if (block === 'center') deltaY = rect.top + rect.height / 2 - vh / 2;
    else if (block === 'start') deltaY = rect.top - 12;
    else if (block === 'end') deltaY = rect.bottom - vh + 12;
    else deltaY = rect.top + rect.height / 2 - vh / 2;
    const start = window.scrollY || document.documentElement.scrollTop || 0;
    const target = start + deltaY;
    const t0 = performance.now();
    return new Promise(resolve => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        window.scrollTo(0, start + (target - start) * _easeInOutCubic(p));
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }
  const er = el.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  let nextTop = box.scrollTop;
  if (block === 'center') nextTop += (er.top - br.top) - (box.clientHeight - er.height) / 2;
  else if (block === 'start') nextTop += (er.top - br.top) - 12;
  else if (block === 'end') nextTop += (er.bottom - br.bottom) + 12;
  else nextTop += (er.top - br.top) - (box.clientHeight - er.height) / 2;
  return smoothScrollContainer(box, nextTop, duration);
}

/**
 * Faqat ||spoiler|| belgisini qo'llaydigan yengil render (bio kabi joylar uchun).
 * Matn avval esc() dan o'tadi, shuning uchun HTML in'ektsiya imkoni yo'q.
 */
export function renderSpoilers(rawText) {
  if (!rawText) return '';
  bindSpoilerUI();
  const hold = [];
  let s = String(rawText).replace(/\|\|([\s\S]*?)\|\|/g, (_m, inner) => {
    const idx = hold.push(spoilerPlaceholder(inner)) - 1;
    return '\u0000SP' + idx + '\u0000';
  });
  s = esc(s);
  return s.replace(/\u0000SP(\d+)\u0000/g, (_m, i) => hold[parseInt(i, 10)] || '');
}

/**
 * Clipboard uchun: ||@ord:ch|| markerlarini vault dagi ochilgan matnga almashtiradi.
 * Ochilmagan spoiler bo'lsa •••• qoldiriladi (xavfsizlik).
 * opts: { msgId, scope } — server markerlari uchun.
 */
export function resolveSpoilerMarkers(rawText, opts) {
  opts = opts || {};
  const msgId = opts.msgId != null ? String(opts.msgId) : '';
  const scope = opts.scope || 'dm';
  let s = String(rawText || '');
  // Server marker: ||@0:45,12||
  s = s.replace(/\|\|@(\d+):([\d,]+)\|\|/g, (_m, ord) => {
    const keys = [
      'rpc:' + scope + ':' + msgId + ':' + ord,
      'rpc:dm:' + msgId + ':' + ord,
      'rpc:group:' + msgId + ':' + ord
    ];
    for (const k of keys) {
      const t = _spoilerVault.get(k);
      if (t != null) return String(t);
    }
    // data-sid yo'q, lekin DOM da revealed bo'lishi mumkin — caller to'ldiradi
    return '\u2022\u2022\u2022\u2022';
  });
  // Klassik ||matn|| (vault sid yo'q — ichidagi matn)
  s = s.replace(/\|\|([\s\S]*?)\|\|/g, (_m, inner) => {
    if (inner.charAt(0) === '@') return _m; // qolgan marker
    return inner;
  });
  return s;
}

/**
 * Markdown/spoiler belgilarini olib tashlab, oddiy matn qaytaradi (clipboard uchun).
 * renderMarkdown() qo'llab-quvvatlagan sintaksis bilan bir xil: ||spoiler||, **qalin**, *kursiv*,
 * ~~chizilgan~~, `kod`, ```blok```, # sarlavha, > iqtibos, ro'yxat, [matn](url), jadval.
 * Kod ichidagi belgilar o'zgartirilmaydi.
 */
export function markdownToPlain(rawText, opts) {
  if (!rawText) return '';
  // Spoiler markerlarini vault dan ochamiz (||@0:45,12|| -> asl matn)
  let s = resolveSpoilerMarkers(String(rawText), opts).replace(/\r\n?/g, '\n');
  const keep = [];
  const hold = t => '\u0000K' + (keep.push(t) - 1) + '\u0000';

  s = s.replace(/```[a-z0-9]*\n([\s\S]*?)```/gi, (_m, code) => hold(code.trim()));
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => hold(code));

  s = s.replace(/\|\|([\s\S]*?)\|\|/g, '$1');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+?)(?:\s+"[^"]*")?\)/g, '$1 ($2)');

  s = s.replace(/(?:^[ \t]*\|.*\|[ \t]*\n)+^[ \t]*\|.*\|[ \t]*/gm, match =>
    match.trim().split('\n')
      .filter(r => !/^\|?[ \t:-]+\|[ \t:\-|]+$/.test(r))
      .map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).join('\t'))
      .join('\n'));

  s = s.replace(/^[ \t]*#{1,3}\s+(.+)$/gm, '$1');
  s = s.replace(/^[ \t]*>\s?(.+)$/gm, '$1');
  s = s.replace(/^([ \t]*)[-*]\s+\[([ xX])\]\s+(.+)$/gm, (_m, ind, c, t) => ind + (c === ' ' ? '\u2610 ' : '\u2611 ') + t);
  s = s.replace(/^([ \t]*)[-*]\s+(.+)$/gm, '$1\u2022 $2');

  s = s.replace(/~~([^~\n]+)~~/g, '$1');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  s = s.replace(/__([^_\n]+)__/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1$2');

  s = s.replace(/\u0000K(\d+)\u0000/g, (_m, i) => keep[parseInt(i, 10)]);
  return s.trim();
}
