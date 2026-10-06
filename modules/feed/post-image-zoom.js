/* post-image-zoom.js — feed/profil post rasmini bosganda chat bilan BIR XIL lightbox */
import { openZoom } from '../core/utils.js';

if (!window.__postImgZoomBound) {
  window.__postImgZoomBound = true;
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const media = e.target?.closest?.('.post-media');
    if (!media) return;
    if (media.dataset.type === 'video' || e.target.closest('video, a, button')) return;
    const img = media.querySelector('img');
    const url = media.dataset.url || img?.currentSrc || img?.src;
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    openZoom(url, 'image');
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const media = e.target?.closest?.('.post-media');
    if (!media || media.dataset.type === 'video') return;
    const url = media.dataset.url || media.querySelector('img')?.src;
    if (!url) return;
    e.preventDefault();
    openZoom(url, 'image');
  }, true);
}
