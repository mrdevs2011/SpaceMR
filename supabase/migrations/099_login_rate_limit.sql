-- Login rate limit: 8 urinish / 15 daqiqa juda qattiq edi — to'g'ri parol ham
-- rate-limit da email_for_username null qaytarib kirishni yopardi.
-- 40 / 15 daqiqa + 0.05s delay saqlanadi (enumeration sekin).

create or replace function public.email_for_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
  v_lookups int;
  v_last timestamptz;
  v_email text;
begin
  perform pg_sleep(0.05);
  begin
    v_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
    if v_ip is null then v_ip := 'unknown';
    else v_ip := 'eu:' || split_part(v_ip, ',', 1);
    end if;
  exception when others then
    v_ip := 'unknown';
  end;

  if random() < 0.01 then
    delete from public.anon_rate_limits where last_lookup < now() - interval '1 hour';
  end if;

  select lookups, last_lookup into v_lookups, v_last
  from public.anon_rate_limits where ip = v_ip;

  if v_lookups is not null then
    if v_lookups >= 40 and v_last > now() - interval '15 minutes' then
      return null;
    elsif v_lookups >= 40 then
      update public.anon_rate_limits set lookups = 1, last_lookup = now() where ip = v_ip;
    else
      update public.anon_rate_limits set lookups = lookups + 1, last_lookup = now() where ip = v_ip;
    end if;
  else
    insert into public.anon_rate_limits (ip) values (v_ip)
    on conflict (ip) do update set lookups = 1, last_lookup = now();
  end if;

  select email into v_email from public.profiles where username = lower(trim(p_username));
  return v_email;
end;
$$;

revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated, service_role;
