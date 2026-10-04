import fs from 'fs';

let profileCode = fs.readFileSync('modules/profile/profile.js', 'utf8');

const htmlToReplace = `      \${ud.bio ? \`<div class="up-bio">\${esc(ud.bio)}</div>\` : ''}
      <div class="up-stats">`;

const replacementHtml = `      \${ud.bio ? \`<div class="up-bio">\${esc(ud.bio)}</div>\` : ''}
      <div style="display:flex; justify-content:center; margin-top:12px;">
        <button id="upChatBtn" style="background:var(--accent, #007bff); color:#fff; border:none; padding:8px 20px; border-radius:24px; font-weight:600; font-size:14px; cursor:pointer; display:flex; align-items:center; gap:6px; transition:opacity 0.2s;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
          Chat yozish
        </button>
      </div>
      <div class="up-stats">`;

profileCode = profileCode.replace(htmlToReplace, replacementHtml);

const jsToReplace = `  // Avatar rasmini kattalashtirish (boshqa user profili)`;

const replacementJs = `  const upChatBtn = document.getElementById('upChatBtn');
  if (upChatBtn) {
    upChatBtn.addEventListener('click', async () => {
      $('userProfileModal').classList.remove('show');
      const { switchView } = await import('../ui/ui.js');
      switchView('chats');
      const { openChatThread } = await import('../chat/chat.js');
      openChatThread(uid);
    });
  }

  // Avatar rasmini kattalashtirish (boshqa user profili)`;

profileCode = profileCode.replace(jsToReplace, replacementJs);

fs.writeFileSync('modules/profile/profile.js', profileCode);
