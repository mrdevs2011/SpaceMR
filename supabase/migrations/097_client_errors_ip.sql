-- client_errors: rate-limit triggeri (038/047) `ip` ustunini o'qiydi, lekin jadvalda u yo'q edi
-- -> har insert 400 qaytarardi. Ustunni qo'shamiz (expand, xavfsiz).
alter table public.client_errors add column if not exists ip text;
