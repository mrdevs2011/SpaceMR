/* dissolve.js — MRdrive'dagi "qum bo'lib sochilib ketish" (Telegram disintegration) animatsiyasi.
   Manba: mrdrive-main/app.js (playDeleteDissolve) — fizika/konstantalar 1:1 ko'chirilgan.
   Farq: faqat .chat-msg uchun snapshot'da karta bezaklari (fon/border/tugma yashirish) qo'llanmaydi.
   Ishlatish: markDissolve(ids) — o'chirishdan OLDIN; chat.js paintMessages() o'zi qolganini bajaradi. */

/** Shu ID'lar keyingi chizishda yo'qolsa — sochilib ketadi (xabar o'chirilganda belgilanadi). */
export const dissolveMarks = new Set();
export function markDissolve(ids) { (ids || []).forEach(id => id && dissolveMarks.add(String(id))); }
export function unmarkDissolve(ids) { (ids || []).forEach(id => dissolveMarks.delete(String(id))); }

/* ============================================================
   Telegram message-disintegration — robust 1:1 of demo.html
   - Fully inlined computed styles (no fetch dependency)
   - Guaranteed visual effect (never snaps away)
   ============================================================ */
const ANIM_DURATION  = 1300;   // zarra umri (Telegram: ~1.3s, yengil chang)
const SWEEP_DURATION = 520;    // chapdan o'ngga uzilish to'lqini
const COLLAPSE_DELAY = 480;    // qator chang uchib bo'lgach yopiladi
const FADE_IN_MS     = 60;     // tez crossfade
const TILE_SIZE      = 1.5;    // biroz yirikroq = FPS yuqori, silliq
const DRIFT_X        = 42;     // tor sochilish — chalkashlik yo'q
const PUFF_Y         = 6;      // yumshoq nafas
const GRAVITY        = 0.00115;// pastga silliq tushish
const START_SPEED    = 0.012;  // boshlang'ich tezlik
const NOISE_AMP      = 0;
/* Telegram uslubidagi "chang": zarralar chapdan o'ngga to'lqin bo'lib uziladi, shamol bilan o'ng-yuqoriga suzib, so'nadi */
const DUST_DRIFT_X = 120;   // o'ngga siljish (css px)
const DUST_LIFT_Y  = 64;    // yuqoriga ko'tarilish (css px)
const DUST_TAU     = 460;   // "puff" vaqti (ms): boshida tez, keyin sekinlashadi
const DUST_GLIDE   = 0.018; // davom etuvchi sekin suzish (css px / ms)
const PAD_L = 40, PAD_R = 260, PAD_TOP = 170, PAD_BOTTOM = 50;   // canvas atrofidagi bo'sh joy (css px)

function __dissolveHash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function __dissolveNoise1D(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return __dissolveHash(i) * (1 - u) + __dissolveHash(i + 1) * u;
}

/** Inline every visual computed style so SVG foreignObject needs no external CSS. */
function __dissolveInlineAllStyles(src, dest) {
  const s = window.getComputedStyle(src);
  // Copy the important visual props (full cssText of computed is not assignable)
  const props = [
    "box-sizing","display","position","width","height","min-width","min-height","max-width","max-height",
    "margin","margin-top","margin-right","margin-bottom","margin-left",
    "padding","padding-top","padding-right","padding-bottom","padding-left",
    "border","border-radius","border-top","border-right","border-bottom","border-left",
    "border-width","border-style","border-color",
    "background","background-color","background-image","box-shadow",
    "color","font-family","font-size","font-weight","font-style","line-height","letter-spacing",
    "text-align","text-decoration","text-overflow","white-space","word-break","overflow","overflow-x","overflow-y",
    "opacity","visibility","flex","flex-direction","flex-wrap","align-items","justify-content","align-self","gap",
    "grid-template-columns","grid-template-rows","object-fit","vertical-align","cursor"
  ];
  for (const p of props) {
    try {
      const v = s.getPropertyValue(p);
      if (v) dest.style.setProperty(p, v);
    } catch (_) {}
  }
  // Kill interactive chrome in the snapshot
  if (dest.classList && (dest.classList.contains("file-actions") || dest.classList.contains("file-actions-more"))) {
    // visibility (not display) so the snapshot keeps the exact live layout
    dest.style.setProperty("visibility", "hidden");
  }
  const srcChildren = src.children;
  const destChildren = dest.children;
  for (let i = 0; i < srcChildren.length; i++) {
    if (destChildren[i]) __dissolveInlineAllStyles(srcChildren[i], destChildren[i]);
  }
}

/** DOM → canvas via SVG foreignObject (demo.html approach, self-contained styles). */
function __dissolveDomToCanvas(el, dprOverride) {
  return new Promise((resolve, reject) => {
    const rect = el.getBoundingClientRect();
    const w = Math.ceil(rect.width);
    const h = Math.ceil(rect.height);
    if (w < 2 || h < 2) {
      reject(new Error("card too small"));
      return;
    }

    const plain = el.classList.contains("chat-msg");   // MRspace xabari: o'z fon/border'i bor, karta bezaklari kerak emas
    const clone = el.cloneNode(true);
    clone.classList.remove("actions-open");
    clone.style.margin = "0";
    clone.style.transform = "none";
    clone.style.width = w + "px";
    clone.style.height = h + "px";
    __dissolveInlineAllStyles(el, clone);

    // Hide actions + type icons in snapshot (same clean bubble as download-icon;
    // external PNGs / complex SVG would break foreignObject → blank → no sand)
    // File cards: hide actions. Folder tabs: only hide the X, keep the name label.
    if (plain) {
      /* xabar pufagi o'z rangida qoladi */
    } else if (clone.classList.contains("folder-tab-wrap")) {
      clone.querySelectorAll(".folder-del-btn").forEach((b) => { b.style.setProperty("visibility", "hidden"); });
    } else {
      // Hide with visibility (NOT display:none): the card is usually still hovered
      // when Delete is clicked (no confirm dialog), so its layout has the action
      // buttons expanded. display:none re-flowed the text and the card "jumped".
      clone.querySelectorAll(".file-actions, .file-actions-more, button, .file-type-icon, .folder-icon").forEach((b) => {
        b.style.setProperty("visibility", "hidden");
      });
    }
    // Solid fallbacks so snapshot never depends on CSS variables (theme-aware)
    if (!plain) {
    var dark = document.documentElement.getAttribute("data-theme") === "dark"
      || document.documentElement.classList.contains("theme-dark");
    if (!clone.style.background || clone.style.background.includes("var(")) {
      clone.style.background = dark ? "#16181c" : "#e7e9ea";
    }
    if (!clone.style.color || clone.style.color.includes("var(")) {
      clone.style.color = dark ? "#e7e9ea" : "#16181c";
    }
    clone.style.border = dark ? "1px solid #202327" : "1px solid #e7e9ea";
    clone.style.borderRadius = clone.classList.contains("folder-tab-wrap") ? "8px" : "12px";
    }

    const markup =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<foreignObject width="100%" height="100%" x="0" y="0">` +
          `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;margin:0;padding:0;box-sizing:border-box;">` +
            new XMLSerializer().serializeToString(clone) +
          `</div>` +
        `</foreignObject>` +
      `</svg>`;

    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    const img = new Image();
    img.onload = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Sanity: if almost fully transparent, treat as failure
      try {
        // Butun rasm bo'yicha (burchak shaffof bo'lishi mumkin: o'ngdagi xabar, yumaloq pufak, emoji) — 2 ta rangli piksel topilsa yetadi
        const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = 0;
        for (let i = 3; i < sample.length && opaque < 2; i += 4) if (sample[i] > 10) opaque++;
        if (opaque < 2) {
          reject(new Error("blank snapshot"));
          return;
        }
      } catch (_) {}
      resolve({ canvas, width: w, height: h, rect, dpr });
    };
    img.onerror = () => reject(new Error("svg image load failed"));
    img.src = url;
  });
}

const MAX_GRAINS = 12000; // chat: past FPS emas, silliq qum

/** Typed-array grains: one grain per (G x G) device pixels, colour = packed RGBA of that pixel. */
/** Info for a multi-card delete: ONE wave sweeping from the top-most card down through all of them. */
export function dissolveGroupInfo(cards) {
  const list = (cards || []).filter((c) => c && c.isConnected);
  if (list.length < 2) return null;
  let top = Infinity, bottom = -Infinity;
  for (const c of list) {
    const r = c.getBoundingClientRect();
    if (r.top < top) top = r.top;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  const span = Math.max(1, bottom - top);
  // Wave speed stays similar for long lists (longer span -> longer sweep), capped.
  const sweep = Math.min(3500, Math.max(SWEEP_DURATION, span * 3));
  return { top, span, sweep };
}

function __dissolveBuildGrains(snapCanvas, cssW, cssH, dpr, epX, epY, groupCtx, tabMode) {
  const W = snapCanvas.width, H = snapCanvas.height;
  const ctx = snapCanvas.getContext("2d", { willReadFrequently: true });
  const px32 = new Uint32Array(ctx.getImageData(0, 0, W, H).data.buffer);
  const G = Math.max(1, Math.ceil(Math.sqrt((W * H) / MAX_GRAINS)));
  const cap = Math.ceil(W / G) * Math.ceil(H / G);
  const x = new Float32Array(cap), y = new Float32Array(cap), vx = new Float32Array(cap);
  const g = new Float32Array(cap), delay = new Float32Array(cap), col = new Uint32Array(cap);
  const lift = new Float32Array(cap), ph = new Float32Array(cap);
  const maxDist = Math.hypot(cssW, cssH) || 1;
  let n = 0;
  for (let yy = 0; yy < H; yy += G) {
    const sy = Math.min(H - 1, yy + (G >> 1));
    const cy = yy / dpr;
    for (let xx = 0; xx < W; xx += G) {
      const c = px32[sy * W + Math.min(W - 1, xx + (G >> 1))];
      if ((c >>> 24) < 10) continue;
      const cx = xx / dpr;
      const dist = Math.hypot(cx - epX, cy - epY);
      x[n] = xx; y[n] = yy;
      // Wide, natural spread: bell-shaped random sideways speed + a push away
      // from the epicenter, so the cloud opens up like a puff of dust.
      const rx = cx / (cssW || 1);                         // 0 (chap) … 1 (o'ng)
      // Telegram "chang": asosan o'ngga (shamol), biroz yuqoriga; o'ng tomon uzoqroq uchadi, ba'zi zarra orqaga qaytadi
      vx[n] = tabMode ? (Math.random() + Math.random() - 1) * 0.25
            : (0.2 + Math.random() * 0.9 + rx * 0.3) * (Math.random() < 0.12 ? -0.4 : 1);
      lift[n] = tabMode ? 0.05 + Math.random() * 0.2 : 0.15 + Math.random() * 0.85;
      ph[n] = Math.random() * 6.2832;
      g[n] = tabMode ? 1.05 + Math.random() * 0.5 : 0.8 + Math.random() * 0.5;   // zarra umri koeffitsienti
      delay[n] = tabMode
        ? ((1 - cy / cssH) * 0.35) * SWEEP_DURATION * 0.5 + Math.random() * 120
        : groupCtx
        ? ((groupCtx.offsetY + cy) / groupCtx.span) * groupCtx.sweep + Math.random() * 80
        : (rx * 0.8 + (cy / cssH) * 0.2) * SWEEP_DURATION + Math.random() * 140;   // chapdan o'ngga to'lqin
      col[n] = c;
      n++;
    }
  }
  return { n, G, x, y, vx, g, delay, col, lift, ph };
}

function __dissolveBuildTiles(snapshotCanvas, cssWidth, cssHeight, dpr, epX, epY) {
  const ctx = snapshotCanvas.getContext("2d", { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, snapshotCanvas.width, snapshotCanvas.height).data;
  const tiles = [];
  const maxDist = Math.hypot(cssWidth, cssHeight) || 1;
  // Keep particle count reasonable on wide cards (still looks dense)
  // Very fine grains: start at TILE_SIZE and only coarsen as much as needed to
  // keep the grain count under MAX_GRAINS (keeps big cards smooth).
  const MAX_GRAINS = 24000;
  const tile = Math.max(TILE_SIZE, Math.sqrt((cssWidth * cssHeight) / MAX_GRAINS));

  for (let y = 0; y < cssHeight; y += tile) {
    for (let x = 0; x < cssWidth; x += tile) {
      const midX = Math.min(snapshotCanvas.width  - 1, Math.floor((x + tile * 0.5) * dpr));
      const midY = Math.min(snapshotCanvas.height - 1, Math.floor((y + tile * 0.5) * dpr));
      const a = data[(midY * snapshotCanvas.width + midX) * 4 + 3];
      if (a < 10) continue;

      const distToEp = Math.hypot(x - epX, y - epY) || 0.001;
      const seed = (x * 73856) ^ (y * 19349);
      const rnd = (k) => __dissolveHash(seed + k);
      // Grains break loose near the epicenter first, drift a little sideways,
      // then fall — real sand, not floating ash.
      const tSize = tile * (0.65 + rnd(8) * 0.7);
      const vx = (rnd(2) - 0.5) * 1.0;            // almost straight down
      const vy = 0;                                // no upward/floaty motion

      tiles.push({
        sx: x * dpr, sy: y * dpr,
        sw: Math.min(tile * dpr, snapshotCanvas.width  - x * dpr),
        sh: Math.min(tile * dpr, snapshotCanvas.height - y * dpr),
        x, y, tile: tSize, base: tile,
        vx,
        vy,
        rot: 0,
        rotV: 0,
        g: 0.8 + rnd(9) * 0.5,                    // each grain falls a bit differently
        // sand crumbles from the top down (mixed with distance from the tap)
        delay: ((y / cssHeight) * 0.7 + (distToEp / maxDist) * 0.3) * SWEEP_DURATION + rnd(6) * 500,
        fadeBias: 0.4 + rnd(7) * 0.45,
        seed,
      });
    }
  }
  return tiles;
}

/** Fallback when pixel snapshot fails: whole card falls down & fades (still not a snap). */
function __dissolveFloatFallback(card) {
  return new Promise((resolve) => {
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.remove("actions-open");
    ghost.style.cssText = [
      "position:fixed",
      `left:${rect.left}px`,
      `top:${rect.top}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      "margin:0",
      "z-index:9998",
      "pointer-events:none",
      "box-sizing:border-box",
      "transition:transform .45s cubic-bezier(.4,0,.2,1), opacity .45s ease-in",
      "transform:translateY(0)",
      "opacity:1"
    ].join(";");
    document.body.appendChild(ghost);
    card.style.visibility = "hidden";
    requestAnimationFrame(() => {
      ghost.style.transform = "translateY(" + Math.max(160, window.innerHeight - rect.top) + "px)";
      ghost.style.opacity = "0";
    });
    setTimeout(() => {
      ghost.remove();
      resolve();
    }, 480);
  });
}

/**
 * Full disintegrate — demo.html physics.
 * Always produces a visible effect; never snaps the card away.
 */
export async function playDeleteDissolve(card, clickX, clickY, group) {
  if (!card || !card.isConnected) return;

  const tabMode = card.classList.contains("folder-tab-wrap");

  // Animatsiyani to'xtatib, o'lchamni qotirib qo'yamiz — width "tik" kichraymasin
  card.style.animation = "none";
  card.style.transform = "none";
  card.classList.remove("anim-in");
  void card.offsetWidth; // reflow — yakuniy layout

  const startRect = card.getBoundingClientRect();
  const lockH = Math.max(1, Math.round(startRect.height * 100) / 100);
  const lockW = Math.max(1, Math.round(startRect.width * 100) / 100);

  // Bubble ni alohida qotiramiz (flex/max-width tufayli width sakrashi shu yerda bo'lardi)
  const bubble = card.querySelector(".chat-bubble");
  if (bubble) {
    const br = bubble.getBoundingClientRect();
    const bw = Math.max(1, Math.round(br.width * 100) / 100);
    const bh = Math.max(1, Math.round(br.height * 100) / 100);
    bubble.style.boxSizing = "border-box";
    bubble.style.width = bw + "px";
    bubble.style.minWidth = bw + "px";
    bubble.style.maxWidth = bw + "px";
    bubble.style.height = bh + "px";
    bubble.style.minHeight = bh + "px";
    bubble.style.flexShrink = "0";
  }

  card.style.boxSizing = "border-box";
  card.style.height = lockH + "px";
  card.style.minHeight = lockH + "px";
  card.style.maxHeight = lockH + "px";
  card.style.width = lockW + "px";
  card.style.minWidth = lockW + "px";
  card.style.maxWidth = lockW + "px";
  card.style.overflow = "hidden";
  card.style.flexShrink = "0";
  card.style.contain = "layout size";

  const padL = PAD_L, padR = PAD_R, padTop = PAD_TOP, padBottom = PAD_BOTTOM;
  // Match the screen's real resolution (a 1x snapshot over a 2x card looks blurry -> visible "pop").
  // Only step down if the pixel buffer would get too big.
  const overlayCss = (startRect.width + padL + padR) * (startRect.height + padTop + padBottom);
  let sdpr = Math.min(Math.round(window.devicePixelRatio || 1), 3) || 1;
  while (sdpr > 1 && overlayCss * sdpr * sdpr > 2.4e6) sdpr--;

  let snap = null;
  try {
    snap = await __dissolveDomToCanvas(card, sdpr);
  } catch (err) {
    console.warn("[dissolve] snapshot failed, using float fallback:", err);
  }

  if (snap && snap.canvas) {
    const { canvas: snapshotCanvas, width, height, rect, dpr } = snap;
    // Epicenter = where the grains start breaking loose first (tap point if known).
    const hasClick = typeof clickX === "number" && typeof clickY === "number";
    const epX = hasClick ? Math.min(Math.max(clickX - rect.left, 0), width) : width * 0.5;
    const epY = hasClick ? Math.min(Math.max(clickY - rect.top, 0), height) : height * 0.3;
    const groupCtx = group
      ? { offsetY: startRect.top - group.top, span: group.span, sweep: group.sweep }
      : null;
    const grains = __dissolveBuildGrains(snapshotCanvas, width, height, dpr, epX, epY, groupCtx, tabMode);

    if (!grains.n) {
      await __dissolveFloatFallback(card);
    } else {
      const { n, G, x: gx, y: gy, vx: gvx, g: gg, delay: gdelay, col: gcol, lift: glift, ph: gph } = grains;
      const ox = Math.round(padL * dpr), oy = Math.round(padTop * dpr);
      const OW = Math.ceil((width + padL + padR) * dpr);
      const OH = Math.ceil((height + padTop + padBottom) * dpr);

      const overlay = document.createElement("canvas");
      overlay.className = "particle-canvas";
      overlay.width = OW;
      overlay.height = OH;
      overlay.style.width = (OW / dpr) + "px";
      overlay.style.height = (OH / dpr) + "px";
      overlay.style.left = (rect.left - padL) + "px";
      overlay.style.top = (rect.top - padTop) + "px";
      document.body.appendChild(overlay);

      const octx = overlay.getContext("2d");
      // Whole frame = one Uint32 pixel buffer + ONE putImageData (no per-grain draw calls).
      const img = octx.createImageData(OW, OH);
      const buf = new Uint32Array(img.data.buffer);
      const fadeZone = 60 * dpr;             // yuqori chetga yetganda yumshoq so'nadi
      const fadeZoneX = 70 * dpr;            // o'ng chetga yetganda yumshoq so'nadi
      const driftDev = DUST_DRIFT_X * dpr * (tabMode ? 0.2 : 1);
      const liftDev = DUST_LIFT_Y * dpr * (tabMode ? 0.2 : 1);
      const glideDev = DUST_GLIDE * dpr;
      let started = false;
      let prevMin = -1, prevMax = -1;

      const startT = performance.now();

      function paint(elapsed) {
        // Fade-in phase: nothing moves, so the whole card is one cheap drawImage.
        if (elapsed < FADE_IN_MS) {
          octx.drawImage(snapshotCanvas, ox, oy);
          return true;
        }
        if (!started) { octx.clearRect(0, 0, OW, OH); started = true; }

        if (prevMax >= 0) buf.fill(0, prevMin * OW, (prevMax + 1) * OW);
        let minY = 1e9, maxY = -1, alive = false;

        for (let i = 0; i < n; i++) {
          const local = elapsed - FADE_IN_MS - gdelay[i];
          let px, py, c = gcol[i];

          if (local < 0) {
            px = gx[i]; py = gy[i];
            alive = true;
          } else {
            const life = local / (ANIM_DURATION * gg[i]);
            if (life >= 1) continue;
            alive = true;
            // Telegram "chang": boshida tez "puff" (eksponensial), so'ng sekin suzib davom etadi; har zarra o'z yo'lida to'lqinlanadi
            const f = 1 - Math.exp(-local / DUST_TAU);
            const wob = Math.min(1, life * 3) * dpr;
            const sx = Math.sin(local * 0.0042 + gph[i]) * 4.5 * wob;
            const sy = Math.cos(local * 0.0035 + gph[i] * 1.7) * 3.5 * wob;
            px = gx[i] + gvx[i] * (driftDev * f + glideDev * local) + sx;
            py = gy[i] - glift[i] * liftDev * f + sy;
            let a = 1;
            if (life > 0.3) { const q = (life - 0.3) / 0.7; a = 1 - q * q * (3 - 2 * q); }   // so'nish
            const roomR = OW - (px + ox);
            if (roomR < fadeZoneX) { const t = Math.max(0, roomR / fadeZoneX); a *= t * t * (3 - 2 * t); }
            const roomT = py + oy;
            if (roomT < fadeZone) { const t = Math.max(0, roomT / fadeZone); a *= t * t * (3 - 2 * t); }
            if (a <= 0.01) continue;
            if (a < 1) c = (c & 0x00ffffff) | ((((c >>> 24) * a) | 0) << 24);
          }

          const ix = (px + ox) | 0, iy = (py + oy) | 0;
          if (iy < 0 || iy >= OH || ix < 0 || ix >= OW) continue;
          if (G === 1) {
            buf[iy * OW + ix] = c;
            if (iy < minY) minY = iy;
            if (iy > maxY) maxY = iy;
          } else {
            const ye = Math.min(iy + G, OH), xe = Math.min(ix + G, OW);
            for (let r = iy; r < ye; r++) {
              const base = r * OW;
              for (let q = ix; q < xe; q++) buf[base + q] = c;
            }
            if (iy < minY) minY = iy;
            if (ye - 1 > maxY) maxY = ye - 1;
          }
        }

        // Upload only the rows that changed (this frame ∪ previous frame).
        const top = prevMax >= 0 ? Math.min(prevMin, minY) : minY;
        const bottom = Math.max(prevMax, maxY);
        if (bottom >= top && bottom >= 0) {
          octx.putImageData(img, 0, 0, 0, top, OW, bottom - top + 1);
        }
        if (maxY >= 0) { prevMin = minY; prevMax = maxY; } else { prevMin = prevMax = -1; }
        return alive;
      }

      // Crossfade: the canvas fades IN over the still-visible card (no instant swap).
      paint(0);
      overlay.style.opacity = "0";
      if (overlay.animate) {
        overlay.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: FADE_IN_MS, easing: "ease-in-out", fill: "forwards",
        });
      } else {
        overlay.style.transition = "opacity " + FADE_IN_MS + "ms ease-in-out";
        void overlay.offsetHeight;
        overlay.style.opacity = "1";
      }
      setTimeout(() => { card.style.visibility = "hidden"; }, FADE_IN_MS + 30);

      // Particles run independently (do not block delete/API)
      const capMs = FADE_IN_MS + SWEEP_DURATION + 140 + ANIM_DURATION * 1.3 + 160 + (groupCtx ? groupCtx.sweep : 0);
      let _overlayGone = false;
      const killOverlay = () => {
        if (_overlayGone) return;
        _overlayGone = true;
        try { overlay.remove(); } catch (_) {}
      };
      function frame(now) {
        const elapsed = now - startT;
        const alive = paint(elapsed);
        // hard cap: animatsiya uzoq osilib qolmasin
        if (alive && elapsed < capMs) requestAnimationFrame(frame);
        else killOverlay();
      }
      requestAnimationFrame(frame);
      // zaxira tozalash (leftover particle-canvas oldini olish)
      setTimeout(killOverlay, capMs + 200);

      // Collapse the list row after COLLAPSE_DELAY while grains still fall
      await new Promise((r) => setTimeout(r, COLLAPSE_DELAY + (group ? Math.max(0, group.sweep - SWEEP_DURATION) : 0)));
    }
  } else {
    await __dissolveFloatFallback(card);
  }

  // Classic list collapse — row closes, siblings ease up into the gap
  return new Promise((resolve) => {
    if (!card.isConnected) {
      resolve();
      return;
    }
    card.style.visibility = "hidden";
    // Qotirilgan balandlikdan silliq 0 ga (visibility:hidden dan keyin getBoundingClientRect 0 bo'ladi)
    const h = lockH || startRect.height;
    card.style.maxHeight = h + "px";
    card.style.height = h + "px";
    card.style.minHeight = h + "px";
    void card.offsetHeight; // reflow
    card.classList.add("is-deleting");
    // is-deleting max-height:0 — height ham 0 ga tushsin
    card.style.height = "0";
    card.style.minHeight = "0";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (card.parentNode) card.remove();
      resolve();
    };
    const onEnd = (e) => {
      if (!e || e.target !== card) return;
      if (e.propertyName === "max-height" || e.propertyName === "max-width") {
        card.removeEventListener("transitionend", onEnd);
        done();
      }
    };
    card.addEventListener("transitionend", onEnd);
    setTimeout(done, 480);
  });
}
