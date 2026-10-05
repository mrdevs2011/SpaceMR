# SpaceMR

Yopiq oilaviy messenjer + lenta (PWA). ~50 yaqin odam uchun. Vanilla JS, Supabase, Vercel.
Arxitektura: `docs/ARCHITECTURE.md`.

## Nima qila oladi
- **Kirish:** faqat username + parol (email yo'q). Ro'yxatdan o'tgach hisob "kutish" holatida — admin tasdiqlaydi yoki rad etadi.
- **Lenta:** rasm/video/fayl post (≤ 49.9 MB; og'ir videolar yuklashda avtomatik siqiladi), like, izoh, markdown; hikoyalar (stories).
- **Chat:** 1v1, matn, ovozli xabar, fayl, reply, qidiruv, o'qildi belgisi, "yozmoqda", onlayn holat, Web Push.
- **Guruh:** faqat taklif orqali (yopiq). "Faqat adminlar yozadi" rejimi = eski kanal.
- **Qo'ng'iroq:** WebRTC audio/video, signalizatsiya Supabase Realtime orqali. TURN: Cloudflare (`/api/turn`, qisqa muddatli kredensial); sozlanmasa statik `TURN_*`, u ham bo'lmasa OpenRelay (beqaror).
- **Profil:** ism, username, avatar, bio.
- **Admin (MR):** ariza tasdiqlash/rad, bloklash (1 soat / 1 kun / 7 kun / doimiy), o'chirish, e'lon, **parol reset**, Storage sarfi qatori (`admin-storage.js`; RPC bo'lmasa jim).

Parol unutilsa: foydalanuvchi MR ga murojaat qiladi → admin panelda "Parolni almashtirish" → vaqtinchalik parol.

## Texnik asos
- Frontend: vanilla JS modullari (`modules/`), CSS `CSS/*.css` → `npm run build` → bitta `app.css` (qo'lda tahrirlanmaydi).
- Backend: Supabase — Auth, Postgres + RLS, Realtime, Storage (`media` bucket), Edge Functions (`send-push`, `admin-reset-password`).
- Xato jurnali: `modules/core/error-log.js` — oxirgi 20 xato localStorage'da; konsolda `__mrErrors()` (tozalash: `__mrErrorsClear()`).
- Service worker: `sw.js` (Web Push + cache; Firebase yo'q).
  `CACHE_VERSION` build vaqtida avtomatik yoziladi.
- Deploy: Vercel (`npm run build`).

## Sozlash
Vercel Environment Variables:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — majburiy (service_role hech qachon brauzerga tushmasin).
- `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` — Cloudflare TURN (`api/turn.js`, faqat serverda; kirgan foydalanuvchiga 24 soatlik kredensial beradi). Qo'ng'iroq uchun asosiy yo'l.
- Ixtiyoriy zaxira (statik, `scripts/build-env.mjs` o'qiydi): `TURN_URLS` (vergul bilan), `TURN_USERNAME`, `TURN_CREDENTIAL`. Hech biri bo'lmasa umumiy OpenRelay (beqaror).

Bazani o'rnatish: `supabase/migrations/` — `000_schema.sql`, keyin qolganlari raqam tartibida (`supabase/migrations/README.md`).
Testlar: `node tests/smoke.mjs` (Playwright, ixtiyoriy; tafsilot fayl boshida).
Hali ishga tushirilmagan patchlar `supabase/unfulfilled/` da — faqat 1 hafta kuzatuvdan keyin (roadmap 1-bo'lim, 3-qoida).

## Ish tartibi
1. Har vazifa = alohida branch/commit. Vizual CSS o'zgarishi brauzerda tekshirilmasdan commit qilinmaydi.
2. `docs/SMOKE.md` ni har deploydan oldin o'tkaz.
3. DB: avval kod deploy → 1 hafta → keyin `drop`. Har patch idempotent (`if exists`).
4. Tegilmaydigan zona: approval oqimi, RLS/`guard_*` triggerlar, `call.js`, `chat.js` asosiy logikasi.

## Qarorlar
- `media` bucket **public**. Havolalar tasodifiy UUID yo'lli, lekin bu haqiqiy maxfiylik emas (havolani olgan ochadi). Signed URL kerak bo'lsa — keyinroq (Q7).
- Like/comment counter triggerlari qoladi (Q8).

## Production

- Deploy: Vercel (`vercel.json` — build: bump-sw + build-env + build-css).
- SQL migratsiyalar: `supabase/migrations/` (repo da saqlanadi; CDN ga `.vercelignore` orqali chiqarilmaydi).
- CSS manba: `CSS/*.css` → `app.css` (`npm run build` / `node scripts/build-css.mjs`).

### URL himoya

- `.vercelignore` — SQL, docs, tests deployga umuman yuklanmaydi.
- `vercel.json` routes — `/supabase`, `/docs`, `/CSS`, `/scripts`, `*.sql`, `*.md` → **404**.
- Runtime ochiq: `index.html`, `app.css`, `modules/`, `svg/`, `icons/`, `api/`, `sw.js`.
