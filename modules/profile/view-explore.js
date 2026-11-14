/**
 * Kashf (Explore) View Controller
 */
export function initView() {
  const ov = document.getElementById('searchOverlay');
  if (ov) {
    ov.classList.add('open');
    const sbSearchToggle = document.getElementById('sbSearchToggle');
    sbSearchToggle?.classList.add('search-active', 'on');
    document.getElementById('hdrExploreBtn')?.classList.add('search-active');
    setTimeout(() => document.getElementById('searchInput')?.focus(), 60);
  }
}

export function destroyView() {
  const ov = document.getElementById('searchOverlay');
  if (ov && ov.classList.contains('open')) {
    ov.classList.remove('open');
  }
  const sbSearchToggle = document.getElementById('sbSearchToggle');
  sbSearchToggle?.classList.remove('search-active', 'on');
  document.getElementById('hdrExploreBtn')?.classList.remove('search-active');
}
