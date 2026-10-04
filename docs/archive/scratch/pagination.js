export async function loadMorePosts() {
  if (state.loadingPostsFromDB) return;
  state.loadingPostsFromDB = true;
  
  try {
    const oldestPost = state.allPosts.length ? state.allPosts[state.allPosts.length - 1] : null;
    let query = sb.from('posts').select('*').order('created_at', { ascending: false }).limit(15);
    
    if (oldestPost && oldestPost.createdAt) {
      query = query.lt('created_at', new Date(oldestPost.createdAt).toISOString());
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    if (data && data.length > 0) {
      const newPosts = data.map(r => mapPost(r));
      state.allPosts.push(...newPosts);
      
      // Cache
      if (state.me?.uid) {
        import('./auth.js').then(m => m.cachePosts(state.me.uid, state.allPosts));
      }
      
      // Update byId in auth.js? We need a way to add them to byId
      // Actually we can just dispatch an event!
      document.dispatchEvent(new CustomEvent('postsLoadedFromDB', { detail: newPosts }));
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[feed] loadMorePosts:', err.message);
    return false;
  } finally {
    state.loadingPostsFromDB = false;
  }
}
