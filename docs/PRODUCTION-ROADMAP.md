# SpaceMR — PRODUCTION ROADMAP (Grok uchun topshiriq)

Sana: 2026-10-07 · Egasi: MR (Muhammadrasul Qosimov) · Repo: `mrdevs2011/spacemr` · Deploy: Vercel (`spacemr.vercel.app`)
Maqsad: SpaceMR ni bugun production'ga chiqarish — **o'lchanadigan "Tayyor" mezonlari (9-bo'lim) 100% bajarilgan holatda**.
Ilova: yopiq oilaviy messenjer + lenta (PWA), ~50 foydalanuvchi. Stack: vanilla JS (ESM, ~35k qator `modules/`), Supabase (Auth, Postgres+RLS, Realtime, Storage, Edge Functions), Vercel (`api/*.js` serverless), Cloudflare TURN.

Avval o'qi: `README.md`, `docs/ARCHITECTURE.md`, `docs/SMOKE.md`, `STATUS.md`, `docs/MR-QOLGAN.md`, `supabase/migrations/README.md`.

---

## 0. Qat'iy qoidalar (buzilmaydi)

1. **Sirlar:** kalit/token/parolni hech qachon chatga, logga, commitga yozma. `service_role` brauzerga tushmasin. `.env*` gitda yo'q (tekshir). Sir topilsa — darhol MR ga ayt, rotatsiya MR qiladi.
2. **DB:** hech qachon jonli bazada `drop`/`truncate`/`delete` ni zaxirasiz yurgizma. Har migratsiya idempotent (`if exists`/`if not exists`), yangi raqam bilan (`094_...sql`). Jonli bazaga SQL'ni faqat MR yurgizadi (Supabase SQL editor / CLI) — sen faylni tayyorlab, qanday yurgizishni yozasan.
3. **Tegilmaydigan zona** (MR ruxsatisiz refaktor yo'q): approval oqimi, RLS/`guard_*` triggerlar, `modules/call/call.js`, `modules/chat/chat.js` va `groups.js` asosiy logikasi. Bularda faqat bug-fix + test bilan.
4. **Bir vazifa = bir branch = bir commit** (`feat/prod-<nom>`), `main` ga to'g'ridan-to'g'ri yo'q. Commit/push: `GIT_ASKPASS="$HOME/.gh-askpass.sh" GIT_TERMINAL_PROMPT=0`.
5. **CSS:** `CSS/*.css` tahrirlanadi, `app.css` faqat `npm run build` bilan yig'iladi (qo'lda tahrirlanmaydi). Vizual o'zgarish brauzerda (mobil + desktop) ko'rilmasdan "tayyor" deyilmaydi.
6. **0% kesh talabi:** service worker sahifa/runtime keshlamaydi (`STATUS.md`). Buni o'zgartirma, o'zgartirish kerak bo'lsa MR dan so'ra.
7. **Hisobot formati** (har bosqich oxirida): nima qilindi · qanday tekshirildi (buyruq/natija) · nima qoldi · MR qarori kerak bo'lgan savollar.
8. Noaniq bo'lsa — taxmin qilib bajar va taxminni bir jumlada yoz; faqat qaytarib bo'lmas ish (DB, force-push, o'chirish) uchun to'xtab so'ra.

---

## 1. Bosqich 0 — Muzlatish va asos (1 soat)

- [ ] Ishchi daraxtdagi o'zgarishlarni ko'rib chiq va commit qil: yangi profil dizayni (`CSS/profile-pro.css`, `index.html`, `profile.js`), emoji→SVG (`install-guide.js`, `apps.js`, `upload.js`, `sw.js`), `/apps` tabi, `073_apps.sql`. Har biri alohida commit.
- [ ] `git tag pre-prod-2026-10-07`.
- [ ] Bazaning to'liq zaxirasi: `scripts/backup-db.sh` (yoki `supabase db dump`) → xavfsiz joyga; zaxiradan qayta tiklash mumkinligini **bo'sh test loyihada sinab ko'r**.
- [ ] Baseline: `npm run build`, `node tests/smoke.mjs`, `node tests/rt-mesh.mjs`, `node tests/flags.mjs`, `node tests/store-policy.mjs` — natijalarni yoz (qaysi biri o'tmasa — sababi).
- [ ] `073_apps.sql` bazada ishga tushirilganmi tekshir (MR ga so'ra). Ishga tushmagan bo'lsa `/apps` tabi prod'da yashirilsin yoki migratsiya yurgizilsin.

## 2. Bosqich 1 — Xavfsizlik (P0, deploydan oldin majburiy)

### 2.1 Supabase / RLS
- [ ] Barcha `public` jadvallarda RLS yoqilganini tekshir (`select relname from pg_class where relrowsecurity = false` — `public` ichida). Yo'q bo'lsa — migratsiya.
- [ ] Har jadval uchun policy'larni qo'lda audit qil: `profiles`, `posts`, `comments`, `chats/messages`, `groups/group_members`, `stories`, `push_subscriptions`, `device_sessions`, apps jadvallari (`073`). Maqsad: **begona foydalanuvchi boshqaning xabarini/postini/obunasini o'qiy/yoza/o'chira olmasin**. Har jadval uchun ikki foydalanuvchi bilan negativ test yoz (A → B ma'lumotiga so'rov → rad).
- [ ] "Kutish"/"rad etilgan"/"bloklangan" foydalanuvchi **hech narsani** (o'qish ham, yozish ham) qila olmasligini DB darajasida tekshir (faqat UI emas).
- [ ] `security definer` funksiyalar: `search_path` belgilangan, kirish parametrlari tekshirilgan, `anon` ga `execute` berilmagan (faqat kerakli RPC'lardan tashqari).
- [ ] Storage: `media` bucket policy — yuklash faqat tasdiqlangan user, o'z papkasiga; o'chirish faqat egasi/admin; MIME va hajm cheklovi server tomonda (faqat klientda emas).
- [ ] Edge Functions (`send-push`, `admin-reset-password`): chaqiruvchi autentifikatsiyasi va admin roli server tomonda tekshiriladi; CORS faqat o'z domeni.
- [ ] Supabase Auth sozlamalari: parol minimal uzunligi, rate limit (login/signup), "email confirm" siyosati ilova modeliga mos (username+parol), anon sign-in o'chiq.

### 2.2 Vercel `api/*`
- [ ] `api/turn.js`: faqat kirgan (JWT tekshirilgan) foydalanuvchiga; kredensial 24 soatdan oshmasin; token xatoda leak bo'lmasin.
- [ ] `api/keys-check.js`, `api/gifs.js`, `api/shell.js`: nima qilishini tekshir; **prod'da sirlarni/ichki holatni ochiq qaytarmasligini** isbotla; keraksiz bo'lsa — o'chir yoki auth ortiga ol. Rate limit qo'sh.
- [ ] Barcha endpoint'larda: metod cheklovi, input validatsiya, xato matnida stack/sir yo'q.

### 2.3 Brauzer xavfsizligi
- [ ] **XSS audit:** `innerHTML` / template string bilan HTML yasaydigan hamma joy (`grep -rn "innerHTML"`) — foydalanuvchi matni `esc()` dan o'tganini tekshir. Alohida diqqat: markdown renderer (`renderMarkdown`), post caption, izoh, chat bubble, profil (ism/bio/website — `javascript:` URL), guruh nomi/tavsifi, bildirishnoma matni, admin e'lon.
- [ ] Profil `website` va barcha foydalanuvchi linklari: faqat `http(s):` ruxsat.
- [ ] **Apps (`modules/apps/runner.js`):** iframe sandbox'da `allow-same-origin` YO'Q ekanini tasdiqla; ilova kodi `supabase` sessiyasi/`localStorage` ga yetmasligini sinab ko'r; CSP `frame-src` va `postMessage` origin tekshiruvi. Ishonchli bo'lmasa — `/apps` ni prod'da o'chirib qo'y (feature flag).
- [ ] **CSP kuchaytirish:** hozir `script-src 'self' 'unsafe-inline'`. Inline `<script>`/`onclick=` lar bor-yo'qligini aniqla; imkon bo'lsa `unsafe-inline` ni olib tashla (hash/nonce yoki inline'ni tashqi faylga ko'chir). Imkonsiz bo'lsa — sababini hujjatla. `img-src https:` ni kerakli domenlargacha toraytirish mumkinmi, ko'r.
- [ ] Sarlavhalar (`vercel.json`) saqlansin: HSTS, nosniff, DENY frame, COOP/CORP. `Permissions-Policy` da faqat kerakli (camera/microphone self).
- [ ] Yuklash validatsiyasi: kengaytma ≠ MIME ≠ haqiqiy tarkib; fayl nomi sanitizatsiyasi; SVG yuklash taqiqlangan yoki tozalangan (SVG ichida script).
- [ ] Login brute-force va ro'yxatdan o'tish spami: server tomonda cheklov (Supabase rate limit / Edge Function / CAPTCHA kerak bo'lsa MR bilan kelish).
- [ ] Qurilma sessiyalari (`088-092`): kirish bloklash/revoke ishlashini sinab ko'r (eski token bilan so'rov rad etilsin).

### 2.4 Sirlar va bog'liqliklar
- [ ] Git tarixida sir qidir (`gitleaks`/`trufflehog` yoki `git log -p | grep` — kalit naqshlari). Topilsa — MR ga ayt (rotatsiya).
- [ ] `npm audit` (faqat `jsdom` dev bog'liqlik), `package-lock.json` yangilangan.
- [ ] Prod Vercel env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` — Production da bor; **Preview va Production alohida**; `service_role` Vercel env da brauzerga yetadigan joyda yo'q (`scripts/build-env.mjs` faqat anon yozishini tasdiqla).
- [ ] Prod uchun alohida Supabase loyiha yoki hech bo'lmasa staging nusxa (tavsiya). MR bilan kelish.

## 3. Bosqich 2 — Ishonchlilik va ma'lumot

- [ ] **Bo'sh bazadan qurish testi:** yangi Supabase loyihada `000_schema.sql` + `001…093` (+ yangi) raqam tartibida xatosiz ishlaydimi. Xato bo'lsa — migratsiyani tuzat (idempotent qil).
- [ ] Zaxira siyosati: kunlik avtomatik dump (Supabase plan imkonicha / `backup-db.sh` cron) + qayta tiklash runbook'i (`docs/RUNBOOK.md`).
- [ ] **Storage kvotasi:** Supabase bepul reja 1 GB — hozirgi sarf va o'sish prognozi; limitga yetganda nima bo'ladi (yuklash xatosi UX'i, admin ogohlantirish). Qaror MR ga: rejani yangilash yoki siqish siyosati.
- [ ] DB indekslar: asosiy so'rovlar (chat xabarlar sahifalash, lenta, unread, guruh a'zolari) uchun `explain analyze`; yetishmayotgan indekslar migratsiyasi.
- [ ] Realtime: kanal soni/obuna limiti, ulanish uzilganda qayta ulanish va xabar yo'qolmasligi (`rt-mesh.mjs`, `074-076` sync).
- [ ] Yuk testi: `node tests/load-50.mjs` (50 bir vaqtdagi foydalanuvchi) — xato 0, p95 javob vaqti natijasini yoz.
- [ ] **Xato monitoringi:** `error-log.js` hozir faqat localStorage. Prod uchun — xatolarni serverga yuborish (kichik `client_errors` jadvali + RLS: faqat insert, faqat admin o'qiydi; rate-limit; PII yo'q) yoki Sentry. Admin panelda ko'rish.
- [ ] **Uptime:** `/` va `/api/turn` (auth'siz health) uchun tashqi monitor (UptimeRobot yoki shunga o'xshash) — MR bilan sozlash.
- [ ] Push: `send-push` ishonchliligi (xato obunalarni tozalash 404/410), iOS PWA (Add to Home Screen) da sinov.

## 4. Bosqich 3 — Tezlik va hajm

Hozirgi holat: `app.css` ≈ 676 KB (17.9k qator), `modules/` ≈ 35k qator JS (ESM, ko'p so'rov), `emoji/` ≈ 49 MB (.webp), repo ≈ 153 MB.
- [ ] **Build bosqichi:** JS/CSS minify (esbuild yoki shunga o'xshash, kutubxonasiz qolishi shart emas, lekin sodda va ishonchli bo'lsin) — `vercel.json` buildCommand'ga qo'sh; manba fayllar o'zgarmaydi. Maqsad: app.css gzip ≤ 120 KB, birinchi yuklanishda JS gzip ≤ 350 KB.
- [ ] CSS: ishlatilmaydigan qoidalarni aniqlash (`scripts/css-inventory.mjs`), dublikat/`!important` qatlamlarini qisqartirish — **faqat vizual regressiyasiz** (oldin/keyin skrinshotlar).
- [ ] Kritik yo'l: birinchi ekran uchun zarur modullarni darhol, qolganini (`admin`, `call`, `apps`, `emoji-*`, `explore`) lazy (`import()`) yuklash.
- [ ] **Emoji aktivlari (49 MB):** MR qarori kutilyapti (reaksiya/picker SVG ga o'tadimi yoki o'chadimi). Qaror bo'yicha: ishlatilmaydigan atlas/webp ni deploydan chiqar (`.vercelignore`/`outputDirectory` ni toraytirish) — `outputDirectory: "."` hozir hamma narsani, jumladan `scratch/`, `tests/`, `docs/*.mp4`, `node_modules`siz bo'lsa ham, deploy qilishi mumkin: **deploy bo'ladigan fayllarni tekshir va keraksizini yop** (`docs/camera-ui-ad.mp4`, `scratch/`, `camera-demo.html`, `.env*`, `supabase/` SQL'lari ochiq URL orqali yuklab olinmasin!).
- [ ] Rasm/video: yuklashda siqish bor; ko'rsatishda `loading="lazy"`, `decoding="async"`, o'lcham atributlari (CLS).
- [ ] Lighthouse (mobil, 4G throttling) maqsadi: Performance ≥ 85, Accessibility ≥ 90, Best Practices ≥ 95, PWA o'tgan. Natijani yoz.

## 5. Bosqich 4 — Mahsulot to'liqligi va sifat

- [ ] **Vizual QA** (mobil 360/390/430, planshet 768, desktop 1280/1920; dark/light): login, kutish ekrani, lenta, post yaratish, chatlar, chat oynasi, guruh, qo'ng'iroq, profil (yangi dizayn), sozlamalar, admin, apps. Har ekran: yuklanish / bo'sh / xato holati.
- [ ] **Profil sahifasi:** `CSS/profile-pro.css` dizayni barcha breakpoint'da to'g'ri; boshqa foydalanuvchi profili modali (`#userProfileModal`) va guruh/chatdan ochiladigan profil ham shu darajada (hozir faqat o'z profili yangilangan).
- [ ] **Emoji → SVG:** interfeys emojilari tugagan. Qolgani — reaksiyalar/picker: MR qarori bo'yicha bajar (agar SVG reaksiyalarga o'tilsa: eski emoji reaksiyalarni xaritalash migratsiyasi, eski xabarlar buzilmasin).
- [ ] **Accessibility:** `*:focus { outline: none }` kabi qoidalar klaviatura foydalanuvchisini yo'qotadi — `:focus-visible` uchun ko'rinadigan halqa; tugmalarda `aria-label`; kontrast ≥ 4.5:1 (xira matn `--text3`); `prefers-reduced-motion` hurmat; tab tartibi; modal fokus tuzog'i va Esc.
- [ ] **PWA:** `manifest.json` — `maskable` ikonka hozir oddiy ikonkaning o'zi (xavfsiz zonasiz): alohida maskable ikonka; skrinshotlar; `404.html` offline/xato sahifa; yangi versiya chiqqanda yangilanish xabari (`force-reload` oqimi) ishlashi.
- [ ] **Matn/til:** barcha UI matnlari bir xil o'zbek lotin imlosida; xato xabarlari tushunarli (texnik matn yo'q).
- [ ] Brauzerlar: iOS Safari (PWA), Android Chrome, desktop Chrome/Firefox/Safari — asosiy oqimlar.
- [ ] Qo'ng'iroq: Wi-Fi ↔ mobil tarmoq audio/video (TURN), mikrofon/kamera ruxsati rad etilgan holat.

## 6. Bosqich 5 — Qonuniy va operatsion

- [ ] Maxfiylik siyosati va foydalanish shartlari (qisqa, oddiy tilda; yopiq oilaviy ilova ekanini yoz): qanday ma'lumot saqlanadi (xabarlar, media, telefon, qurilma sessiyalari), kim ko'ra oladi (admin), o'chirish qanday. Ilova ichida havola.
- [ ] Hisobni o'chirish va ma'lumotni eksport qilish yo'li (hech bo'lmasa admin orqali, hujjatlangan).
- [ ] **Runbook** `docs/RUNBOOK.md`: deploy, rollback (Vercel "Promote previous"), DB tiklash, parol reset, foydalanuvchini bloklash, kalitlar rotatsiyasi, TURN ishlamasa, storage to'lsa, push ishlamasa.
- [ ] Domen: `spacemr.vercel.app` qoladimi yoki maxsus domen (MR qarori). Maxsus domen bo'lsa — CSP `connect-src`, Supabase Auth redirect URL, manifest `start_url/scope`, push VAPID subject yangilanadi.
- [ ] Admin: kamida 2 ta admin yoki MR akkauntini tiklash yo'li (bitta akkaunt yo'qolsa tizim qulflanmasin).

## 7. Bosqich 6 — Avtomatlashtirish (CI)

- [ ] GitHub Actions: `npm ci` → `npm run build` → `node tests/*.mjs` (Playwright smoke headless) → secret scan. Qizil bo'lsa merge yo'q.
- [ ] Dependabot/`npm audit` haftalik.
- [ ] Preview deploy har PR ga; smoke `BASE_URL=<preview>` bilan.

## 8. Bosqich 7 — Chiqarish (go-live)

1. Barcha bosqichlar yopilgan, 9-bo'lim mezonlari ✔.
2. Staging/Preview'da `docs/SMOKE.md` ning **hamma** punkti telefonda (iOS + Android) qo'lda o'tkazilgan.
3. Yangi DB zaxirasi olingan; migratsiyalar MR tomonidan prod'ga yurgizilgan (tartib bilan, har biridan keyin tekshiruv).
4. `main` ga merge → Vercel Production deploy → Build Logs'da env xatosi yo'q, `modules/env.js` yozilgan.
5. Prod smoke: ro'yxat → admin tasdiq → post → chat → push → qo'ng'iroq → admin panel.
6. `git tag v1.0.0`. Rollback rejasi tayyor (oldingi deploy'ni qayta "Promote").
7. 72 soat kuzatuv: xato jurnali, Supabase Logs, Storage sarfi, uptime. Har kuni qisqa hisobot.

## 9. "Production uchun 100% tayyor" — Tayyor mezonlari (hammasi ✔ bo'lishi shart)

- [ ] Hamma jadvalda RLS yoqilgan va ikki-foydalanuvchi negativ testlari o'tadi; bloklangan/kutayotgan user DB darajasida qulflangan.
- [ ] Git tarixida va deploy qilinadigan fayllarda sir yo'q; `service_role` brauzerda yo'q; `.env*`, `supabase/`, `scratch/`, `tests/` ochiq URL orqali yuklab olinmaydi (tekshirilgan).
- [ ] XSS audit yopilgan; foydalanuvchi kiritgan har chiqish `esc()`/xavfsiz; `javascript:` URL yo'q; apps sandbox isbotlangan (yoki o'chirilgan).
- [ ] CSP: `unsafe-inline` olib tashlangan yoki sababi hujjatlangan; qolgan sarlavhalar joyida.
- [ ] Bo'sh bazadan to'liq qurish xatosiz; zaxira + tiklash sinalgan; RUNBOOK mavjud.
- [ ] `tests/*` hammasi yashil, `docs/SMOKE.md` to'liq o'tgan (iOS + Android), 50 foydalanuvchi yuk testi xatosiz.
- [ ] Lighthouse mobil: Perf ≥ 85, A11y ≥ 90, BP ≥ 95, PWA ✔; app.css gzip ≤ 120 KB.
- [ ] Xato monitoringi va uptime monitor ishlayapti; admin xatolarni ko'ra oladi.
- [ ] Maxfiylik/shartlar sahifasi, hisob o'chirish yo'li, 2-admin/tiklash yo'li bor.
- [ ] Production Vercel env to'g'ri, Preview/Production ajratilgan; deploy Ready; rollback sinalgan.
- [ ] `v1.0.0` tegi qo'yilgan, `STATUS.md` va `README.md` yangilangan.

## 10. MR qarori kerak bo'lgan savollar (Grok bularni MR ga bir marta, jamlab so'raydi)

1. Reaksiyalar/emoji picker: SVG ikonka to'plamiga o'tkazib `emoji/` (49 MB) o'chirilsinmi, yoki saqlansinmi?
2. Storage 1 GB: Supabase rejasini yangilaymi yoki siqish/limit siyosati?
3. Alohida prod Supabase loyihasi ochilsinmi (tavsiya) yoki joriy bazada davom etamizmi?
4. Maxsus domen bormi?
5. `/apps` (foydalanuvchi ilovalari) prod'da yoqilsinmi yoki xavfsizlik audit tugamaguncha o'chiq turadimi?
6. Xato monitoringi: o'z jadvalimiz yoki Sentry?

---
Eslatma Grok uchun: tartib = 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Xavfsizlik (1-bosqich) tugamasdan chiqarishga o'tma. Har bosqich oxirida 0.7-banddagi formatda hisobot ber.
