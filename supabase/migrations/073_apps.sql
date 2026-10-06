-- 073: Ilovalar (Apps) — foydalanuvchilar yuklagan HTML ilovalar + kategoriyalar.
-- URL: /apps, /apps/<kategoriya>, /apps/<kategoriya>/<ilova>. Hamma (tasdiqlangan) foydalanuvchi ko'radi;
-- ilova/kategoriyani faqat egasi (yoki admin) tahrirlaydi/o'chiradi.
-- Unikal nom (slug) kategoriya va ilovalar uchun UMUMIY nomlar fazosi (/apps/<x> bir ma'noli bo'lishi uchun).

create table if not exists public.app_categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  owner_id   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint app_categories_slug_chk check (slug ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  constraint app_categories_name_chk check (char_length(btrim(name)) between 1 and 40)
);

create table if not exists public.apps (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  category_id uuid not null references public.app_categories(id) on delete restrict,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  html        text not null,
  logo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint apps_slug_chk check (slug ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  constraint apps_name_chk check (char_length(btrim(name)) between 1 and 40),
  constraint apps_desc_chk check (char_length(description) <= 200),
  constraint apps_html_chk check (octet_length(html) between 1 and 1000000),
  constraint apps_logo_chk check (logo is null or (logo ~ '^data:image/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$' and char_length(logo) <= 120000))
);
create index if not exists apps_category_idx on public.apps (category_id);
create index if not exists apps_owner_idx on public.apps (owner_id);

-- Nomlar fazosi + egasi o'zgarmasligi + limitlar
create or replace function public.apps_namespace_guard() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare cnt int;
begin
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then raise exception 'Unikal nom o''zgarmaydi'; end if;
    new.owner_id := old.owner_id;
    return new;
  end if;
  if new.slug in ('new','edit','mine','all','create','categories','category','admin','api','apps') then
    raise exception 'Bu nom band';
  end if;
  if tg_table_name = 'apps' then
    if exists (select 1 from public.app_categories where slug = new.slug) then raise exception 'Bu nom band'; end if;
    select count(*) into cnt from public.apps where owner_id = new.owner_id;
    if cnt >= 50 then raise exception 'Ilovalar limiti (50) to''ldi'; end if;
  else
    if exists (select 1 from public.apps where slug = new.slug) then raise exception 'Bu nom band'; end if;
    select count(*) into cnt from public.app_categories where owner_id = new.owner_id;
    if cnt >= 20 then raise exception 'Kategoriyalar limiti (20) to''ldi'; end if;
  end if;
  return new;
end $$;

create or replace function public.apps_touch_updated() returns trigger
  language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists tr_apps_ns on public.apps;
create trigger tr_apps_ns before insert or update on public.apps
  for each row execute function public.apps_namespace_guard();
drop trigger if exists tr_apps_touch on public.apps;
create trigger tr_apps_touch before update on public.apps
  for each row execute function public.apps_touch_updated();
drop trigger if exists tr_app_categories_ns on public.app_categories;
create trigger tr_app_categories_ns before insert or update on public.app_categories
  for each row execute function public.apps_namespace_guard();

-- RLS
alter table public.app_categories enable row level security;
alter table public.apps enable row level security;

drop policy if exists app_categories_select on public.app_categories;
create policy app_categories_select on public.app_categories for select to authenticated
  using (public.is_approved() or public.is_admin());
drop policy if exists app_categories_insert on public.app_categories;
create policy app_categories_insert on public.app_categories for insert to authenticated
  with check (owner_id = auth.uid() and public.is_approved());
drop policy if exists app_categories_update on public.app_categories;
create policy app_categories_update on public.app_categories for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists app_categories_delete on public.app_categories;
create policy app_categories_delete on public.app_categories for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists apps_select on public.apps;
create policy apps_select on public.apps for select to authenticated
  using (public.is_approved() or public.is_admin());
drop policy if exists apps_insert on public.apps;
create policy apps_insert on public.apps for insert to authenticated
  with check (owner_id = auth.uid() and public.is_approved());
drop policy if exists apps_update on public.apps;
create policy apps_update on public.apps for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists apps_delete on public.apps;
create policy apps_delete on public.apps for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.app_categories to authenticated;
grant select, insert, update, delete on public.apps to authenticated;
grant all on public.app_categories to service_role;
grant all on public.apps to service_role;
