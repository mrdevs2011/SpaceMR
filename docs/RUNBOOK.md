# SpaceMR — RUNBOOK (operatsion)

Sana: 2026-10-07 · Deploy: Vercel (`spacemr.vercel.app`) · DB: Supabase

## 1. Deploy

1. PR → Preview (avtomatik). `docs/SMOKE.md` Preview da o'tkaziladi.
2. Merge `main` → Vercel Production.
3. Build Logs: env xatosi yo'qligini tekshir (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TURN_*`).
4. `modules/core/env.js` build vaqtida yoziladi (`scripts/build-env.mjs`) — faqat **anon** kalit.
5. Prod smoke: ro'yxat → admin tasdiq → post → chat → push → qo'ng'iroq.

**Rollback:** Vercel → Deployments → oldingi Production → **Promote**.

## 2. DB migratsiya

- Fayllar: `supabase/migrations/NNN_*.sql` (raqam tartibida).
- **Jonli bazaga faqat MR** (SQL editor yoki CLI).
- Har bir migratsiya idempotent (`if exists` / `if not exists`).
- Tartib: migratsiya → tekshiruv (SELECT / smoke) → keyingi.
- Misol (094): AVVAL SQL, KEYIN klient deploy (reaksiya path).

## 3. DB zaxira va tiklash

```bash
# Sozlash: ~/.spacemr-backup.env ichida SUPABASE_DB_URL
bash scripts/backup-db.sh
# Natija: ~/Claude/backups/spacemr/spacemr-YYYYmmdd-HHMM.dump

# Tiklash (bo'sh / yangi loyiha URL):
pg_restore --no-owner --clean --if-exists -d "$YANGI_BAZA_URL" fayl.dump
```

Storage (rasm/audio) **alohida** — bu skript faqat Postgres.

## 4. Parol reset (admin)

1. Admin panel → foydalanuvchi → parol tiklash.
2. RPC `admin_reset_user_password` / recovery code (24 soat).
3. User vaqtinchalik kod bilan kiradi → majburiy yangi parol.

## 5. Foydalanuvchini bloklash

- Admin panel → bloklash (muddat yoki doimiy).
- DB: `profiles` status / security lock RPClari (090–092).
- Bloklangan user RLS orqali o'qish/yozish qila olmasligi kerak.

## 6. Kalitlar rotatsiyasi

| Joy | Kalitlar |
|-----|----------|
| Vercel Production/Preview | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`, `KLIPY_KEY` |
| Supabase Edge secrets | `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*`, `PUSH_WEBHOOK_SECRET`, SMTP |

Rotatsiya: yangi qiymat → deploy/secret yangilash → eski bekor. **service_role brauzerga tushmasin.**

## 7. TURN ishlamasa

1. Admin → kalitlar tekshiruvi (`/api/keys-check` + Edge `admin-check-keys`).
2. Cloudflare TURN key/token.
3. Zaxira: `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` (ixtiyoriy).
4. Brauzer: mikrofon/kamera ruxsati.

## 8. Storage to'lsa (1 GB free)

1. Supabase Dashboard → Storage usage.
2. Eski media / o'chirilgan user fayllari.
3. Reja yangilash yoki yuklash limitini qattiqroq qilish (MR qarori).

## 9. Push ishlamasa

1. Edge `send-push`: `PUSH_WEBHOOK_SECRET`, VAPID.
2. DB webhook → `send-push`.
3. 404/410 obunalarni tozalash (send-push logika).
4. iOS: Add to Home Screen (PWA).

## 10. Xatolar

- Klient: `localStorage` + `client_errors` (sessiyada ≤5, RLS: insert o'zi, o'qish admin).
- Konsol: `__spaceErrors()`.
- Admin panelda xatolarni ko'rish (agar UI bor).

## 11. CSP eslatma

`script-src 'self' 'unsafe-inline'` — `index.html` inline skript va markdown `onclick` uchun.
Hash/nonce keyinroq; hozircha sabab: UI (spoiler, copy, mention).


## 11. Service Worker KILL_SWITCH

Masofadan buzilgan SW ni o'chirish:

1. Admin panel → foydalanuvchilarni yangilash (force-reload) yoki
2. Client ga `postMessage({ type: 'KILL_SWITCH' })` (sw.js tinglaydi).
3. Natija: SW unregister + cache tozalash + hard reload.
4. Kod: `modules/core/force-reload.js`, `sw.js` (`KILL_SWITCH` handler).

Sinov: bir marta Preview da force-reload yuborib, barcha tablar yangilangani.

## 12. Qora ekran / kirish ishlamasa

1. Foydalanuvchi: "Qayta yuklash" paneli → Tozalab qayta kirish.
2. SW: `navigator.serviceWorker.getRegistrations()` → unregister.
3. Vercel: oldingi Production → Promote (rollback).
4. SpaceMR guruhi orqali xabar (monitoring + aloqa).

## 13. Chat kelmasa / Realtime

1. Supabase Dashboard → Realtime status.
2. Brauzer: Network WebSocket ochiqmi.
3. RLS: user o'z chatiga o'qish huquqi.
4. Rollback faqat klient regressiyasi bo'lsa.

## 14. Deploy oldidan qisqa varaq (ROADMAP2)

- [ ] `node --check` o'zgargan JS; `node scripts/build-css.mjs`
- [ ] Preview: login → logout → qayta kirish; yopib ochish
- [ ] Telefon: home, chat, post yozish
- [ ] Desktop ≥1100px: header/panel takroriy tugmasiz
- [ ] Konsol CSP/modul xatosiz
- [ ] Rollback yo'li ma'lum (Vercel Promote previous)
