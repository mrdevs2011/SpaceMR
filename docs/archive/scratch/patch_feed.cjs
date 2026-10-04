const fs = require('fs');
let code = fs.readFileSync('modules/feed/feed.js', 'utf8');

const oldScroll = `  window.onscroll = () => {
    const maxN = filtered().length;
    if (state.loadingMore || state.visibleN >= maxN) return;
    if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 400) {
      state.loadingMore = true;
      setTimeout(async () => {
        const prevN = state.visibleN;
        state.visibleN = Math.min(prevN + 10, maxN);
        state.loadingMore = false;
        if (state.view !== 'home') return;

        const feedEl = $('feed');
        if (!feedEl) return;

        // Spinner'ni olib tashlaymiz
        feedEl.querySelector('.spin-wrap')?.remove();

        // Faqat yangi postlarni qo'shamiz (butun feed'ni qayta yozmaymiz)
        const newPosts = filtered().slice(prevN, state.visibleN);
        if (newPosts.length > 0) {
          await appendPostsToFeed(feedEl, newPosts);
        }

        if (state.visibleN < filtered().length) {
          feedEl.insertAdjacentHTML('beforeend', '<div class="spin-wrap"><div class="spinner"></div></div>');
        }
      }, 300);
    }
  };`;

const newScroll = `  window.onscroll = async () => {
    if (state.loadingMore) return;
    const maxN = filtered().length;
    if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 400) {
      if (state.visibleN >= maxN) {
        if (window.__fetchMorePosts && state.view === 'home' && !state.search) {
          state.loadingMore = true;
          const hasMore = await window.__fetchMorePosts();
          state.loadingMore = false;
          if (!hasMore) {
            $('feed')?.querySelector('.spin-wrap')?.remove();
          }
        }
        return;
      }

      state.loadingMore = true;
      setTimeout(async () => {
        const prevN = state.visibleN;
        state.visibleN = Math.min(prevN + 10, filtered().length);
        state.loadingMore = false;
        if (state.view !== 'home') return;

        const feedEl = $('feed');
        if (!feedEl) return;

        feedEl.querySelector('.spin-wrap')?.remove();

        const newPosts = filtered().slice(prevN, state.visibleN);
        if (newPosts.length > 0) {
          await appendPostsToFeed(feedEl, newPosts);
        }

        if (state.visibleN < filtered().length || (window.__fetchMorePosts && !state.search)) {
          feedEl.insertAdjacentHTML('beforeend', '<div class="spin-wrap"><div class="spinner"></div></div>');
        }
      }, 300);
    }
  };`;

code = code.replace(oldScroll, newScroll);
fs.writeFileSync('modules/feed/feed.js', code);
