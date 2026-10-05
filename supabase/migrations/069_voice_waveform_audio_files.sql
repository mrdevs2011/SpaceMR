-- 069: Ovozli xabar TO'LQINI serverda saqlanadi; yuklangan audio fayl (mp3...) — to'lqinsiz, oddiy progress chiziq.
--  * messages.waveform / group_messages.waveform  smallint[]  (har element 0..31, 8..128 ta) — FAQAT type='voice' uchun.
--  * type='file' (mp3, m4a, wav... yuklangan audio) uchun waveform HECH QACHON saqlanmaydi (trigger null qiladi).
--  * type='voice' faqat '{uid}/chat-voice/' papkasidan bo'lishi shart (yozib olingan ovoz).
-- Eski qatorlarga tegilmaydi (waveform = null → klient ovozni decode qilib chizadi). Idempotent.

alter table public.messages       add column if not exists waveform smallint[];
alter table public.group_messages add column if not exists waveform smallint[];

create or replace function public.enforce_voice_waveform()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);
  n int;
begin
  -- Fayl/matn xabarida to'lqin bo'lmaydi (mp3 yuklansa ham — faqat progress chiziq)
  if coalesce(j->>'type', '') <> 'voice' then
    new.waveform := null;
    return new;
  end if;

  -- Yozib olingan ovoz faqat chat-voice papkasidan
  if new.media_path is not null and new.media_path !~ '^[^/]+/chat-voice/' then
    raise exception 'Ovozli xabar faqat chat-voice papkasidan bo''lishi kerak' using errcode = '22023';
  end if;

  if new.waveform is null then
    return new;
  end if;

  n := coalesce(array_length(new.waveform, 1), 0);
  if n < 8 or n > 128 then
    new.waveform := null;           -- yaroqsiz uzunlik: klient decode qilib chizadi
    return new;
  end if;

  -- qiymatlarni 0..31 oralig'iga siqamiz
  new.waveform := (
    select array_agg(least(greatest(coalesce(x, 0), 0), 31)::smallint)
    from unnest(new.waveform) as x
  );
  return new;
end $$;

drop trigger if exists trg_enforce_voice_waveform on public.messages;
create trigger trg_enforce_voice_waveform
  before insert or update of type, media_path, waveform on public.messages
  for each row execute function public.enforce_voice_waveform();

drop trigger if exists trg_enforce_voice_waveform on public.group_messages;
create trigger trg_enforce_voice_waveform
  before insert or update of type, media_path, waveform on public.group_messages
  for each row execute function public.enforce_voice_waveform();
