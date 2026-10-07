-- Username o'zgartirish ham 1 soatlik yangi-login lock ostida

drop function if exists public.change_my_username(text);
drop function if exists public.change_my_username(text, text);

create or replace function public.change_my_username(
  p_new_username text,
  p_device_id text default null
)
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_clean text;
  v_old text;
  v_new_email text;
  v_exists boolean;
  v_lock int;
begin
  if v_uid is null then
    raise exception 'Avtorizatsiyadan o''tilmagan';
  end if;

  if p_device_id is null or length(trim(p_device_id)) < 8 then
    raise exception 'Xavfsizlik: qurilma identifikatori kerak';
  end if;

  v_lock := public.security_lock_remaining(trim(p_device_id));
  if v_lock > 0 then
    raise exception 'Xavfsizlik: yangi kirishdan keyin % daqiqa kuting (username)', greatest(1, ceil(v_lock / 60.0)::int);
  end if;

  v_clean := lower(trim(coalesce(p_new_username, '')));
  v_clean := regexp_replace(v_clean, '[^a-z0-9_]', '', 'g');

  if length(v_clean) < 2 then
    raise exception 'Username kamida 2 ta belgi bo''lishi kerak';
  end if;
  if length(v_clean) > 20 then
    raise exception 'Username 20 ta belgidan oshmasligi kerak';
  end if;

  select username into v_old from public.profiles where id = v_uid;
  if v_old is null then
    raise exception 'Profil topilmadi';
  end if;

  if v_clean = v_old then
    return json_build_object('ok', true, 'username', v_clean, 'unchanged', true);
  end if;

  select exists(
    select 1 from public.profiles where username = v_clean and id <> v_uid
  ) into v_exists;
  if v_exists then
    raise exception 'Bu username band';
  end if;

  -- groups bilan solishtirmaymiz (alohida namespace, 060)
  v_new_email := v_clean || '@gmail.com';

  update public.profiles
  set username = v_clean,
      email = v_new_email
  where id = v_uid;

  update auth.users
  set email = v_new_email,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where id = v_uid;

  return json_build_object('ok', true, 'username', v_clean, 'email', v_new_email);
end;
$$;

revoke all on function public.change_my_username(text, text) from public, anon;
grant execute on function public.change_my_username(text, text) to authenticated;
