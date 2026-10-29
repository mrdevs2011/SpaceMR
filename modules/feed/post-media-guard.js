/**
 * Post media (video) qo'riqchisi — feed, profil, saqlanganlar, post sahifasi: hamma joyda.
 *
 *  1) Bir vaqtda faqat BITTA post video ijro etiladi (yangisi boshlansa, qolganlari pauzaga qo'yiladi).
 *  2) Ijro etilayotgan video ekrandan chiqib ketsa (scroll, boshqa tab/sahifa) — SHU JOYIDA pauza.
 *     Avtomatik davom ettirilmaydi: foydalanuvchi qaytib kelib o'zi play bosadi.
 *  3) Video hech qachon "qora" qolmasin: birinchi kadr chizilmasa — nozik seek bilan chizdiriladi,
 *     manba (blob keshi) buzilsa — asl URL ga qaytiladi, ekranga qaytganda qayta chizdiriladi.
 *  4) Progress "eng oxirida" qotib qolmasin: hali ijro etilmagan / qo'l tegmagan video oxirida tursa
 *     (WebM duration=Infinity tuzatish seek'idan keyin) — boshiga qaytariladi.
 */
if (typeof document !== 'undefined' && !window.__postMediaGuard) {
  window.__postMediaGuard = true;

  const SEL = '.post-media video';
  const isPostVideo = (el) => !!el && el.tagName === 'VIDEO' && !!el.closest?.('.post-media');
  const isPlaying = (v) => !v.paused && !v.ended;
  const inPip = (v) => { try { return document.pictureInPictureElement === v; } catch (_) { return false; } };
  const pauseVideo = (v) => { if (inPip(v)) return; try { v.pause(); } catch (_) {} };
  const seekTo = (v, t) => { try { v.currentTime = t; } catch (_) {} };

  /* ── 1) Bir vaqtda bitta video ── */
  function pauseOthers(except) {
    document.querySelectorAll(SEL).forEach((o) => {
      if (o !== except && isPlaying(o)) pauseVideo(o);
    });
  }

  /* ── 2) Ekrandan chiqsa — joyida pauza (davom ettirmaymiz) ── */
  let _io = null;
  const _watched = new WeakSet();
  function getIO() {
    if (_io || typeof IntersectionObserver === 'undefined') return _io;
    _io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const v = en.target;
        if (!v.isConnected) { _io.unobserve(v); continue; }
        if (en.intersectionRatio < 0.15) {
          if (isPlaying(v)) pauseVideo(v);
        } else if (!isPlaying(v) && v.readyState < 2 && !v.seeking) {
          // Ekranga qaytdi, lekin kadr yo'qolgan (qora) — joriy joyda qayta chizdiramiz
          revive(v);
        }
      }
    }, { threshold: [0, 0.15, 0.4] });
    return _io;
  }
  function watch(v) {
    if (_watched.has(v)) return;
    const o = getIO();
    if (!o) return;
    _watched.add(v);
    o.observe(v);
  }

  /* Tab/sahifa almashganda: ko'rinmaydigan (display:none / faol bo'lmagan .view) videolar pauza */
  function pauseHidden() {
    document.querySelectorAll(SEL).forEach((v) => {
      if (!isPlaying(v)) return;
      const view = v.closest('.view');
      const hidden = v.getClientRects().length === 0 || (view && !view.classList.contains('on'));
      if (hidden) pauseVideo(v);
    });
  }
  window.addEventListener('spacemr:route', () => { setTimeout(pauseHidden, 120); });

  document.addEventListener('play', (e) => {
    const v = e.target;
    if (!isPostVideo(v)) return;
    pauseOthers(v);
    watch(v);
  }, true);

  document.addEventListener('playing', (e) => {
    if (isPostVideo(e.target)) e.target.dataset.mrPlayed = '1';
  }, true);

  // Foydalanuvchi progressni o'zi surgan bo'lsa — avtomatik "boshiga qaytarish" tegmaydi
  document.addEventListener('pointerdown', (e) => {
    const v = e.target?.closest?.(SEL);
    if (v) v.dataset.mrTouched = '1';
  }, true);

  /* ── 3) Qora video bo'lmasin ── */
  function paintFirstFrame(v) {
    if (!v.isConnected || !v.paused || v.seeking || v.dataset.mrPlayed || v.dataset.mrTouched) return;
    if ((v.currentTime || 0) < 0.05) seekTo(v, 0.001); // preload=metadata da birinchi kadr chizilishi uchun
  }
  document.addEventListener('loadedmetadata', (e) => {
    const v = e.target;
    if (!isPostVideo(v)) return;
    try { window.__fixVidDur && window.__fixVidDur(v); } catch (_) {}
    setTimeout(() => paintFirstFrame(v), 80);
  }, true);
  document.addEventListener('loadeddata', (e) => {
    if (isPostVideo(e.target)) delete e.target.dataset.mrRevive;
  }, true);

  // Blob keshi (revoke qilingan / buzilgan) — asl URL ga qaytamiz
  document.addEventListener('error', (e) => {
    const v = e.target;
    if (!isPostVideo(v) || v.dataset.mrRetry === '1') return;
    const orig = v.closest('.post-media')?.dataset.url;
    const cur = v.currentSrc || v.src || '';
    const strip = (u) => String(u).split('#')[0];
    if (!orig || strip(cur) === strip(orig)) return;
    v.dataset.mrRetry = '1';
    const t = v.currentTime || 0;
    v.src = orig;
    try { v.load(); } catch (_) {}
    if (t > 0.05) v.addEventListener('loadedmetadata', () => seekTo(v, t), { once: true });
  }, true);

  /* ── 4) Progress oxirida qotib qolmasin ── */
  function checkEnd(v) {
    if (!v.isConnected || !v.paused || v.seeking || v.dataset.mrPlayed || v.dataset.mrTouched) return;
    const d = v.duration;
    if (isFinite(d) && d > 0 && (v.currentTime || 0) > d - 0.3) seekTo(v, 0.001);
  }
  ['seeked', 'durationchange'].forEach((type) => {
    document.addEventListener(type, (e) => {
      const v = e.target;
      if (isPostVideo(v)) setTimeout(() => checkEnd(v), 350);
    }, true);
  });

  /* ── 5) Tab / ilova almashganda hammasi pauza; qaytganda qora kadr tiklanadi ── */
  function pauseAll() {
    document.querySelectorAll(SEL).forEach((v) => { if (isPlaying(v)) pauseVideo(v); });
  }
  function revive(v) {
    if (!v.isConnected || v.seeking) return;
    const n = +v.dataset.mrRevive || 0;
    const t = v.currentTime || 0;
    // Manba umuman yuklanmagan (qora) — qayta yuklaymiz (ko'pi bilan 2 marta)
    if (v.readyState === 0 && (v.error || v.networkState === 3) && n < 2) {
      v.dataset.mrRevive = String(n + 1);
      try { v.load(); } catch (_) {}
      if (t > 0.05) v.addEventListener('loadedmetadata', () => seekTo(v, t), { once: true });
      return;
    }
    seekTo(v, t > 0 ? t : 0.001);
  }
  function repaintVisible() {
    document.querySelectorAll(SEL).forEach((v) => {
      if (isPlaying(v) || v.readyState >= 2 || v.seeking || !v.getClientRects().length) return;
      const r = v.getBoundingClientRect();
      if (r.bottom > 0 && r.top < (window.innerHeight || 0)) revive(v);
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAll(); else setTimeout(repaintVisible, 60);
  });
  window.addEventListener('pagehide', pauseAll);
  window.addEventListener('pageshow', (e) => { if (e.persisted) setTimeout(repaintVisible, 60); });
}
