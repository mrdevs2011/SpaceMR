# Supabase audit (2026-10-08)

**Loyiha:** `dsomjkskgrhaaxpkdyvs` (linked) · CLI 2.117

## Migratsiyalar

- Local = remote: `000` … `104` (push muvaffaqiyatli).
- **102** — yangi user → SpaceMR guruhiga a'zo + backfill.
- **103** — `content_reports` (shikoyat): insert o'zi, select o'zi/admin, update faqat admin.
- **104** — `device_sessions` RLS `(select auth.uid())` (initplan).

## RLS

Barcha `public` jadvallarda **RLS = true** (28 jadval, shu jumladan `content_reports`).

## Anon

- Jadval huquqlari: **yo'q** (bo'sh).
- EXECUTE faqat login oqimi: `email_for_username`, `username_available`, `check_user_recovery`, `verify_recovery_code`, `reset_password_with_code`, `request_password_reset`, `server_now`.

## Advisors

| Level | Count | Izoh |
|-------|-------|------|
| ERROR | 0 | — |
| WARN auth_rls_initplan | ~50 | PERFORMANCE; 104 device_sessions tuzatildi |
| WARN security_definer executable | authenticated/anon | kutilgan (login + app RPC) |
| WARN leaked password protection | 1 | Auth dashboard sozlamasi (MR) |

## Storage

- `100_server_side_hardening` — MIME/path/hajm, SVG/HTML/exe taqiqi, UPDATE(move) ham.
- `095` — SVG block.

## Operatsion (faqat MR)

1. Auth: leaked password protection yoqish (Dashboard).
2. Zaxira: kunlik + bir marta tiklash mashqi.
3. Alohida prod loyiha (ixtiyoriy).
4. Jonli negativ RLS test (2 user).

## CLI buyruqlar

```bash
supabase migration list --linked
supabase db push --linked
supabase db query --linked "select …"
supabase db advisors --linked
supabase db dump --linked -f dump.sql   # sirni yashirish!
```
