/* Like: UI shu zahoti o'zgaradi, server bilan sinxronlash orqa fonda.
   Bir post uchun bir vaqtda bitta so'rov; tez-tez bosilsa faqat oxirgi istalgan holat yuboriladi.
   Xato bo'lsa — onFail(serverHolati, meta) bilan UI serverdagi haqiqiy holatga qaytariladi. */
import { sb } from '../core/config.js';

const jobs = new Map(); // postId -> { server, want, onFail, meta }

export function syncLike(postId, uid, wasLiked, want, onFail, meta) {
  const cur = jobs.get(postId);
  if (cur) { cur.want = want; cur.onFail = onFail; return; }
  const j = { server: wasLiked, want, onFail, meta };
  jobs.set(postId, j);
  (async () => {
    try {
      while (j.server !== j.want) {
        const target = j.want;
        if (target) {
          const { error } = await sb.from('post_likes').insert({ post_id: postId, user_id: uid });
          if (error && error.code !== '23505') throw error; // 23505 = allaqachon like
        } else {
          const { error } = await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', uid);
          if (error) throw error;
        }
        j.server = target;
      }
    } catch (e) {
      console.warn('[Like] saqlanmadi:', e?.message || e);
      try { j.onFail?.(j.server, j.meta); } catch (_) {}
    } finally {
      jobs.delete(postId);
    }
  })();
}
