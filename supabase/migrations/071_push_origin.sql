-- Bitta foydalanuvchi bir nechta domendan (spacemr / mrspace / mrgram ...) kirsa, har biri alohida push obunasi
-- yaratadi va bitta xabar 3 marta keladi. Obunaga qaysi domendan kelgani yoziladi (origin);
-- send-push foydalanuvchida asosiy domen obunasi bo'lsa — faqat shunga yuboradi.
alter table public.push_tokens add column if not exists origin text;

drop function if exists public.register_push_token(text, text);
create or replace function public.register_push_token(p_token text, p_platform text default null, p_origin text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tizimga kirilmagan'; end if;
  insert into public.push_tokens (token, user_id, platform, origin)
  values (p_token, auth.uid(), p_platform, left(p_origin, 200))
  on conflict (token) do update
    set user_id  = auth.uid(),
        platform = excluded.platform,
        origin   = coalesce(excluded.origin, public.push_tokens.origin);
end $$;
grant execute on function public.register_push_token(text, text, text) to authenticated;
