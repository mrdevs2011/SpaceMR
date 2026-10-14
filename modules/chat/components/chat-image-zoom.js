/* chat-image-zoom.js — chatdagi (DM va guruh) yuborilgan rasmga bosilganda
 * post rasmi bilan BIR XIL lightbox (core/utils.js → openZoom: pinch, double-tap,
 * pan, trackpad zoom, tashqariga bosib / Esc bilan yopish) ochiladi.
 * Yangi tabda ochish o'rniga. Ctrl/Cmd/Shift + bosish — eski xulq (yangi tab).
 * Bitta delegatsiya (capture) — chat qayta chizilganda ham ishlayveradi. */
import { openZoom } from '../../core/utils.js';

if (!window.__chatImgZoomBound) {
  window.__chatImgZoomBound = true;
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    /* Ulashilgan post kartasi: profil rasmiga bosish */
    const avi = e.target?.closest?.('.cpc-avi-link[data-uid]');
    if (avi && !avi.classList.contains('is-deleted')) {
      const uid = avi.getAttribute('data-uid');
      if (uid) {
        e.preventDefault();
        e.stopPropagation();
        import('../../profile/profile.js').then(m => m.openUserProfileModal?.(uid)).catch(() => {});
        return;
      }
    }

    /* Ulashilgan post ichidagi rasm — oddiy chat rasmlari kabi zoom */
    const cpcImg = e.target?.closest?.('.cpc-media[data-cpc-kind="image"] img, img.cpc-img');
    if (cpcImg) {
      const card = cpcImg.closest('.chat-post-card');
      if (card?.classList.contains('post-deleted') || card?.classList.contains('user-deleted')) return;
      const url = cpcImg.currentSrc || cpcImg.src;
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      openZoom(url, 'image');
      return;
    }

    const link = e.target?.closest?.('.cfm-img-link');
    if (!link) return;
    const url = link.getAttribute('href') || link.querySelector('img')?.currentSrc || link.querySelector('img')?.src;
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    openZoom(url, 'image');
  }, true);
}
