-- Profil telefon raqami (UI da hozircha 1 ta; DB da cheklov yo'q — kelajakda ko'proq mumkin)
alter table public.profiles
  add column if not exists phone text;

comment on column public.profiles.phone is 'O''zbekiston telefon raqami (+998...), ixtiyoriy';
comment on column public.profiles.website is 'Foydalanuvchi veb-sayti URL, ixtiyoriy';
