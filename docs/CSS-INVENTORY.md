# CSS inventar (DIET F4.1b)

> Avtomatik: `node scripts/css-inventory.mjs`. **Faqat hisobot** — hech narsa o'chirilmagan.
> Token-darajasida (class/id matnda uchraydimi); property-darajasidagi solishtirish emas. `hard` = o'lik nomzod, `maybe` = JS'da dinamik yig'ilishi mumkin. O'chirishdan oldin brauzerda (qoida 8) va DevTools Coverage bilan tasdiqlang.

| Fayl | Qator | Qoida | hard | maybe | hard qator | `!important` (hard ichida) |
|---|---|---|---|---|---|---|
| admin.css | 1534 | 502 | 260 | 140 | 1115 | 201 (156) |
| apps.css | 614 | 375 | 364 | 0 | 922 | 55 (43) |
| avi-crop.css | 75 | 30 | 10 | 0 | 32 | 0 (0) |
| base.css | 273 | 75 | 12 | 0 | 39 | 10 (1) |
| chat-attach.css | 253 | 72 | 71 | 0 | 306 | 6 (6) |
| features.css | 5584 | 1336 | 815 | 0 | 4157 | 271 (183) |
| file-viewer.css | 273 | 155 | 154 | 0 | 415 | 4 (4) |
| layers.css | 1246 | 412 | 136 | 3 | 465 | 15 (1) |
| mono-x.css | 9754 | 2098 | 1082 | 0 | 5479 | 1355 (487) |
| motion.css | 373 | 95 | 25 | 0 | 110 | 18 (6) |
| profile-pro.css | 309 | 63 | 7 | 0 | 14 | 9 (0) |
| profile-x.css | 108 | 56 | 55 | 0 | 158 | 4 (4) |
| tokens.css | 108 | 2 | 0 | 0 | 0 | 0 (0) |
| video-note.css | 248 | 78 | 72 | 0 | 288 | 33 (29) |
| **JAMI** | **20752** | **5349** | **3063** | **143** | **13500** | **1981 (920)** |

## hard-o'lik selektorlar (har fayldan 30 tagacha)

### admin.css (260)
- `.fw-500`
- `.fw-600`
- `.ttl`
- `.p-10px`
- `.pt-20px`
- `.pt-80px`
- `.mt-5px`
- `.mt-10px`
- `.mt-15px`
- `.mt-20px`
- `.mt-25px`
- `.mt-30px`
- `.mt-35px`
- `.mt-40px`
- `.mt-45px`
- `.mt-50px`
- `.mt-55px`
- `.mt-60px`
- `.mt-65px`
- `.mt-70px`
- `.mt-75px`
- `.mt-80px`
- `.mt-85px`
- `.mt-90px`
- `.mt-95px`
- `.mt-100px`
- `.brr-10px`
- `.ua-row`
- `.ua-delete-btn`
- `.ua-row:hover .ua-delete-btn`
- … yana 230 ta

### apps.css (364)
- `.aps-head`
- `.aps-title`
- `.aps-back`
- `.aps-back:hover`
- `.aps-head-btns`
- `.aps-btn`
- `.aps-btn.ghost`
- `.aps-btn:hover`
- `.aps-btn:disabled`
- `.aps-link`
- `.aps-link.danger`
- `.aps-search`
- `.aps-search input`
- `.aps-search input:focus`
- `.aps-sec`
- `.aps-sec`
- `.aps-sec-h`
- `.aps-sec-h:hover`
- `.aps-sec-ic`
- `.aps-sec-n`
- `.aps-sec-h em`
- `.aps-sec-ch`
- `.aps-none`
- `.aps-catbar`
- `.aps-catbtns`
- `.aps-grid`
- `.apc`
- `.apc:hover`
- `.apc-logo, .apr-logo`
- `.apc-logo img, .apr-logo img`
- … yana 334 ta

### avi-crop.css (10)
- `.avi-crop-hint`
- `.avi-crop-zoom-row`
- `.avi-crop-zoom-btn`
- `.avi-crop-slider`
- `.avi-crop-slider:focus`
- `.avi-crop-slider::-webkit-slider-runnable-track`
- `.avi-crop-slider::-moz-range-track`
- `.avi-crop-slider::-webkit-slider-thumb`
- `.avi-crop-slider::-moz-range-thumb`
- `.avi-crop-slider:focus-visible::-webkit-slider-thumb`

### base.css (12)
- `.empty-icon`
- `[data-theme="dark"] #toast.toast-success`
- `[data-theme="dark"] #toast.toast-error`
- `[data-theme="dark"] #toast.toast-info`
- `[data-theme="dark"] .empty-search-icon`
- `.empty-search`
- `.empty-search-icon`
- `.empty-search strong`
- `.empty-search-hint`
- `.act-btn img.icon`
- `#authWrap .auth-card.rc-mode > :not(.auth-logo):not(#regRecoveryModal)`
- `.act-btn.liked img.icon, .like-btn.liked img.icon`

### chat-attach.css (71)
- `.attach-menu`
- `.attach-menu .am-item, .attach-menu label.am-item`
- `.attach-menu .am-item:hover, .attach-menu .am-item:focus-visible`
- `.attach-menu .am-item svg`
- `#camCapture`
- `#camCapture .cc-video`
- `#camCapture .cc-video.mirror`
- `#camCapture .cc-zoom-badge`
- `#camCapture .cc-zoom-badge.show`
- `#camCapture .cc-video`
- `#camCapture .cc-freeze`
- `#camCapture .cc-freeze.mirror`
- `#camCapture .cc-freeze.show`
- `#camCapture .cc-flip.spin svg`
- `#camCapture .cc-top`
- `#camCapture .cc-top-right`
- `#camCapture .cc-btn`
- `#camCapture .cc-btn:active`
- `#camCapture .cc-btn:hover`
- `#camCapture .cc-flash.on`
- `#camCapture .cc-top-center`
- `#camCapture .cc-modes`
- `#camCapture .cc-modes[hidden]`
- `#camCapture .cc-mode`
- `#camCapture .cc-mode svg`
- `#camCapture .cc-mode.active`
- `#camCapture .cc-bottom`
- `#camCapture .cc-shutter`
- `#camCapture .cc-shutter-inner`
- `#camCapture .cc-shutter:active .cc-shutter-inner`
- … yana 41 ta

### features.css (815)
- `.hdr-brand`
- `.post-meta`
- `.post-time`
- `.post-badge`
- `.del-btn`
- `.del-btn:hover`
- `.post-media`
- `.post-media img`
- `.post-media.pm-loading::after`
- `.cap-more`
- `.cap-more:hover`
- `.cap-collapsed .cap-full`
- `.cap-expanded .cap-short`
- `.cap-expanded .cap-full`
- `.file-icon`
- `.file-size`
- `.file-dl`
- `.file-dl:hover`
- `.post-stats`
- `.act-btn`
- `.act-btn:last-child`
- `.post.post-link-highlight`
- `.post.post-link-highlight::after`
- `.heart-burst`
- `.heart-burst svg`
- `.hdr-hidden`
- `.upload-float-bar.is-dragging`
- `.ufb-ring-fg.indeterminate`
- `.ufb-icon`
- `.ufb-icon.done`
- … yana 785 ta

### file-viewer.css (154)
- `.fv`
- `.fv`
- `.fv-bar`
- `.fv-ico, .fv-title small`
- `.fv-title`
- `.fv-title b`
- `.fv-tools`
- `.fv-ib`
- `.fv-ib svg`
- `.fv-ib:hover`
- `.fv-ib.on`
- `.fv-ib:focus-visible`
- `.fv-body`
- `.fv-load`
- `.fv-theme .fv-sun`
- `.fv-theme .fv-moon`
- `.fv[data-fv-theme="light"] .fv-theme .fv-sun`
- `.fv[data-fv-theme="light"] .fv-theme .fv-moon`
- `.fv-code`
- `.fv-cut`
- `.fv-cols`
- `.fv-ln, .fv-pre`
- `.fv-ln`
- `.fv-pre`
- `.fv-pre code`
- `.fv-wrap .fv-cols`
- `.fv-wrap .fv-pre`
- `.fv-code .hl-c, .fv-code .hl-d, .fv-code .hl-p`
- `.fv-code .hl-t`
- `.fv-code .hl-a`
- … yana 124 ta

### layers.css (136)
- `.glass-heavy`
- `.del-btn:hover`
- `.empty--home`
- `.empty-glow`
- `.empty-icon, .empty-search-icon`
- `.empty-title`
- `.empty-sub`
- `.empty-search-hint`
- `.empty-cta`
- `.empty-cta:hover`
- `.grid-cell, .up-grid-cell`
- `.grid-cell--media, .up-grid-cell--media`
- `.grid-cell--text, .up-grid-cell--text`
- `.grid-cell img, .up-grid-cell img`
- `.grid-cell-overlay, .up-grid-cell-overlay`
- `.grid-cell:hover .grid-cell-overlay, .up-grid-cell:hover .up-grid-cell-overlay`
- `.grid-stat, .up-grid-stat`
- `.grid-cell-txt, .up-grid-cell-txt`
- `.cmt-swipe-indicator`
- `.cmt-swipe-icon`
- `.cmt-copy-hint`
- `.cmt-body.long-press .cmt-copy-hint`
- `.cmt-typing`
- `.cmt-typing-dot`
- `#toast.toast-warning`
- `.toast-with-icon`
- `.toast-icon`
- `.toast-icon.success`
- `.toast-icon.error`
- `.toast-icon.warning`
- … yana 106 ta

### mono-x.css (1082)
- `.ua-approve-btn, .ua-approve-btn *`
- `.chat-row-badge, .chat-row-badge *`
- `.chat-voice-btn.recording, .chat-voice-btn.recording *`
- `.chat-msg.theirs .cvm-play, .chat-msg.theirs .cvm-play *`
- `.chat-msg.theirs .cvm-play:hover, .chat-msg.theirs .cvm-play:hover *`
- `.chat-msg.theirs .cvm-bar.played, .chat-msg.theirs .cvm-bar.played *`
- `.ufb-icon, .ufb-icon *`
- `.ufb-fill, .ufb-fill *`
- `.grp-avi-badge--group, .grp-avi-badge--group *`
- `.grp-avi-badge--channel, .grp-avi-badge--channel *`
- `.chat-row-grp-badge--group, .chat-row-grp-badge--group *`
- `.grp-picker-check.on, .grp-picker-check.on *`
- `.empty-cta, .empty-cta *`
- `.toast-progress, .toast-progress *`
- `.ufb-fill.indeterminate, .ufb-fill.indeterminate *`
- `.cc-btn--apply, .cc-btn--apply *`
- `.bc-send-btn, .bc-send-btn *`
- `.app-hdr.search-open`
- `.post-head`
- `.post-meta`
- `.post-name`
- `.post-user, .post-dot, .post-time`
- `.post-user`
- `.post-dot, .post-time`
- `.post-del-btn, .post-more-btn, .post-head .del-btn`
- `.post-del-btn:hover, .post-head .del-btn:hover`
- `.post-more-btn:hover`
- `.post-main`
- `.post-caption`
- `.post-media, [data-theme] .post-media`
- … yana 1052 ta

### motion.css (25)
- `#incomingCallModal.has-bg::before, #callActiveModal.has-bg::before`
- `#callActiveModal.video-mode`
- `#callActiveModal.video-mode::before, #callActiveModal.video-mode::after`
- `.incoming-call-avi .call-avi-initial, .call-voice-avi .call-avi-initial`
- `#callActiveModal.video-mode .call-stage`
- `#callActiveModal.connected .call-timer`
- `#callActiveModal.connected .call-status`
- `.no-camera #callCamCol, .no-camera #callSwitchCol`
- `.no-speaker-route #callSpeakerCol`
- `#callActiveModal.video-mode .call-ctrl-btn`
- `#callActiveModal.video-mode .call-ctrl-btn.end-btn`
- `.chat-msg.msg-collapsing, .chat-msg.is-deleting`
- `.chat-msg.msg-dissolving`
- `#chatThreadMessages .chat-msg.theirs, .chat-thread-messages .chat-msg.theirs`
- `#chatThreadMessages .chat-msg .msg-avi-btn, #chatThreadMessages .chat-msg .grp-avi-gap, .c`
- `#chatThreadMessages .chat-msg .chat-bubble, .chat-thread-messages .chat-msg .chat-bubble`
- `.chat-msg.msg-reply-hl::after`
- `.chat-msg.msg-link-highlight .chat-bubble, .chat-msg.msg-reply-hl .chat-bubble`
- `#chatThreadMessages.msg-selecting .chat-msg, .chat-thread-messages.msg-selecting .chat-msg`
- `#chatThreadMessages.msg-selecting .chat-msg.mine`
- `#chatThreadMessages.msg-selecting .chat-msg.theirs`
- `#chatThreadMessages.msg-selecting .chat-msg::before`
- `#chatThreadMessages.msg-selecting .chat-msg .chat-bubble`
- `.attach-menu`
- `.chat-draft-tag`

### profile-pro.css (7)
- `#profileView .profile-link-ico`
- `#profileView .profile-link-ico svg`
- `#profileView .pf-btn-ghost.is-done`
- `#profileView .profile-grid--uniform`
- `#profileView .profile-grid--uniform .grid-cell`
- `#profileView .profile-grid .grid-cell`
- `#profileView .profile-grid--uniform .grid-cell:hover`

### profile-x.css (55)
- `#userProfileModal .up-hero`
- `#userProfileModal .up-hero .up-avi, #userProfileModal .up-head .up-avi`
- `#userProfileModal .up-hero .up-avi, #userProfileModal .up-head .up-avi`
- `#userProfileModal .up-hero .up-chat-btn`
- `#userProfileModal .up-hero .up-avi`
- `#userProfileModal .up-chat-btn`
- `#userProfileModal .up-chat-btn:hover`
- `#userProfileModal .up-chat-btn img.icon`
- `#userProfileModal .up-head`
- `#userProfileModal .up-info`
- `#userProfileModal .up-info .up-name`
- `#userProfileModal .up-username`
- `#userProfileModal .up-links`
- `#userProfileModal .profile-link-ico`
- `#userProfileModal .profile-link-ico svg`
- `#userProfileModal img.profile-link-ico`
- `#userProfileModal .up-stat-val, #userProfileModal .up-stat-lbl`
- `#userProfileModal .up-stats`
- `#userProfileModal .up-posts-tab`
- `#userProfileModal .up-posts-tab .profile-grid-tab`
- `#userProfileModal .up-posts-tab .profile-grid-tab:hover`
- `#userProfileModal .up-posts-tab .profile-grid-tab.active`
- `#userProfileModal .up-posts-tab .profile-grid-tab.active::after`
- `#grpInfoOverlay .gi-head`
- `#grpInfoOverlay .gi-avi`
- `#grpInfoOverlay .gi-avi:hover`
- `#grpInfoOverlay .gi-avi`
- `#grpInfoOverlay .gi-info`
- `#grpInfoOverlay .gi-name`
- `#grpInfoOverlay .gi-type-badge`
- … yana 25 ta

### video-note.css (72)
- `.chat-voice-btn.mode-video:not(.is-send) .icon-vnote`
- `.chat-voice-btn.mode-video .icon-mic`
- `.chat-voice-btn.is-send .icon-vnote`
- `.chat-voice-btn.recording .icon-vnote`
- `#vnotePreview`
- `#vnotePreview.show`
- `#vnotePreview .vnp-stage`
- `#vnotePreview.locked .vnp-ctrls, #vnotePreview .vnp-btn`
- `body.vn-rec #chatVoiceBtn, body.vn-rec .chat-voice-btn.recording`
- `body.vn-rec #chatVoiceBtn.vn-locked, body.vn-rec .chat-voice-btn.vn-locked`
- `body.vn-rec .chat-record-bar.active`
- `#vnotePreview .vnp-circle`
- `#vnotePreview .vnp-video`
- `#vnotePreview .vnp-ring`
- `#vnotePreview .vnp-ring-fg`
- `.cfm-note-wrap`
- `.cfm-note`
- `.chat-msg.mine .cfm-note`
- `.cfm-note-vid`
- `.cfm-note-play`
- `.cfm-note-wrap.playing .cfm-note-play`
- `.cfm-note-badge`
- `.chat-msg.mine .cfm-note-badge`
- `.chat-bubble.bubble-vnote .grp-sender-name`
- `.cfm-vid-box`
- `.cfm-vid-bar`
- `.cfm-vid-bar .cvb-progress`
- `.cfm-vid-bar .cvb-buf`
- `.cfm-vid-bar .cvb-fill`
- `.cfm-vid-bar .cvb-knob`
- … yana 42 ta
