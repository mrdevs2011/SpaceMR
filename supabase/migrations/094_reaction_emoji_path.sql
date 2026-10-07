-- 094 (2026-10-07): reaksiya emojisi bazada RASM/BELGI emas, faqat PNG PATH sifatida saqlanadi.
-- Format: emoji/2d/<kalit>.png  (kalit = kodpointlar kichik harf hex, '-' bilan; FE0F tashlangan)  masalan  emoji/2d/1f525.png
-- Klient: modules/chat/msg-reactions.js + modules/ui/emoji-img.js (path'dan <img> real vaqtda chiziladi).
-- Idempotent. Tartib: AVVAL shu SQL ni yurgizing, KEYIN klientni deploy qiling
-- (eski 063 cheklovi 16 belgi — path 18+ belgi, shuning uchun cheklov kengaytiriladi).

-- 1) eski cheklovni olib tashlaymiz
alter table public.message_reactions drop constraint if exists message_reactions_emoji_check;

-- 2) mavjud qatorlar: belgi -> path
update public.message_reactions r
   set emoji = 'emoji/2d/' || (
     select string_agg(to_hex(ascii(ch)), '-' order by ord)
       from regexp_split_to_table(r.emoji, '') with ordinality as t(ch, ord)
      where ch <> E'\uFE0F'
   ) || '.png'
 where emoji not like 'emoji/2d/%';

-- 3) yangi qat'iy cheklov: faqat PNG path
alter table public.message_reactions
  add constraint message_reactions_emoji_check
  check (char_length(emoji) <= 96 and emoji ~ '^emoji/2d/[0-9a-f]{2,6}(-[0-9a-f]{2,6})*\.png$');
