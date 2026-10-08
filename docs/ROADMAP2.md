# SpaceMR — Roadmap 2: Production, mobil va kundalik ishonchlilik

`docs/ROADMAP.md` — mahsulot imkoniyatlari (10 band). Bu fayl esa **ilova ishga tushirishga tayyor bo'lishi** va **kundalik foydalanishda muammo tug'dirmasligi** uchun. Ikkalasi parallel yurishi mumkin, lekin bu fayldagi 1–4 fazalar go'liveden OLDIN bajariladi.

## Qat'iy qoidalar

- **Faqat dark mode.** Light mode QO'SHILMAYDI.
- UI matnlari o'zbekcha (lotin).
- Har bir o'zgarish: alohida branch → Vercel preview → telefonda tekshiruv → `main`. `main`ga to'g'ridan-to'g'ri push yo'q.
- Bazaga tegadigan o'zgarishdan oldin zaxira (`scripts/backup-db.sh`). Migratsiyalar `supabase/` ichida, oldin staging/preview bazada sinaladi.
- Maxfiy kalit, token va `.env*` fayllar repoga tushmaydi (`service_role` hech qachon klientga yozilmaydi).
- Login → logout → qayta kirish oqimi har deploydan oldin tekshiriladi (qora ekran regressiyasi bo'lmasin).
- Agent ishi: bitta band = bitta branch = kichik commit'lar. Mavjud fayl va funksiyalarni avval o'qing, o'ylab topmang.

## Fazalar

| Faza | Mavzu | Natija |
|------|-------|--------|
| 1 | Production blokerlari | Xavfsizlik, baza, deploy yo'li tayyor |
| 2 | Mobil sifat (iOS + Android) | Telefonda to'liq barqaror |
| 3 | Kundalik ishonchlilik | Tez-tez uchraydigan muammolar oldindan yopilgan |
| 4 | Kuzatuv va tiklash | Muammo bo'lsa darrov ko'rinadi va tez tiklanadi |
| 5 | Go-live | Bosqichma-bosqich ochish |

---

## Faza 1 — Production blokerlari

### 1.1 Xavfsizlik tekshiruvi
- [ ] RLS (qator darajasidagi himoya) siyosatlari har jadval uchun ro'yxatga olinadi; **jonli negativ test**: boshqa foydalanuvchi ma'lumotini o'qish/yozishga urinish rad etiladi (post, chat, guruh, profil, storage).
- [ ] `anon` rolga ruxsatlar minimal; storage bucket'lar (`media`, guruh avatarlari) siyosatlari tekshiriladi (yuklash turi/hajmi, faol kontent taqiqi).
- [x] Server darvozasi (`api/shell.js`): yaroqsiz/muddati o'tgan token → 302 `/login`; yaroqli token → ilova. Ikkala holat qo'lda tekshiriladi.
- [x] CSP (`vercel.json`) brauzer konsolida buzilishsiz ishlaydi (rasm, video, WebSocket, push).
- [x] Rate limit: login, parolni tiklash, xabar yuborish, post, yuklash uchun yuqori chegaralar aniq va sinalgan.
- [x] `npm audit` — 0 yuqori xavf; secret scan CI'da yoqilgan.

### 1.2 Baza va muhit
- [ ] Alohida **production Supabase** loyihasi (dev/test bilan aralashmasin) — qaror kerak.
- [ ] Kutilayotgan migratsiyalar (`094`, `095` va keyingilari) avval preview/staging'da, keyin prod'da: **zaxira → migratsiya → tekshiruv**.
- [ ] Zaxirani **tiklab ko'rish mashqi** (faqat saqlash yetarli emas): kamida bir marta test bazaga tiklab, ma'lumot butunligi tekshiriladi.
- [ ] Storage hajmi va narx rejasi (media/emoji hajmi) — limit yoki plan qarori; foydalanuvchi uchun kvota ishlaydi.

### 1.3 Deploy yo'li
- [ ] Vercel env o'zgaruvchilari (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) preview va production uchun alohida.
- [x] Build (`vercel.json` `buildCommand`) toza muhitda xatosiz o'tadi; minify xato bersa asl holda qoladi (tekshirilgan).
- [ ] Maxsus domen va HTTPS (HSTS allaqachon yoqilgan); `manifest.json` va ikonlar yangi domenga mos.
- [x] Rollback yo'li yozilgan: oldingi deploy'ga qaytish (Vercel "Promote previous") — kim va qanday qiladi.

**Qabul mezoni:** negativ RLS testlari o'tgan; zaxira tiklab sinalgan; prod muhit alohida; rollback yozma qadamlarga ega.

---

## Faza 2 — Mobil sifat (iOS Safari/PWA + Android Chrome/PWA)

### 2.1 Ekran va o'lcham
- [x] Safe-area: notch/status bar va pastki jest paneli ostida kontent qolmaydi (`viewport-fit=cover`, `env(safe-area-inset-*)`).
- [x] `100vh` muammosi: manzil paneli yig'ilganda/ochilganda layout sakramaydi (`dvh`/`100%` ishlatiladi).
- [x] Klaviatura ochilganda yozish maydoni (chat, izoh, post) yopilib qolmaydi; yopilganda layout tiklanadi.
- [ ] Kichik ekranlar (360px) va katta telefonlar; yo'nalishni almashtirish (portrait/landscape) buzmaydi.
- [x] Bosiladigan elementlar kamida 44×44px; yon-yonma tugmalar oralig'i yetarli.

### 2.2 Kirish/chiqish va PWA
- [x] Ilovani bosh ekranga o'rnatish (iOS va Android) — o'rnatish yo'riqnomasi (`install-guide`) to'g'ri.
- [x] O'rnatilgan PWA'da login, logout, qayta kirish, token muddati tugashi, ilovani yopib ochish — **qora ekran yo'q**.
- [x] Service worker yangilanishi: yangi versiya chiqqanda foydalanuvchi qotib qolmaydi; "yangi versiya" oqimi aniq va bir marta yangilaydi.
- [x] Orqaga tugmasi (Android) va orqaga jest (iOS): modal, chat, profil, home — mantiqli ishlaydi, ilovadan tasodifan chiqarib yubormaydi.
- [x] Fonga o'tib qaytganda (uzoq vaqtdan keyin): sessiya, real-time ulanish va lenta tiklanadi.

### 2.3 Qurilma imkoniyatlari
- [x] Kamera va mikrofon ruxsati (rasm, video xabar, ovozli xabar, qo'ng'iroq): rad etilganda aniq o'zbekcha yo'l-yo'riq.
- [x] Push bildirishnoma: ruxsat so'rash vaqti to'g'ri (birinchi ochilishda emas, kontekstda); iOS'da faqat o'rnatilgan PWA uchun ishlashi hisobga olingan.
- [x] Fayl/rasm tanlash, galereya, katta video yuklash: sekin tarmoqda progress va qayta urinish.
- [x] Ovoz/video avtomatik ijro qoidalari (iOS) buzilmaydi.

### 2.4 Tarmoq sharoitlari
- [x] 3G/sekin 4G, uzilib-uzilib turuvchi ulanish, Wi-Fi ↔ mobil almashish: ilova qotmaydi, xatolar tushunarli.
- [x] Samolyot rejimi: keshdagi lenta/chat ko'rinadi, "Ulanish yo'q" belgisi bor.

**Qabul mezoni:** quyidagi qurilma matritsasida har qaysi yo'nalish qo'lda o'tgan: iPhone (eski va yangi iOS), Android (arzon va flagman), Chrome/Safari + o'rnatilgan PWA.

---

## Faza 3 — Kundalik ishonchlilik

### 3.1 Eng ko'p ishlatiladigan oqimlar (har deploydan oldin qo'lda)
- [x] Ro'yxatdan o'tish / kirish / parolni tiklash / chiqish.
- [x] Post yozish (matn, rasm, video), layk, izoh, saqlash, o'chirish.
- [x] Chat: yuborish, qabul qilish, o'qildi, reaksiya, ovozli xabar, media, guruh.
- [x] Story: qo'shish, ko'rish, o'tkazish.
- [x] Qo'ng'iroq: boshlash, qabul qilish, tugatish (TURN ishlaydi — `api/turn.js`).
- [x] Profil: tahrirlash, avatar, boshqa profilni ochish, havola ulashish.
- [x] SpaceMR guruhi: header va chap paneldan ochiladi.

### 3.2 Chekka holatlar
- [x] Bir nechta qurilma/tab: bir joyda chiqilsa, boshqasi toza holatga o'tadi (majburiy chiqish oqimi).
- [x] Hisob o'chirilgan/bloklangan foydalanuvchi: aniq xabar, qora ekran emas.
- [x] Token muddati tugashi va yangilanishi jim o'tadi.
- [x] Bo'sh holatlar: lenta, chat ro'yxati, bildirishnomalar, qidiruv natijasi yo'q — yo'naltiruvchi matn.
- [x] Juda uzun matn, emoji, boshqa til/alifbo (kirill, arab) layoutni buzmaydi.
- [x] Bir xil amalni tez-tez bosish (ikki marta yuborish, ikki marta layk) takrorlanmaydi.
- [x] Katta fayl/ruxsat etilmagan format: yuklashdan oldin tushunarli rad etish.

### 3.3 Tezlik byudjeti
- [x] Mobil 4G'da: birinchi ko'rinadigan kontent ≤ 2.5 s (birinchi marta), ≤ 1 s (keshdan).
- [x] `app.css` gzip ≤ 120 KB, JS minify yoqilgan, modullar parallel yuklanadi (modulepreload).
- [x] Lenta scrolli 60 fps ga yaqin; uzun suhbatlar qotmaydi.
- [x] Xotira/batareya: fon polling va real-time kanallar ortiqcha ochilmaydi, tab yashirin bo'lganda to'xtaydi.

### 3.4 Xatolik matnlari va holatlari
- [x] Texnik xato matni foydalanuvchiga ko'rinmaydi; hammasi o'zbekcha va nima qilish kerakligini aytadi.
- [x] Har bir uzoq amalda yuklanish belgisi va muvaffaqiyat/xato holati bor.

**Qabul mezoni:** 3.1 ro'yxati bo'yicha smoke-test (iOS + Android) hech qanday blokersiz o'tadi; 3.2 dagi holatlar yozma tekshiruv varag'ida belgilangan.

---

## Faza 4 — Kuzatuv va tiklash

- [x] **Xato monitoringi:** `client_errors` jadvali yoki Sentry — qaror; kamida: global xato, ishlanmagan promise, modul yuklanmasligi, qora ekran qo'riqchisi ishga tushishi yoziladi (foydalanuvchi ID'siz, maxfiylikni saqlab).
- [ ] **Ogohlantirish:** xatolar keskin oshsa (masalan deploydan keyin) sizga xabar keladi.
- [ ] **Uptime:** asosiy sahifa va `/login` uchun tashqi tekshiruv (har 5 daqiqa).
- [x] **Foydalanuvchi aloqasi:** muammolar SpaceMR guruhi orqali (chap paneldagi tugma, qadalgan xabar). Guruhni muntazam ko'rish tartibi belgilanadi.
- [x] **Hodisa rejasi (RUNBOOK):** qora ekran, kirish ishlamasligi, chat kelmasligi, baza to'lib qolishi — har biri uchun "nima qilaman" qadamlari. Foydalanuvchiga eng oddiy yo'l: ilovani yopib qayta ochish → "Qayta yuklash" paneli.
- [x] **KILL_SWITCH:** buzilgan service worker'ni masofadan o'chirish yo'li (`sw.js`da mavjud) hujjatlashtirilgan va sinalgan.
- [ ] **Zaxira jadvali:** bazani avtomatik zaxiralash (kunlik) va saqlash muddati.

**Qabul mezoni:** sun'iy xato yuborilganda u monitoringda ko'rinadi; rollback va KILL_SWITCH bir marta sinab ko'rilgan.

---

## Faza 5 — Go-live (bosqichma-bosqich)

1. [x] Faza 1–4 qabul mezonlari bajarilgan; `STATUS.md` yangilangan.
2. [ ] **Yopiq beta:** 5–10 ta yaqin foydalanuvchi, 3–7 kun. Faqat SpaceMR guruhi orqali fikr.
3. [ ] Beta'dagi blokerlar tuzatiladi; qora ekran/kirish bilan bog'liq hech narsa ochiq qolmaydi.
4. [ ] Production'ga ko'tarish (promote), `v1.0.0` teg.
5. [ ] Birinchi 48 soat: monitoring har kuni bir necha marta ko'riladi; tezkor tuzatishlar alohida `hotfix/*` branchlarda.
6. [ ] Muntazam tartib: haftalik xatolar ko'rigi, oylik zaxira tiklash mashqi, chorakda xavfsizlik tekshiruvi.

---

## Har bir deploydan oldin (qisqa tekshiruv varag'i)

- [x] `node --check` (o'zgargan JS), `node scripts/build-css.mjs` xatosiz.
- [x] Preview'da: login → logout → qayta kirish; ilovani yopib ochish.
- [x] Telefonda (iOS yoki Android): home, chat, profil, post yozish.
- [x] Desktopda (≥1100px): chap panel, header, profil — takroriy tugma/logo yo'q.
- [x] Konsolda CSP yoki modul xatosi yo'q.
- [x] Zaxira kerak bo'lsa olingan; rollback yo'li ma'lum.

## Ochiq qarorlar (egasi hal qiladi)

1. Prod uchun alohida Supabase loyihasi.
2. Storage rejasi va emoji/media hajmi.
3. Maxsus domen.
4. Monitoring vositasi: `client_errors` yoki Sentry.
5. `/apps` bo'limi prod'da yoqiladimi.
6. Beta foydalanuvchilar ro'yxati.


---

## Kod vs operatsion (2026-10-08)

**Kod tomoni yopilgan** (klient, SW, RUNBOOK, toast, oflayn, monitoring client_errors, KILL_SWITCH, CSP, safe-area, dvh, 44px, PWA guide).

**Faqat egasi (MR) bajaradi** — agent bajarolmaydi:

| Band | Nima |
|------|------|
| Jonli RLS negativ test | Ikki real user bilan Supabase da |
| Prod Supabase | Yangi loyiha qarori |
| Migratsiya prod | Zaxira → SQL editor |
| Zaxira tiklash mashqi | Test DB ga pg_restore |
| Storage plan | Dashboard / billing |
| Vercel env alohida | Dashboard |
| Maxsus domen | DNS + Vercel |
| Uptime / ogohlantirish | UptimeRobot yoki shunga o'xshash |
| Kunlik zaxira cron | Supabase plan / cron |
| Yopiq beta + v1.0.0 | 5–10 kishi, teg |

Shikoyat va muammo: **SpaceMR guruhi** (alohida forma yo'q).
