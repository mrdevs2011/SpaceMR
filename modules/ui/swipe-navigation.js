/**
 * swipe-navigation.js — SpaceMR Telegram-Style Physical Horizontal Swipe Navigation Engine.
 *
 * Implements 100% natural, GPU-accelerated horizontal gesture physics:
 * 1. CHAT THREAD SWIPE-TO-BACK (#chatThreadModal):
 *    - 1:1 finger tracking via translate3d(deltaX, 0, 0)
 *    - Natural left-edge shadow: box-shadow: -15px 0 35px rgba(0,0,0,0.5)
 *    - Light background parallax on contacts/chats list
 *    - Velocity (> 0.35 px/ms) or distance (> 28%) triggers smooth dismiss -> closeChatThread()
 *    - Less distance triggers spring snapback via cubic-bezier(0.32, 0.72, 0, 1)
 *    - Zero conflict: vertical message scroll prioritized (|deltaY| > |deltaX|),
 *      message swipe left (deltaX < -15px) triggers Reply mode.
 *    - 100% identical behavior across DM, Groups, and Saved Messages.
 *
 * 2. MAIN TABS HORIZONTAL PAGER:
 *    - Tab sequence: home <-> chats <-> saved <-> profile
 *    - Swipe left -> next tab, swipe right -> prev tab
 *    - Zero conflict: guarded against open overlays/modals and horizontally
 *      scrollable containers (#storiesList, stories, carousels).
 *
 * 3. SUB-SCREENS SWIPE-TO-BACK:
 *    - #grpInfoOverlay -> chat thread
 *    - #settingsOverlay -> profile
 */

export const MAIN_TABS = ['home', 'chats', 'saved', 'profile'];

// Swipe state machine
let _swipe = null;
let _isInitialized = false;

// Dynamic helper wrappers to prevent circular or heavy load locks
export async function doCloseChatThread() {
  try {
    const { closeChatThread } = await import('../chat/chat.js');
    if (typeof closeChatThread === 'function') closeChatThread();
  } catch (_) {
    const el = document.getElementById('chatThreadModal');
    if (el) el.classList.remove('show');
  }
}

export async function doNavigateTo(route) {
  try {
    const { navigateTo } = await import('../router.js');
    if (typeof navigateTo === 'function') navigateTo(route);
  } catch (_) {}
}

/**
 * Returns true if any modal, overlay, drawer, or fullscreen viewer is open.
 */
export function hasAnyOverlayOpen() {
  if (typeof document === 'undefined') return false;
  const openSelectors = [
    '#chatThreadModal.show',
    '#grpInfoOverlay.show',
    '#settingsOverlay.show',
    '#uploadOverlay.show',
    '#detailModal.show',
    '#userProfileModal.show',
    '#zoomModal.show',
    '#cmViewer.show',
    '#attachDrawerOverlay.show',
    '.attach-menu.open',
    '#chatLightbox.show',
    '#storyViewer.show',
    '#camCapture.show',
    '#confirmOverlay.show',
    '#searchOverlay.open',
    '#cmtModal.show',
    '#aviCropModal.show'
  ];
  return !!document.querySelector(openSelectors.join(', '));
}

/**
 * Checks whether target element is inside a horizontally scrollable container
 * that has not yet reached its boundary in the swipe direction.
 * @param {Element} target
 * @param {'left'|'right'} direction - swipe direction ('left' = finger moving left, container scrolls right)
 */
export function isInsideHorizontalScrollable(target, direction) {
  if (!target || typeof target.closest !== 'function') return false;

  let curr = target;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    const isKnown = curr.matches?.(
      '#storiesList, #storiesBar, #storiesTrack, .stories-track, .stories-bar, ' +
      '.cpc-media, .media-carousel, .gallery-slider, .cfp-tray, [data-horizontal-scroll]'
    );

    let isScrollable = false;
    let scrollLeft = 0;
    let maxScroll = 0;

    try {
      const style = window.getComputedStyle ? window.getComputedStyle(curr) : {};
      const ox = style.overflowX;
      scrollLeft = curr.scrollLeft || 0;
      maxScroll = (curr.scrollWidth || 0) - (curr.clientWidth || 0);
      isScrollable = (ox === 'auto' || ox === 'scroll' || isKnown) && maxScroll > 4;
    } catch (_) {}

    if (isScrollable) {
      if (direction === 'left') {
        // Finger moving left -> container scrolls right towards end
        if (scrollLeft < maxScroll - 4) return true;
      } else if (direction === 'right') {
        // Finger moving right -> container scrolls left towards start
        if (scrollLeft > 4) return true;
      }
    }
    curr = curr.parentElement;
  }
  return false;
}

/**
 * Switches tab in MAIN_TABS sequence.
 * @param {number} dir - +1 for next tab, -1 for prev tab
 */
export function switchTab(dir) {
  let cur = 'home';
  try {
    const { state } = globalThis;
    if (state && state.view) cur = state.view;
    else if (typeof window !== 'undefined') {
      const seg0 = (window.location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
      if (MAIN_TABS.includes(seg0)) cur = seg0;
    }
  } catch (_) {}

  const idx = MAIN_TABS.indexOf(cur);
  if (idx === -1) return false;

  const nextIdx = idx + dir;
  if (nextIdx >= 0 && nextIdx < MAIN_TABS.length) {
    const targetTab = MAIN_TABS[nextIdx];
    try { navigator.vibrate?.(10); } catch (_) {}
    doNavigateTo(targetTab);
    return true;
  }
  // Mobile: swipe right on home tab (from left to right) opens story upload
  if (cur === 'home' && dir === -1) {
    try { navigator.vibrate?.(10); } catch (_) {}
    try {
      import('../feed/stories.js').then(m => m.openStoryAdd?.()).catch(() => {});
    } catch (_) {}
    return true;
  }
  return false;
}

/**
 * Returns current swipe state (for testing and debugging).
 */
export function getSwipeState() {
  return _swipe;
}

/**
 * Handles swipe start from touchstart or test synthetic event.
 */
export function handleSwipeStart(touch, target) {
  if (!touch || !target) return null;

  // Ignore touches on active inputs/controls if they are being interacted with
  if (target.closest?.('input, select, textarea, .cvm-track, [data-seek], audio, video')) {
    // If inside chat input textarea or search, don't lock swipe immediately
    if (target.id === 'chatThreadInput' || target.id === 'threadMsgSearchInput') {
      // Allow swipe only if initiated clearly horizontally
    }
  }

  // Check if voice recording is active
  if (document.querySelector('.chat-voice-btn.recording')) {
    return null;
  }

  // Allow text selection on desktop when clicking text elements
  if (target.closest?.('.chat-bubble-text, .post-text, .cmt-text, [contenteditable="true"]')) {
    if (typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches) {
      return null;
    }
  }

  const clientX = touch.clientX;
  const clientY = touch.clientY;

  // 1. Check topmost sub-screens first (LIFO order)
  const grpInfo = document.getElementById('grpInfoOverlay');
  if (grpInfo && grpInfo.classList.contains('show') && grpInfo.contains(target)) {
    _swipe = {
      type: 'grpInfo',
      el: grpInfo,
      bgEl: document.getElementById('chatThreadModal'),
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
      lastX: clientX,
      lastY: clientY,
      directionLocked: null,
      moveX: 0
    };
    return _swipe;
  }

  const settingsOverlay = document.getElementById('settingsOverlay');
  const isWide = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 1100px)').matches;
  if (settingsOverlay && settingsOverlay.classList.contains('show') && !isWide && settingsOverlay.contains(target)) {
    _swipe = {
      type: 'settings',
      el: settingsOverlay,
      bgEl: document.getElementById('profileView') || document.querySelector('.view.on'),
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
      lastX: clientX,
      lastY: clientY,
      directionLocked: null,
      moveX: 0
    };
    return _swipe;
  }

  // 2. Check #chatThreadModal (all chats: DM, Group, Saved Messages)
  const chatModal = document.getElementById('chatThreadModal');
  if (chatModal && chatModal.classList.contains('show') && chatModal.contains(target)) {
    // Don't swipe chat if an inner drawer (attach menu or emoji picker) is open
    if (document.querySelector('.attach-menu.open, .chat-emoji-quickpick.show')) {
      return null;
    }

    const msgRow = target.closest?.('.chat-msg');
    _swipe = {
      type: 'chat',
      el: chatModal,
      bgEl: document.getElementById('chatsView') || document.querySelector('.view.on'),
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
      lastX: clientX,
      lastY: clientY,
      directionLocked: null,
      msgRow: msgRow || null,
      moveX: 0
    };
    return _swipe;
  }

  // 3. Main tabs horizontal pager (home <-> chats <-> saved <-> profile)
  if (!hasAnyOverlayOpen()) {
    let cur = 'home';
    try {
      const { state } = globalThis;
      if (state && state.view) cur = state.view;
      else if (typeof window !== 'undefined') {
        const seg0 = (window.location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
        if (MAIN_TABS.includes(seg0)) cur = seg0;
      }
    } catch (_) {}

    if (MAIN_TABS.includes(cur)) {
      const curEl = document.getElementById(`${cur}View`) || document.querySelector('.view.on') || document.body;
      _swipe = {
        type: 'tabPager',
        el: curEl,
        curEl: curEl,
        targetEl: null,
        targetTab: null,
        target,
        startX: clientX,
        startY: clientY,
        startTime: Date.now(),
        lastX: clientX,
        lastY: clientY,
        directionLocked: null,
        currentTab: cur,
        moveX: 0
      };
      return _swipe;
    }
  }

  _swipe = null;
  return null;
}

/**
 * Handles swipe move.
 */
export function handleSwipeMove(touch, event) {
  if (!_swipe || !touch) return;

  const clientX = touch.clientX;
  const clientY = touch.clientY;
  _swipe.lastX = clientX;
  _swipe.lastY = clientY;

  const deltaX = clientX - _swipe.startX;
  const deltaY = clientY - _swipe.startY;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  // Direction resolution lock
  if (_swipe.directionLocked === null) {
    // 1. Vertical scroll dominates -> lock to vertical, abort swipe
    if (absY > 8 && absY >= absX) {
      _swipe.directionLocked = 'vertical';
      return;
    }

    // 2. In chat thread: check for message swipe-to-reply (deltaX < -15px on message card)
    if (_swipe.type === 'chat') {
      if (_swipe.msgRow && deltaX < -15 && absX > absY) {
        _swipe.directionLocked = 'reply';
        return;
      }
      if (deltaX > 8 && absX > absY) {
        _swipe.directionLocked = 'horizontal';
      }
    } else if (_swipe.type === 'grpInfo' || _swipe.type === 'settings') {
      if (deltaX > 8 && absX > absY) {
        _swipe.directionLocked = 'horizontal';
      }
    } else if (_swipe.type === 'tabPager') {
      const dir = deltaX < 0 ? 'left' : 'right';
      if (isInsideHorizontalScrollable(_swipe.target, dir)) {
        _swipe.directionLocked = 'inner-scroll';
        return;
      }
      if (absX > 14 && absX > absY * 1.4) {
        _swipe.directionLocked = 'horizontal';
      }
    }
  }

  // If locked to vertical, reply, or inner scroll -> do nothing
  if (_swipe.directionLocked !== 'horizontal') return;

  // Prevent default page scrolling when horizontal swipe is active
  if (event && event.cancelable) {
    try { event.preventDefault(); } catch (_) {}
  }

  // Handle physical 1:1 translate for modals (chat, grpInfo, settings)
  if (_swipe.type === 'chat' || _swipe.type === 'grpInfo' || _swipe.type === 'settings') {
    const moveX = Math.max(0, deltaX);
    _swipe.moveX = moveX;
    const width = (typeof window !== 'undefined' ? window.innerWidth : 360) || 360;
    const progress = Math.min(1, moveX / width);

    const el = _swipe.el;
    if (el) {
      el.classList.add('swiping-horizontal');
      el.style.transition = 'none';
      el.style.transform = `translate3d(${moveX}px, 0, 0)`;
      el.style.boxShadow = '-15px 0 35px rgba(0, 0, 0, 0.5)';
    }

    // Parallax on underlying view (for chat thread swipe-to-back)
    const bgEl = _swipe.bgEl;
    if (bgEl && _swipe.type === 'chat') {
      const parallaxX = -20 * (1 - progress);
      bgEl.style.transition = 'none';
      bgEl.style.transform = `translate3d(${parallaxX}%, 0, 0)`;
    }
  } else if (_swipe.type === 'tabPager') {
    _swipe.moveX = deltaX;
    const curTab = _swipe.currentTab;
    const curIdx = MAIN_TABS.indexOf(curTab);
    const W = (typeof window !== 'undefined' ? window.innerWidth : 360) || 360;

    let targetIdx = -1;
    if (deltaX < 0) {
      targetIdx = curIdx + 1;
    } else if (deltaX > 0) {
      targetIdx = curIdx - 1;
    }

    let targetTab = (targetIdx >= 0 && targetIdx < MAIN_TABS.length) ? MAIN_TABS[targetIdx] : null;
    let targetEl = targetTab ? document.getElementById(`${targetTab}View`) : null;

    if (_swipe.targetEl && _swipe.targetEl !== targetEl) {
      _cleanupTabSwiping(null, _swipe.targetEl);
    }

    _swipe.targetTab = targetTab;
    _swipe.targetEl = targetEl;

    const curEl = _swipe.curEl || _swipe.el;

    if (targetEl && curEl) {
      curEl.classList.add('tab-swiping-active');
      curEl.style.transition = 'none';
      curEl.style.transform = `translate3d(${deltaX}px, 0, 0)`;

      targetEl.classList.add('tab-swiping-target');
      targetEl.style.setProperty('display', 'block', 'important');
      targetEl.style.setProperty('visibility', 'visible', 'important');
      targetEl.style.setProperty('opacity', '1', 'important');
      targetEl.style.setProperty('position', 'fixed', 'important');
      targetEl.style.setProperty('top', '0', 'important');
      targetEl.style.setProperty('left', '0', 'important');
      targetEl.style.setProperty('width', '100vw', 'important');
      targetEl.style.setProperty('height', '100dvh', 'important');
      targetEl.style.setProperty('z-index', '10', 'important');
      targetEl.style.setProperty('background', 'var(--bg, #000000)', 'important');
      targetEl.style.transition = 'none';
      if (deltaX < 0) {
        // Next tab yonma-yon o'ng tomondan keladi (kaskad emas, yopishtirilgan chok)
        targetEl.style.transform = `translate3d(${W + deltaX}px, 0, 0)`;
      } else {
        // Prev tab yonma-yon chap tomondan keladi (kaskad emas, yopishtirilgan chok)
        targetEl.style.transform = `translate3d(${-W + deltaX}px, 0, 0)`;
      }
    } else if (curEl) {
      const dampedX = deltaX * 0.35;
      curEl.classList.add('tab-swiping-active');
      curEl.style.transition = 'none';
      curEl.style.transform = `translate3d(${dampedX}px, 0, 0)`;
    }
  }
}

/**
 * Handles swipe end / cancel.
 */
export function handleSwipeEnd() {
  if (!_swipe) return null;

  const s = _swipe;
  _swipe = null;

  if (s.directionLocked !== 'horizontal') {
    return null;
  }

  const width = (typeof window !== 'undefined' ? window.innerWidth : 360) || 360;
  const dt = Math.max(1, Date.now() - s.startTime);

  // 1. Modal Swipe-To-Back (Chat, GrpInfo, Settings)
  if (s.type === 'chat' || s.type === 'grpInfo' || s.type === 'settings') {
    const moveX = Math.max(0, s.moveX);
    const progress = moveX / width;
    const vx = moveX / dt; // px/ms
    const shouldDismiss = (progress > 0.28) || (vx > 0.35 && moveX > 20);

    const el = s.el;
    const bgEl = s.bgEl;

    if (shouldDismiss) {
      // Silliq chiqib ketish (dismiss)
      if (el) {
        el.classList.remove('swiping-horizontal');
        el.classList.add('swipe-dismissing');
        el.style.transition = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.24s ease';
        el.style.transform = 'translate3d(100%, 0, 0)';
        el.style.boxShadow = '-15px 0 35px rgba(0, 0, 0, 0.5)';
      }
      if (bgEl && s.type === 'chat') {
        bgEl.style.transition = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)';
        bgEl.style.transform = 'translate3d(0, 0, 0)';
      }

      setTimeout(() => {
        if (el) {
          el.classList.remove('swipe-dismissing');
          el.style.transform = '';
          el.style.boxShadow = '';
          el.style.transition = '';
        }
        if (bgEl) {
          bgEl.style.transform = '';
          bgEl.style.transition = '';
        }

        // Execute dismiss action
        if (s.type === 'chat') {
          doCloseChatThread();
        } else if (s.type === 'grpInfo') {
          const btn = document.getElementById('grpInfoCloseBtn');
          if (btn) btn.click();
          else {
            el?.classList.remove('show');
            try { import('../core/utils.js').then(m => m.unlockScroll('grpInfoOverlay')); } catch (_) {}
          }
        } else if (s.type === 'settings') {
          const btn = document.getElementById('closeSettingsBtn');
          if (btn) btn.click();
          else {
            el?.classList.remove('show');
            try { import('../core/utils.js').then(m => m.unlockScroll('settingsOverlay')); } catch (_) {}
          }
        }
      }, 240);

      return { dismissed: true, type: s.type, progress, vx };
    } else {
      // Snapback (qaytish)
      if (el) {
        el.classList.remove('swiping-horizontal');
        el.classList.add('swipe-snapping');
        el.style.transition = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.24s ease';
        el.style.transform = 'translate3d(0, 0, 0)';
        el.style.boxShadow = '';
      }
      if (bgEl && s.type === 'chat') {
        bgEl.style.transition = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)';
        bgEl.style.transform = 'translate3d(0, 0, 0)';
      }

      setTimeout(() => {
        if (el) {
          el.classList.remove('swipe-snapping');
          el.style.transform = '';
          el.style.boxShadow = '';
          el.style.transition = '';
        }
        if (bgEl) {
          bgEl.style.transform = '';
          bgEl.style.transition = '';
        }
      }, 240);

      return { dismissed: false, type: s.type, progress, vx };
    }
  }

  // 2. Main Tabs Horizontal Pager
  if (s.type === 'tabPager') {
    const deltaX = s.moveX;
    const absX = Math.abs(deltaX);
    const vx = absX / dt;
    const threshold = Math.min(width * 0.18, 55);
    const shouldSwitch = (absX >= threshold) || (vx > 0.35 && absX > 20);

    const curEl = s.curEl || s.el;
    const targetEl = s.targetEl;
    const targetTab = s.targetTab;

    if (shouldSwitch && targetTab && targetEl) {
      const dir = deltaX < 0 ? 1 : -1;
      try { navigator.vibrate?.(10); } catch (_) {}

      if (curEl) {
        curEl.style.transition = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)';
        curEl.style.transform = (deltaX < 0) ? 'translate3d(-100vw, 0, 0)' : 'translate3d(100vw, 0, 0)';
      }
      if (targetEl) {
        targetEl.style.transition = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)';
        targetEl.style.transform = 'translate3d(0, 0, 0)';
      }

      setTimeout(() => {
        _cleanupTabSwiping(curEl, targetEl);
        doNavigateTo(targetTab);
      }, 240);

      return { switched: true, dir, deltaX, vx };
    } else {
      if (s.currentTab === 'home' && deltaX >= threshold) {
        _cleanupTabSwiping(curEl, targetEl);
        try { navigator.vibrate?.(10); } catch (_) {}
        try {
          import('../feed/stories.js').then(m => m.openStoryAdd?.()).catch(() => {});
        } catch (_) {}
        return { switched: true, dir: -1, action: 'storyUpload', deltaX, vx };
      }

      if (curEl) {
        curEl.style.transition = 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)';
        curEl.style.transform = 'translate3d(0, 0, 0)';
        curEl.style.boxShadow = '';
      }
      if (targetEl) {
        targetEl.style.transition = 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)';
        targetEl.style.transform = (deltaX < 0) ? 'translate3d(100vw, 0, 0)' : 'translate3d(-100vw, 0, 0)';
      }

      setTimeout(() => {
        _cleanupTabSwiping(curEl, targetEl);
      }, 220);

      return { switched: false, dir: deltaX < 0 ? 1 : -1, deltaX, vx };
    }
  }

  return null;
}

/**
 * Initializes global gesture listeners on document.
 */
export function initSwipeNavigation() {
  if (_isInitialized) return;
  _isInitialized = true;

  if (typeof document === 'undefined') return;

  const onTouchStart = (e) => {
    if (e.touches && e.touches.length === 1) {
      handleSwipeStart(e.touches[0], e.target);
    } else {
      _swipe = null;
    }
  };

  const onTouchMove = (e) => {
    if (_swipe && e.touches && e.touches.length === 1) {
      handleSwipeMove(e.touches[0], e);
    }
  };

  const onTouchEnd = () => {
    handleSwipeEnd();
  };

  document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
  document.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });

  // Desktop (window toraytirilganda / mobile rejimida) sichqoncha bilan ham slidelar tabiiy ishlashi uchun
  let _isMouseDown = false;

  const isNarrowScreen = () => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth <= 1099;
  };

  const onMouseDown = (e) => {
    if (e.button !== 0 || !isNarrowScreen()) return;
    if (e.target.closest?.('input, textarea, select, button, a, .sv-close, .modal, #camCapture, [role="button"], label')) return;
    _isMouseDown = true;
    handleSwipeStart(e, e.target);
  };

  const onMouseMove = (e) => {
    if (!_isMouseDown || !_swipe) return;
    if (_swipe.directionLocked === 'horizontal') {
      try { e.preventDefault(); } catch (_) {}
      document.body.classList.add('is-swiping-tabs');
    }
    handleSwipeMove(e, e);
  };

  const onMouseUp = () => {
    if (!_isMouseDown) return;
    _isMouseDown = false;
    document.body.classList.remove('is-swiping-tabs');
    handleSwipeEnd();
  };

  document.addEventListener('mousedown', onMouseDown, { passive: true, capture: true });
  document.addEventListener('mousemove', onMouseMove, { passive: false, capture: true });
  document.addEventListener('mouseup', onMouseUp, { passive: true, capture: true });
  window.addEventListener('blur', onMouseUp, { passive: true });
  document.addEventListener('dragstart', (e) => {
    if (_isMouseDown || _swipe) {
      e.preventDefault();
    }
  }, { capture: true });
}

export function _cleanupTabSwiping(curEl, targetEl) {
  try { document.body.classList.remove('is-swiping-tabs'); } catch (_) {}
  if (curEl) {
    curEl.classList.remove('tab-swiping-active');
    curEl.style.transform = '';
    curEl.style.transition = '';
    curEl.style.boxShadow = '';
    curEl.style.removeProperty('display');
    curEl.style.removeProperty('visibility');
    curEl.style.removeProperty('opacity');
    curEl.style.removeProperty('position');
    curEl.style.removeProperty('top');
    curEl.style.removeProperty('left');
    curEl.style.removeProperty('width');
    curEl.style.removeProperty('height');
    curEl.style.removeProperty('z-index');
    curEl.style.removeProperty('background');
    curEl.style.removeProperty('pointer-events');
  }
  if (targetEl) {
    targetEl.classList.remove('tab-swiping-target');
    targetEl.style.transform = '';
    targetEl.style.transition = '';
    targetEl.style.boxShadow = '';
    targetEl.style.removeProperty('display');
    targetEl.style.removeProperty('visibility');
    targetEl.style.removeProperty('opacity');
    targetEl.style.removeProperty('position');
    targetEl.style.removeProperty('top');
    targetEl.style.removeProperty('left');
    targetEl.style.removeProperty('width');
    targetEl.style.removeProperty('height');
    targetEl.style.removeProperty('z-index');
    targetEl.style.removeProperty('background');
    targetEl.style.removeProperty('pointer-events');
  }
}

// Auto-boot in browser environment
try {
  if (typeof window !== 'undefined') {
    initSwipeNavigation();
  }
} catch (_) {}
