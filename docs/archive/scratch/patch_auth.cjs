const fs = require('fs');
let code = fs.readFileSync('modules/auth/auth.js', 'utf8');

// 1. Change POST_LIMIT
code = code.replace(/const POST_LIMIT = \d+;/, 'const POST_LIMIT = 10;');

// 2. Add window.__fetchMorePosts
const insertStr = `
  window.__fetchMorePosts = async () => {
    if (state.loadingMoreDB || !state.allPosts?.length) return false;
    state.loadingMoreDB = true;
    try {
      const oldest = state.allPosts[state.allPosts.length - 1];
      if (!oldest?.createdAt) return false;
      const { data, error } = await sb.from('posts').select('*')
        .lt('created_at', new Date(oldest.createdAt).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);
      if (error || !data || data.length === 0) return false;
      
      let added = 0;
      for (const r of data) {
        if (!byId.has(r.id)) {
          byId.set(r.id, mapPost(r));
          added++;
        }
      }
      if (added > 0) _scheduleRender();
      return added > 0;
    } catch (e) {
      return false;
    } finally {
      state.loadingMoreDB = false;
    }
  };
`;

code = code.replace(/const load = async \(\) => {/, insertStr + '\n  const load = async () => {');
fs.writeFileSync('modules/auth/auth.js', code);
