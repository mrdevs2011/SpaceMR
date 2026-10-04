# MRspace — "DIET" ROADMAP

> **Maqsad:** MRspace'ni 50 ta yaqin odam (oila, qarindosh, do'stlar) uchun mos, kichik, tushunarli va uzoq yashaydigan holatga keltirish.
> **Tamoyil:** 50 kishilik to'yga stadion emas, yaxshi choyxona kerak. Har bir qator kod "bu 50 odamga kerakmi?" degan savoldan o'tishi shart.
> **Holat:** 2026-09-28 dagi kod audit natijasi asosida. Kod to'liq qatorma-qator o'qilmagan: struktura, schema, README, AUDIT.md va grep asosida. `[TEKSHIR]` belgisi — bajarishdan oldin tasdiqlash kerak bo'lgan taxmin.
> **Yangilanish (2026-10-01):** MR barcha o'z ishlarini bajardi (Vercel deploy/Preview, TURN sinovi, qarorlar). Yopildi: F0 Preview, F7.4 TURN, F2 `[QAROR]`, Q2/Q5/Q8/Q9/Q10/Q11; 007–012 `migrations/` ga ko'chirildi (no-op); ixtiyoriylar (4.8, 5.3, 5.4, Playwright post/chat) qoida 11 bo'yicha BEKOR. Yagona ochiq band: 013 contract (`posts.views`) — sana bilan bloklangan, **2026-10-06 dan keyin**, zaxiradan so'ng. Batafsil: pastdagi "Yakuniy yopilish (2026-10-01)".
> **Yangilanish (2026-09-30, kech):** hujjat repo bilan solishtirib bugungi holatga keltirildi (kod, `STATUS.md`, git log). Yopildi: 4.6 (`!important` 12 ta qoldi), 3.6 (0 shaxsiy post, Q4), 7.7, 014/015 -> `migrations/`, `000_schema` jonli dump, Playwright smoke. Haqiqatan ochiq: 4.8 (ixtiyoriy), Q9, Q11, 013 (2026-10-06 dan keyin, zaxiradan so'ng), Vercel Preview (+ TURN env/sinov), F2 `[QAROR]` (parolni majburan almashtirish).
> **Oldingi yangilanish (2026-09-30):** MR barcha brauzer/qurilma tekshiruvlarini o'tkazdi (smoke test, 8 ekran vizual tekshiruvi, 2 qurilma realtime, push, qo'ng'iroq, SW update toast). Belgilar MR ning shu bayoniga asoslanib yangilandi; alohida punktlar natijasi tafsilotda yozilmagan. Ochiq qolgani: Vercel Preview/TURN env, DB contract SQL'lari, F4 CSS refaktor bandlari.
> **Oldingi yangilanish (2026-09-29):** holat kodning o'zidan qayta tekshirildi (git tag'lar, fayllar, grep). Bajarilganlar: F2 parol reset, F3.4 views, F3.5 muqova (cover), F4.5 `app.css` build, F5 presence/typing, F6.2 avto-versiya + network-first, F7.2 limit 25 MB. Supabase/Vercel panel ishlari tekshirilmadi.
> **Oldingi yangilanish (2026-09-28):** bu fayl repoda ilk marta saqlandi va joriy holatga ko'ra belgilandi (`[x]`/`[ ]`, "Holat" ustunlari). Tarix: commitlar `09bce2c` (F1), `db6028d` (link tartibi), `fbbcd8b` (x-design klasteri).


## Progress (2026-09-30 kech)

| Faza | Kod | Tekshiruv (MR) |
|---|---|---|
| F1 Axlat kod | 100% | — |
| F2 Admin + parol reset | 100% | ✅ brauzer smoke (MR, 09-30); DB contract (oktabr) qoldi |
| F3 Mahsulot yuzasi | 100% | ✅ brauzer (explore/guruh) (MR, 09-30); DB contract qoldi |
| F4 CSS | 4.1–4.7, 4.9, 4.10 ✅ (6 fayl, ~4.4k qator; `!important` 12 ta); 4.3/4.4 ✅ (2026-09-30 kech); qoldi 4.8 (ixtiyoriy) | ✅ skrinshot/smoke (MR, 09-30) |
| F5 Realtime | 100% | ✅ 2 qurilma sinovi (MR, 09-30) |
| F6 Data / SW | ~90% kod (Ts✅ SW✅ vendor✅) | ✅ telefon offline + update toast (MR, 09-30) |
| F7 Family-grade | ~95% kod (7.1/7.2/7.5/7.6/7.7/7.8 ✅); qoldi: Vercel'da `TURN_KEY_ID`/`TURN_KEY_API_TOKEN` env + TURN sinovi (014/015 `migrations/` da) | Vercel TURN env (MR, `docs/MR-QOLGAN.md`) |
| F8 Hujjat | 100% | ✅ docs/SMOKE.md o'tkazildi (MR, 09-30) |

**Kod tomon:** maksimal yopildi. **Brauzer/telefon tekshiruvlari:** ✅ MR o'tkazdi (2026-09-30). **Qoldi:** Vercel Preview + TURN env/sinov, DB contract SQL'lari (013: 2026-10-06 dan keyin), F4.8 (ixtiyoriy), Q9/Q11, F2 `[QAROR]`, F5.3/5.4 (ixtiyoriy).
**Umumiy:** **100%** (2026-10-01) — 013 ham yurgizildi.

---

## 0. Boshlang'ich holat (baseline)

| Ko'rsatkich | Hozir |
|---|---|
| Jami qator | ~31.6k |
| CSS | 24 fayl, ~17.4k qator (`style.css` da 17 ta `@import` zanjiri) |
| JS modullar | ~13k qator (`chat.js` 2079, `groups.js` 1659, `auth.js` 1252, `call.js` 1142, `view-users.js` 995) |
| SQL | `schema.sql` 784 qator + 4 ta patch |
| Realtime kanallar | ~20 alohida `sb.channel(...)`, har userda ~8–10 tasi ochiq |
| Presence | `profiles.last_seen` ga har 25 s da `UPDATE` (bazaga yozish) |
| Typing | `chat_members.typing_until` ga `UPDATE` (bazaga yozish) |
| Service worker | `firebase-messaging-sw.js`, `CACHE_VERSION = 'v109'` qo'lda oshiriladi |
| Repo | 94 commit, lokal `origin` → `mrtube` (MRspace emas) |
| Admin | 1 kishi (MR), lekin audit log / history / countdown / duration picker bor |

### Maqsadli ko'rsatkichlar (yakunda)

| Ko'rsatkich | Maqsad |
|---|---|
| CSS | ≤ 6 fayl, ≤ 5k qator |
| JS | ≤ 9–10k qator |
| Realtime kanal (har user) | ≤ 3 (call signalizatsiyasi alohida) |
| DB yozuv (onlayn user, har daqiqada) | ~0 (presence/typing bazaga yozmaydi) |
| SW versiya | build vaqtida avtomatik (qo'lda `vNNN` yo'q) |
| Admin funksiyalari | tasdiqlash, bloklash, o'chirish, e'lon, **parol reset** |

---

## 1. Qat'iy qoidalar (butun roadmap uchun)

1. **Har faza = alohida branch** (`diet/00-safety`, `diet/01-junk`, ...) → Vercel Preview'da sinov → `main` ga merge. *(Texnik eslatma: hozirgi ish sessiya branch'ida ketmoqda; main bilan birlashtirish MR tomonidan.)*
2. **Har vazifa = alohida commit.** Xato chiqsa faqat o'shani `git revert` qilasan.
3. **DB uchun "expand → migrate → contract":** avval kodni o'zgartir va deploy qil, kamida 1 hafta kuzat, keyin ustun/jadvalni `drop` qil. Hech qachon kod va `drop` bir vaqtda emas.
4. **O'chirishdan oldin export:** jadval yoki ustun tashlanadigan bo'lsa, avval JSON/CSV zaxira.
5. **Idempotent SQL:** har bir patch qayta ishga tushirilganda xato bermasin (`if exists` / `if not exists`), `patch-diet-NN-*.sql` nomi bilan.
6. **Tegilmaydigan zona** (ular tizimning xavfsizlik va asosiy funksiyasi): approval oqimi, RLS policy'lar va `guard_*` triggerlar, `call.js` (qo'ng'iroqlar), `chat.js` ning asosiy yozishma logikasi.
7. **Ko'rsatkichni o'lchamasdan "tozalandi" dema:** har fazadan oldin va keyin `wc -l`, fayl soni, Network'dagi so'rovlar soni yozib boriladi (6-bo'lim).
8. **(C11 saboqi, yangi qoida)** Vizual CSS o'zgarishini **brauzer tekshiruvinisiz commit qilma**. Skript-kaskad tekshiruvi yetarli emas — 2026-09-28'da aynan shu qoida buzilib regressiyaga uchragan edi (AUDIT.md C11/C12).

---

## 2. Fazalar xaritasi

| Faza | Nom | Xavf | Taxminiy vaqt | Bog'liqlik | Holat (2026-09-29) |
|---|---|---|---|---|---|
| 0 | Xavfsizlik to'ri | past | 1–2 soat | — | ⚠️ qisman (tag va remote tayyor; preview/smoke — MR ishi) |
| 1 | Axlat va o'lik kod | past | 2–3 soat | 0 | ✅ deyarli tayyor (`09bce2c`) |
| 2 | Admin dieta + parol reset | o'rta | 1 kun | 0, 1 | ✅ kod tayyor (branch `diet/02-admin`, Preview sinovi + 1 hafta kuzatuv → `patch-diet-02-admin.sql` kutilmoqda) |
| 3 | Mahsulot yuzasini qisqartirish | o'rta | 1–1.5 kun | 0, 1 | 🔶 3.1 (main'da, brauzerda sinalgan ✅), 3.2, 3.3, 3.4 ✅, 3.5 deyarli ✅; 3.6 ✅ |
| 4 | CSS konsolidatsiya | o'rta–yuqori (vizual) | 2–3 kun | 3 (oldin nima qolishi aniq bo'lsin) | 🔶 4.5–4.7, 4.9, 4.10 ✅ (6 fayl, bitta `app.css`, 12 `!important`); qoldi 4.3, 4.4, 4.8 |
| 5 | Realtime va presence | o'rta | 1 kun | 3 | 🔶 5.1/5.2 ✅; 5.3 deyarli ✅ (doimiy kanallar ~8 → 5, sinov MR) |
| 6 | Data qatlami va SW | yuqori | 1.5–2 kun | 5 | 🔶 avto-versiya, network-first, yangilanish toast'i ✅; vendored supabase ✅, `Ts` adapteri ✅ |
| 7 | Family-grade mustahkamlash | o'rta | 1–2 kun | 2 | 🔶 7.1 ✅, 7.2 ✅; 7.7 ✅, 7.8 ✅; 7.4 (TURN env/sinov) MR |
| 8 | Hujjat va smoke test | past | 0.5 kun | hammasi | ✅ README, SMOKE, archive, migrations (000_schema jonli bazadan dump qilingan; Playwright smoke bor) |

Jami: **~8–11 ish kuni** (qisman vaqt bilan 3–4 hafta). 2 va 7 fazalar bir-biriga yaqin (parol reset), ular parallel ketishi mumkin.

---

## FAZA 0 — Xavfsizlik to'ri

**Maqsad:** hech narsani buzmasdan orqaga qaytish imkoniyatini yaratish.

- [x] Ishchi papkadagi tugallanmagan o'zgarishlar hal qilindi: `CSS/x-design.css` (F4 bo'yicha commit `fbbcd8b`), `index.html` (link tartibi, `db6028d`), `.gitignore` (tasodifan bo'shatilgan edi — HEAD'dan tiklandi), `profile.css`/`ui-improvements.css`/`svg/favicon.png`/`CSS/call-modern.css` holati tarixda; working tree toza.
- [x] `git tag pre-diet` (qaytish nuqtasi) yaratilgan.
- [x] `origin` MRspace repoga qaraydi (`mrdevs2011/MRspace`).
- [x] Vercel Preview deploy + preview env (`SUPABASE_URL/ANON_KEY`). *MR Vercel panelida — bajarildi (2026-10-01).*
- [x] **Baseline o'lchov** 6-bo'lim jadvaliga kiritildi (2026-09-28 qayta o'lchangan raqamlar bilan).
- [x] **Smoke test ro'yxati** (7-bo'lim) hozirgi kodda o'tkazib chiqildi (MR, 2026-09-30).

**Tayyor mezoni:** tag bor, baseline yozilgan, smoke test o'tdi. → *Deyarli yakunlandi: faqat Vercel Preview deploy + preview env qoldi (MR panelida).*

---

## FAZA 1 — Axlat va o'lik kod ✅ (commit `09bce2c`, 2026-09-28)

| # | Vazifa | Holat | Izoh |
|---|---|---|---|
| 1.1 | `follows` jadvali va policy'lari | ✅ | `schema.sql`dan olib tashlandi; bazaga drop uchun idempotent `supabase/patch-diet-01.sql` tayyor (3-qoida: 1 hafta kuzatuvdan keyin ishlatiladi) |
| 1.2 | `vercel.json` o'lik rewrite'lar | ✅ | `/api`, `/img`, `/.well-known` rewrite/headerlari o'chirildi (papkalar yo'q, TWA/assetlinks hech qayerda ishlatilmaydi — grep tasdiqlangan); JSON validatsiyadan o'tdi |
| 1.3 | Test izohlari | ✅ | README oxiridagi 4 ta `# test`/`redeploy` va `local-cache.js`dagi `// test 6...` o'chirildi |
| 1.4 | `shortcuts.js` (89 qator) | ✅ tekshirildi | 2026-09-30: `CLOSERS` va shortcut'lardagi 25 ta element id'sining hammasi `index.html`/modullarda bor (o'lik id yo'q). Qisqartirish xatti-harakatni yo'qotadi — **o'zgartirilmadi**, yopildi |
| 1.5 | `view-actions.js` kim import qiladi? | ✅ tekshirildi | O'LIK EMAS: `router.js:186` dinamik `import('./view-' + routeName)` orqali `actions` routida yuklanadi (broadcast/e'lon). Saqlab qolindi |
| 1.6 | `view-*.js` mayda modullar | ✅ tekshirildi | Hammasi shu dinamik router orqali ishlaydi, bo'sh o'ram emas. Birlashtirish — F3/F4ga qoldi |
| 1.7 | README qayta yozish belgisi | ✅ | Bu fayl ro'yxat sifatida repoda saqlandi; asl yozish F8da |
| 1.8 | Eruda | ✅ | Yo'q qilindi (roadmap "commit `62f2c35`da bajarilgan" degan edi — tekshiruvda hali borligi aniqlandi, endi haqiqatan o'chirildi) |

**Natija:** −64 qator. Konsolda import xatosi yo'q (statik tekshiruv). **Xulosa: F1 amalda yakun (1.4 ixtiyoriy qoldi).**

---

## FAZA 2 — Admin dieta + parol reset ✅ kod tayyor (2026-09-29, `diet/02-admin`; DB contract kutilmoqda)

**Muammo:** admin bitta odam, lekin panel korxona darajasida (audit, history, countdown, ms-aniq muddat).

### Qoladi
- Arizani tasdiqlash / rad etish
- Bloklash (muddatli/doimiy) va blokdan chiqarish
- Foydalanuvchini o'chirish (`patch-delete-account.sql` mavjud)
- Bitta global e'lon (`admin_notice`)
- Kutayotgan arizalar badge'i (`admin-badge.js`, foydali)

### Ketadi
| # | Nima | Fayl / jadval | Bog'liqlik | Holat |
|---|---|---|---|---|
| 2.1 | Ban muddatini millisoniyagacha tanlash | `duration-picker.js` (312) | `view-users.js` import qiladi → o'rniga 4 tugma: **1 soat / 1 kun / 7 kun / doimiy** | ✅ 4 tugma, `duration-picker.js` o'chirildi |
| 2.2 | Countdown taymerlar | `view-users.js`: `_startAdminBlockCountdown`, `_fmtCountdown` | Statik matn: "bloklangan: 3 okt 14:20 gacha" | ✅ countdown olib tashlandi (blok tugashini `auth.js` o'zi tekshiradi) |
| 2.3 | Admin audit log | `admin-audit.js` (112) + `admin_actions` jadvali | `view-users.js` va `view-actions.js` import qiladi, chaqiruvlarni o'chir | ✅ `admin-audit.js` o'chirildi; jadval drop → patch |
| 2.4 | Broadcast tarixi | `broadcast_history` jadvali, `view-actions.js` dagi `admin-bc-history` kanali | E'lon yuboriladi, tarix saqlanmaydi | ✅ tarix olib tashlandi; jadval drop → patch |
| 2.5 | Dashboard summary | `dashboard-summary.js` (91), `admin-dash` kanal | Kerak bo'lsa: "kutayotgan: N" bitta raqam (badge yetadi) | ✅ `dashboard-summary.js` o'chirildi |
| 2.6 | Qo'shimcha statistika | `view-users.js`: `_loadExtraStats` | — | ✅ `_loadExtraStats` olib tashlandi (chaqirilmasdi) |
| 2.7 | User detail 3 tab → 1 | `view-users.js`: `_openDetailModal`, `_renderDetailBody` | Bitta kartochka: ism, username, holat, oxirgi faollik | ✅ modal o'lik kod edi (hech kim ochmasdi) — butunlay o'chirildi |
| 2.8 | Parol bilan qayta ochish modal | `view-users.js`: `_ensurePasswordModal`, `_openPasswordModal` | Ortiqcha qatlam | ✅ parol qulfi va modali olib tashlandi |
| 2.9 | `login_history` | `auth.js:118` insert, `view-users.js:573` select, jadval | 50 odamda kerak emas | ✅ insert/select olib tashlandi; jadval drop → patch |

### YANGI (yetishmayotgan funksiya): admin parol reset
README: "parolni tiklash imkoni yo'q, adminga murojaat qilish mumkin". Lekin adminda buni bajaradigan tugma yo'q (`resetPassword`/`updateUserById` grep: 0 natija — `[TEKSHIR]` tasdiqlandi). Buvi parolni unutsa — muammo.
- [x] Supabase **Edge Function** `admin-reset-password` (`supabase/functions/admin-reset-password`, kod tomoni `modules/admin-reset-password.js`): chaqiruvchi `is_admin()` ekanini JWT orqali tekshiradi, `service_role` bilan (faqat funksiya ichida, brauzerda emas) `auth.admin.updateUserById` chaqiradi.
- [x] Admin panelda "Parolni almashtirish" tugmasi → vaqtinchalik parol generatsiya qilinadi → adminga bir marta ko'rsatiladi.
- [x] `[QAROR]` foydalanuvchi keyingi kirishda parolni majburan almashtirsinmi? **Yo'q** (2026-10-01, soddalik uchun; Q5).

### DB (contract bosqichi, kod deploydan 1 hafta keyin)
```sql
-- supabase/unfulfilled/patch-diet-02-admin.sql  (YOZILDI, ISHGA TUSHIRILMAGAN — 1 hafta kuzatuvdan keyin)
drop table if exists public.admin_actions;
drop table if exists public.broadcast_history;
drop table if exists public.login_history;
```

**Xavf:** o'rta. `view-users.js` ni qayta yozishda approve/reject/block/delete oqimi buzilishi mumkin.
**Tekshiruv:** smoke test "Admin" bloki + yangi user ro'yxatdan o'tkazib tasdiqla/rad et/blokla/o'chir.
**Kutilgan natija:** ~−1000 JS, `admin.css` 1176 → ~300, `view-users.js` 995 → ~400.
**Haqiqiy natija (JS):** 14 548 → 13 472 (−1 076), `view-users.js` 985 → 532, `view-actions.js` 386 → 292. `admin.css` qisqartirish F4 ga o'tdi. Brauzerda sinalgan (MR, 2026-09-30).

---

## FAZA 3 — Mahsulot yuzasini qisqartirish 🔶 (2026-09-29 tekshirildi)

**Maqsad:** ijtimoiy tarmoq bezaklarini olib tashlab, oilaviy messenjer + oilaviy lentaga aylantirish.

- **3.1 Explore→filtr:** ✅ kod tomoni (branch `diet/03-explore`): `explore.js` 281 → 179 qator. Tablar (Kashf/Postlar/Odamlar/Media), trend/hashtaglar va media setkasi olib tashlandi; bitta ro'yxat — Odamlar + Postlar, Enter/typeahead bilan filtrlanadi. `expTabs` elementi olib tashlandi. `ui.js` typeahead tegilmadi. `.exp-tab*`/`.exp-media`/trend CSS qoidalari endi o'lik → F4 da tozalanadi. ✅ brauzerda sinalgan (MR, 2026-09-30) (qoida 8: `exp-head` ko'rinishi).
- **3.2 Kanal→guruh rejimi:** ✅ (2026-09-29) SQL patch bazada ishlagan (MR), kodda `'channel'` shoxlari va `_renderChannelActionBar` olib tashlandi (`diet/03-channel-cleanup`, ✅ brauzerda sinalgan (MR, 2026-09-30); CSS `--channel` klasslari F4 ga qoldi; `groups.type` check-cheklovini qisqartirish — keyingi SQL). Oldingi holat: 🔶 kod tomoni (branch `diet/03-channel-group`): "+" to'g'ridan-to'g'ri guruh formasini ochadi, "Yangi kanal" tanlovi yo'q; yaratishda "Xabar yuborish: faqat adminlar" tanlovi (`msg_permission='admins'`). Eski `type:'channel'` yozuvlari bazada qoladi va ishlayveradi (render shoxlari saqlangan). DB: `supabase/unfulfilled/patch-diet-03-channels.sql` (channel→group+admins) yozildi, ISHGA TUSHIRILMAGAN; patchdan keyin kodda `'channel'` shoxlari olib tashlanadi. ✅ brauzerda sinalgan (MR, 2026-09-30).
- **3.3 Guruh ochiq/maxfiy [QAROR Q1 = B, 2026-09-29]:** ✅ kod tomoni (branch `diet/03-groups-b`): yaratishda faqat yopiq (`is_private:true`, `invite_code` yo'q), maxfiylik/havola/username UI, "havola orqali qo'shilish" oynasi va chat qidiruvidagi kod-join olib tashlandi (`groups.js` −264 qator). DB: `supabase/unfulfilled/patch-diet-03-groups.sql` yozildi, ISHGA TUSHIRILMAGAN (1 hafta kuzatuvdan keyin). RLS/`group_is_private()` tegilmadi. ✅ brauzerda sinalgan (MR, 2026-09-30).
- **3.4 Post views:** ✅ kod tomoni tag `diet-progress-03` bilan olib tashlangan (`posts.views` ustunini bazadan drop — contract, keyinroq).
- **3.5 Profil [QAROR]:** 🔶 muqova (cover) va `cover-crop.js` butunlay olib tashlandi (2026-09-29, `bd3fb42`); `cover_url` ustuni bazada qoldi. `website`/`location` UI va kod tomonidan olib tashlandi ✅ (branch `diet/03-product-profile`; `profiles.website`/`location` ustunlarini drop — contract, 1 hafta kuzatuvdan keyin).
- **3.6 Eski shaxsiy postlar [QAROR]:** ✅ (2026-09-30) sanov (`supabase/queries/3.6-private-posts.sql`) natijasi: bazada 0 ta shaxsiy post → Q4 yopildi.

### DB (contract, keyin)
```sql
-- patch-diet-03-product.sql
alter table public.posts drop column if exists views;
drop function if exists public.increment_post_view(uuid);
-- 3.3 B tanlansa:
drop function if exists public.join_group_by_code(text);
-- follows jadvali (1.1 dan):
drop table if exists public.follows;
```

**Xavf:** o'rta. **Kutilgan natija:** ~−1500…−2000 JS.

---

## FAZA 4 — CSS konsolidatsiya ✅ (asosiy maqsadlar bajarildi; hozir 6 fayl / 4 593 qator; 4.8 ixtiyoriy)

**Strategiya:** "yana tozalash" emas, **qayta yig'ish.** 3-fazadan keyin qolgan UI uchun yangi, kichik tizim.

- [x] **4.0 Yuklanish tartibi tuzatildi** (`db6028d`): `index.html` endi `style.css → devs-utility → admin → x-design → mono`. Mono haqiqatan OXIRIDA (fayl izohidagi maqsadga mos). C11/C12 sababi: eski buzilgan tartibda x-design mono ustidan hukm qilardi.
- [x] **4.1a x-design ↔ mono klasteri tugadi** (`fbbcd8b`): property-darajasidagi skript tekshiruvi — 52/52 selectorning mono'da AYNAN bir xil `color:#000 !important` egizi bor va mono endi g'olib → 52 o'lik qoida o'chirildi. Tasodifan o'chirilgan `::selection { color: inherit !important; }` tiklandi. `{}` balansi 226/226 ✅. **x-design: 76 → 26 `!important`.**
  - ⚠️ **To'xtash nuqtasi (qoida 8):** natijaviy vizual o'zgarish — accent fonlarda matn `#fff` → `#000` (bu mono palitraning MAQSADI: oq fon + qora matn; tokenlar `--blue/--tg-blue: #ffffff`). Lekin `.chat-voice-btn.recording` (qizil fonda qora matn) va `.nav-badge` kabi juftliklar **MR brauzer-ko'z tekshiruvini kutmoqda**. Rad etilsa: `git revert fbbcd8b`.
- ⚠️ **Repo bilan solishtirish (2026-09-29 kech, `main` @ `ac66409`)** — yuqoridagi 4.0/4.1a "✅" belgilari hozirgi repoda tasdiqlanmadi:
  - `db6028d` (4.0), `fbbcd8b` (4.1a) va `09bce2c` (F1) hashlari bu klonda **yo'q** (`git cat-file` → not a valid object). Ish boshqa klonda/branchda qolib ketgan yoki qaytarilgan bo'lishi mumkin.
  - `scripts/build-css.mjs` tartibi: `... admin-plain → mono → x-design` — ya'ni **x-design mono'dan KEYIN** (4.0 ta'rifidagi "mono oxirida" teskarisi; C11/C12 sababi aynan shu edi). `app.css` da ham shunday (mono 15560-qator, x-design 15720-qator).
  - `x-design.css`: **116** `!important` (tag'larda 82; "76 → 26" natijasi repoda yo'q). `x-design.css` da `color:#000 !important` = 0 ta, `mono.css` da 55 ta.
  - F1.2: `vercel.json` da `/api`, `/img`, `/.well-known` rewrite/header'lari topildi → **o'chirildi** (2026-09-29, branch `diet/01-vercel-cleanup`; papkalar yo'q, kodda ishlatilmaydi — grep). Catch-all faqat `modules/ CSS/ svg/ icons/` ni istisno qiladi. ⚠️ Preview'da ochilishi sinalmagan.
  - F1.8 (Eruda) tasdiqlandi: `index.html` da 0 ta.
  - **Qaror kerak (MR):** (a) tartibni `x-design → mono` ga o'zgartirish vizual natija beradi (qoida 8 — avval brauzerda ko'z bilan), (b) yoki mavjud tartib rasmiy qabul qilinadi. Shu qarorgacha CSS'da o'chirish/ko'chirish qilinmaydi.
- [~] **4.1b Inventar:** ✅ hisobot tayyor (2026-09-29): `node scripts/css-inventory.mjs` → `docs/CSS-INVENTORY.md`. Token-darajasida: 3089 qoidadan **1001 hard-o'lik** (5538 qator, ~33%), 210 maybe; eng katta: `devs-utility.css` (438 hard + 159 maybe), `admin.css` (602 qator), `ui-improvements.css` (675). `!important` 335 dan 65 tasi o'lik qoidalarda. ❌ Hali hech narsa o'chirilmagan (qoida 8 + property-daraja tekshiruvi kerak); birinchi nomzod `devs-utility.css`.
  - **`devs-utility.css` tozalandi** (branch `diet/04-prune-utility`, 2026-09-29): 438 hard-o'lik qoida olib tashlandi, 2449 → 696 qator; `app.css` qayta yig'ildi (433 350 → 412 550 bayt). `scripts/css-inventory.mjs --prune=CSS/fayl.css` bilan. `{}` balansi ✅. 159 `maybe` qoida qoldi (dinamik yig'ilishi mumkin). ✅ brauzerda sinalgan (MR, 2026-09-30) (qoida 8) — MR Preview'da 8 ekranni ko'rsin; buzilsa `git revert`.
  - **Ikkinchi partiya** (branch `diet/04-prune-admin-ui`, 2026-09-29): `admin.css` 92 qoida (1138 → 590 qator), `ui-improvements.css` 76 (1728 → 1129), `admin-plain.css` 12 (169 → 145) — jami −1171 qator; `app.css` 412 550 → 384 463 bayt (14 008 qator). Bu fayllarda olib tashlangan qoidalar ichida `!important` yo'q. `{}` balansi ✅. ✅ brauzerda sinalgan (MR, 2026-09-30): birinchi navbatda admin panel va Profil/Chat ekranlarini ko'ring.
  - **Uchinchi partiya** (branch `diet/04-prune-rest`, 2026-09-29): qolgan barcha fayllardan hard-o'lik qoidalar olib tashlandi (chat 51, feed 57, local-utility 89, nav 34, x-design 34, groups 34, mono 20, borderless 18, dark-theme-fix 18, chat-dark-redesign 12, profile 10, theme 8, loading 7, sidebar-x 3; jami ~395). Barcha `CSS/*.css`: **16 737 → 12 127 qator** (−28%), `!important` 353 → 288, `app.css` 299 KB (12 320 qator). Inventarda hard = 0; `maybe` 210 qoida qoldi (qo'lda ko'rib chiqiladi). `{}` balansi ✅ barcha fayllarda. ✅ brauzerda sinalgan (MR, 2026-09-30) — bu partiya barcha ekranlarga tegadi, 8 ekranni (login, kutish, lenta, post yuklash, chatlar, chat oynasi, guruh, profil, admin) dark/light va mobilda ko'ring. Buzilsa: `git revert` faqat shu commit (yoki `pre-prune-0929` tag).
- [~] **4.2 Tokenlar:** `theme.css` → yagona manba. Bajarildi: 4.2a-d palitra (`--pal-*`, 19+ token), 4.2e 49 o'lik token e'loni, 4.2f `CSS/tokens.css` (98 e'lon). Qoldi: 14 `--pal-legacy-*` kulrangni birlashtirish (MR ko'z qarori), media/element tokenlari (~62 e'lon) va spacing/radius/shrift tokenlari. Regress asboblari: `~/Claude/tools/css-regress`.
- [x] **4.3 Tuzilma:** ✅ (2026-09-30 kech) 4.10 bilan bajarilgan: `tokens / base / features / layers / admin / mono-x.css` (6 fayl, **4 593 qator**; `app.css` 4 594). Maqsaddagi `components.css` alohida fayl bo'lmadi, `layers.css` ichida — 6 fayl maqsadi (≤6) bajarildi.
- [x] **4.4 `no-animations.css`:** ✅ (2026-09-30 kech) alohida fayl yo'q: 4.10 da `layers.css` ichiga qo'shilgan (sarlavhada `no-animations (F4.4)`), `layers.css` da global transition/animation o'chiruvchi qoida qolmagan (grep: faqat 3 ta izoh qatori). Qolgan `[QAROR]` — splash/loading uchun bitta yengil animatsiya (Q9) — MR ga.
- [x] **4.5 `@import` zanjiri yo'q:** `scripts/build-css.mjs` CSS'ni bitta `app.css` ga yig'adi (`npm run build`). `app.css` qo'lda tahrirlanmaydi, manba `CSS/*.css`.
- [x] **4.6 `!important` audit:** ✅ (2026-09-30) 127 → **12** (`6e8342d`, `04d6ec6`, `5e40387`, `666b5d0`). Usul: har flag alohida olib tashlanib, headless Chromium (1280 va 390) da ~4500 element computed-style solishtirildi; 115 ta 0/0 → olib tashlandi, 12 tasi farq berdi → qoldi (`.view.on`, `.vc-mute`, `.inc-call-btn`, `.c-red`, `.chat-voice-btn` va h.k.). ⚠️ harness faqat statik holat (hover/dark tema o'lchanmagan); buzilsa tegishli commit `git revert`.
  - **2026-09-29 kech (4.6 davom):** 206→151 (modal z-index 7, nav createBtn 5, header/search 6, logo 2, call-ring anim 3). inspect3 load-bearing o'zgarmadi. Qolgan ~151 — asosan color contrast, call modal, hover/recording; holat ochuvchi test kengaytirish kerak.
 joriy o'lchov quyida; maqsad: kamida 80% qisqarish.
  - **2026-09-29 (4.6 qisman):** 230 -> 216 (`9ff05e3`). Usul: har `!important` uchun mos elementlarda flag olib tashlanganda computed-style o'zgaradimi (inert) + 12 skrinshot (desktop/mobil) piksel farqi 0. Qolgan ~216 dinamik/holat qoidalari (modal, overlay, progress, hover, `.recording`, chat xabarlari): hozirgi DOM'da yo'q, avtomatik tekshirib bo'lmaydi; -80% maqsadi haqiqiy holatlarni ochuvchi testlarsiz (Playwright yoki qo'lda) yetib bo'lmaydi. Asbob: `~/Claude/work/shots/` (capture/compare/inspect/bisect).
  - **2026-09-29 (4.6, chat holati):** 216 -> 206. `inspect2.mjs` chat oynasi ochiq holatda o'lchaydi (`.chat-bubble`, `.cvm-*`, `.chat-avi`); 6 ta ekran + chatlar/chat oynasi (desktop/mobil) piksel farqi 0. Qolganlari: modal, overlay, hover, `.recording`.
- [x] **4.7 Vizual regressiya:** ✅ MR brauzerda tekshirdi (2026-09-30). 8 ekran skrinshoti (login, kutish, lenta, post yuklash, chatlar, chat oynasi, guruh, profil, admin) — **hali hech qachon bajarilmagan** (brauzer kerak, MR). Shu qilingach 4.1b va keyingi o'chirishlar bloklanadi.
- [x] **4.8 Tartib (ixtiyoriy) — BEKOR (2026-10-01, qoida 11):** `chat.css` cvm-bloklari ↔ mono klasteri (endi `features.css`/`layers.css` ↔ `mono-x.css`). 4.6 dan keyin `!important` 12 ta, fayl 6 ta, qator ≤5k — asosiy maqsadlar bajarilgan; qoida 11 ("50 odam uchun yetarli = tugadi") bo'yicha majburiy emas. Qilinsa: bir klaster → harness → 1 commit.
- [x] **4.9 Ixchamlash** (branch `diet/04-css-5k`, 2026-09-29): `CSS/*.css` izohsiz (faqat top-level sarlavha), bo`sh qatorsiz, oddiy qoida = 1 qator (<=240 belgi). **11 632 -> 4 430 qator** (maqsad <=5k), 293 645 -> 255 355 bayt (-13%). Bu FORMAT o`zgarishi, kontent kamaymadi: normalizatsiya isboti (izohsiz/bo`shliqsiz matn eski == yangi) 24/24 fayl, computed-style harness 4 542 holat x 2 viewport, FARQ 0. Asbob: `~/Claude/tools/css-regress/compact.mjs`. Fayl soni 24 → 6 (4.10), `!important` 239 → 12 (4.6).
- [x] **4.10 Fayllar 24 -> 6** (branch `diet/04-css-merge`, 2026-09-29): `CSS/tokens, base, features, layers, admin, mono-x.css`; `style.css` (@import master) va 23 eski fayl o`chirildi, `scripts/build-css.mjs` 6 faylni shu tartibda yig`adi. Kaskad tartibi o`zgarmagan: yig`ilgan `app.css` ning izohsiz/bo`shliqsiz matni eskisi bilan AYNAN bir xil (norm isboti). Fayl maqsadi (<=6) va qator maqsadi (<=5k: 4 587 app.css / 4 4xx manba) bajarildi; `!important` (239) 4.6 da 12 ga tushirildi.

**Joriy `!important` o'lchovi (2026-09-30):** jami **12** ta (`cat CSS/*.css | grep -o '!important' | wc -l`); har sessiya boshida qayta o'lchanadi.

**Qayta o'lchov (2026-09-29 kech, `CSS/*.css`, 23 fayl):** jami **353**; x-design **116**, chat 74, mono 58, nav 21, feed 16, sidebar-x 14, profile 13, ui-improvements 9, no-animations 8, local-utility 8, groups 5, dark-theme-fix 3.

**Xavf:** o'rta–yuqori (vizual buzilish, dark theme). **Yumshatish:** skrinshotlar + Preview + kichik commitlar.
**Kutilgan natija:** 24 fayl → ≤ 6, ~17k → ≤ 5k qator, bitta CSS so'rov.

---

## FAZA 5 — Realtime va presence 🔶 (5.1/5.2 ✅, 2026-09-29)

- 5.1 Presence DB→Realtime: ✅ tag `diet-progress-05` (Realtime Presence kanali, `last_seen` faqat chiqishda `sendBeacon` bilan).
- 5.2 Typing DB→Broadcast: ✅ broadcast'ga o'tgan. `typing_until` izlari `chat.js`/`config.js`/`auth.js` da hali bor; ustunni drop qilish (`patch-diet-05-contract.sql`) — 1 hafta kuzatuvdan keyin.
- 5.3 Kanallarni birlashtirish: 🔶 (2026-09-29, `diet/05-realtime`) `right-rail-rt` olib tashlandi (`postsUpdated` + 15 s tick), `chat-notice` → `chats-watcher`ga qo'shildi: `groups-watcher` ham `chats-watcher`ga qo'shildi (`bindGroupsRealtime`, `diet/05-realtime-2`): doimiy kanallar ~8 → 5 (`profile-<uid>`, `posts-feed`, `chats-watcher`, `incoming-calls-<uid>`, presence). Qoldi: `profile-<uid>` ↔ boshqalar (ixtiyoriy), thread kanallari (`thread-`, `gthread-`, `peer-`, `typing-bc-`) alohida qoladi. ✅ 2 qurilmada sinalgan (MR, 2026-09-30). Eski holat: ❌ `sb.channel(` hali ~18 ta joyda (auth, chat, groups, call, admin fayllari). Maqsad: bitta `me:<uid>` kanali + `incoming-calls-<uid>` + thread kanallari + admin → ~3–4. Xavf: filter chalkashishi — bitta-bitta ko'chir, 2 qurilmada sinab ko'r.
- 5.4 `bump_post_counters` triggerlari [QAROR Q8]: ❌ tegilmagan (hozircha qolsin).

**Tekshiruv:** 2 ta qurilma: onlayn nuqta, "yozmoqda", xabar darhol keladi, qo'ng'iroq keladi.
**Kutilgan natija:** onlayn userda DB yozuv ~2.4/daq → ~0.

---

## FAZA 6 — Data qatlami va Service Worker 🔶 (2026-09-29)

### 6.1 Firestore adapterini olib tashlash — ✅ (2026-09-29, `diet/06-drop-ts`)
- `Ts` klassi o'chirildi: `ts()` endi oddiy epoch-ms (number|null), `toIso()` soddalashdi; barcha `.toMillis()`/`.toDate()` chaqiruvlari (auth, chat, groups, explore, utils, view-users, local-cache) number bilan ishlaydi. Yon foyda: keshdan (number) o'qilganda `toMillis?.() || 0` 0 qaytarib saralashni buzadigan yashirin xato ham yo'qoldi. Tekshiruv: `node --check` 33 modul, mapper testi (mapProfile/Chat/Group/Message/Post — Ts obyekti yo'q), headless-chromium yuklanishi. Onlayn (chat tartibi, blok tugashi, oxirgi faollik) — MR sinovi.
- (eski holat, tarixiy):
- `config.js`: `Ts` klassi (`config.js:32`), `ts()`, `toIso()`, mapperlar — 8 modul ishlatadi (`auth`, `call`, `chat`, `explore`, `groups`, `local-cache`, `view-users`, `config`).
- Bosqichma-bosqich: avval mapperlar oddiy `number` qaytarsin, keyin modul-modul ko'chir. Ustuvorlik: **past** (foya: soddalik, xavf: yuqori).

### 6.2 Service worker — 🔶
- [x] **Q6 tavsiyasi: nom O'ZGARMASIN** (`firebase-messaging-sw.js`), izoh yoz. *(Push obunalari nomga bog'liq.)*
- [x] **Cache versiyasi avtomatik:** `build-env.mjs` build vaqtida `CACHE_VERSION` ga vaqt tamg'asini yozadi (`t-<timestamp>`).
- [x] **HTML strategiyasi:** network-first (3 s timeout) → kesh fallback (tag `diet-progress-04b`).
- [x] **Yangilanish xabari:** SW `skipWaiting` qiladi, shuning uchun `controllerchange` (sahifa ochiq paytida) → pastda "Yangi versiya bor · Yangilash" paneli (`index.html`, branch `diet/06-sw-update-toast`). ✅ brauzerda sinalgan (MR, 2026-09-30) (qoida 8): stil inline, `#000`/`#fff`.
- [x] `PRECACHE_URLS` tekshirildi (2026-09-29, `diet/06-precache`): ro'yxatdagi barcha 33 URL diskda bor (`/app.css` to'g'ri); `allSettled` himoyasi joyida. Ro'yxatda yo'q 7 modul qo'shildi: `admin-reset-password, chats-x, compress, right-rail, shortcuts, sidebar, stories`. ⚠️ Yangi modul qo'shilganda ro'yxatni ham yangilash kerak (qo'lda). Offline ochilish sinalgan (MR, 2026-09-30).

### 6.3 Supabase kutubxonasi — ✅ (2026-09-29)
- `modules/vendor-supabase.js` (94 KB): supabase-js 2.39.3 + transitiv paketlar jsdelivr bilan AYNAN bir xil versiyalarga qadalgan (gotrue 2.62.0, postgrest 1.9.1, realtime 2.9.3, storage 2.5.5, functions 2.1.5). `config.js` shundan import qiladi, SW precache'ga qo'shildi — CDN yiqilsa ham ilova ochiladi.
- Lokal headless-chromium: modul xatosiz yuklandi. Onlayn login/realtime — MR sinovi.

**Xavf:** yuqori. Alohida preview + haqiqiy telefonda sinov shart.

---

## FAZA 7 — Family-grade mustahkamlash 🔶 (2026-09-29)

| # | Vazifa | Nima uchun | Holat |
|---|---|---|---|
| 7.1 | Admin parol reset | 2-fazada. Eng katta real og'riq | ✅ |
| 7.2 | Storage kvotasi | limit 25 MB ✅ (2026-09-29: avval kodda 50/30 MB edi, endi `MAX_FILE`/`STORY_MAX` = 25 MB, `diet/08-docs`), `compress.js` bor; admin sarf-ko'rsatkichi ✅ kod (2026-09-30, `modules/admin-storage.js`, admin panelda bitta qator + chiziq; DB: `migrations/015_diet-07-storage-usage.sql` RPC ✅ bajarilgan; yo'q bo'lsa jim ishlaydi) | ✅ |
| 7.4 | TURN | Cloudflare TURN: `api/turn.js` (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`, 24 soatlik kredensial), mijozda `call.js` `_refreshIce`; statik `TURN_*` (`build-env.mjs`) va OpenRelay — zaxira. Vercel'da env + Wi-Fi→mobil sinovini MR tekshirsin `[TEKSHIR]` | ✅ (MR, 2026-10-01) |
| 7.5 | Media maxfiyligi | `[QAROR Q7]` public bucket hozircha qolsin, rasmiy qaror sifatida yozilsin | ✅ README "Qarorlar" bo'limiga yozildi |
| 7.6 | Rate limit | Past ustuvorlik; faqat yuborish tezligi | ✅ (2026-09-30, `modules/rate-limit.js`: sirpanuvchi oyna, mijoz tomonida — xabar 8/10 s, fayl 5/30 s, izoh 6/20 s; `chat.js`, `groups.js`, `comments.js` da bittadan qator. Xavfsizlik chegarasi EMAS, faqat bosib qolish/spamdan) |
| 7.7 | Xatolarni ko'rish | `window.onerror` + ixtiyoriy `client_errors` jadvali. Overengineering'ga qaytma | ✅ (2026-09-30, `modules/error-log.js`: oxirgi 20 xato localStorage'da — konsolda `__mrErrors()`; jadval bo'lsa sessiyada ≤5 ta `client_errors`ga; DB: `migrations/014_diet-07-client-errors.sql`, ixtiyoriy, istalgan vaqtda) |
| 7.8 | Onboarding matni | admin reset bor → "unutsangiz admin (MR) yangi parol beradi" | ✅ (`a3d0e14`) |

---

## FAZA 8 — Hujjat va smoke test 🔶 (qisman)

- [x] Roadmap (`MRSPACE-ROADMAP.md`) repoga saqlandi va holatga ko'ra yangilandi (2026-09-28).
- [x] `AUDIT.md` C10–C12 bo'limlari: holat qayta tekshiruvi, regressiya tahlili, link-tartibi tuzatilishi yozildi.
- [x] `README.md` qayta yozildi: 43 qator (2026-09-29, `diet/08-docs`); eskisi `docs/archive/README-old.md`.
- [x] UI xaritasi eski README bilan `docs/archive/` ga; `AUDIT.md` → `docs/archive/AUDIT.md`.
- [x] Patchlar `supabase/migrations/NNN_*.sql` ga raqamlandi (2026-09-29, `diet/08-migrations`). `000_schema.sql` jonli bazadan qayta yig'ilgan (`ed8c6a3`, 2026-09-30).
- [x] Smoke test ro'yxati `docs/SMOKE.md` ga ko'chirildi.
- [x] Playwright smoke (2026-09-30): `node tests/smoke.mjs` — lokal statik server, desktop+mobil: sahifa ochiladi, JS xatosi yo'q, resurslar 4xx yo'q, `app.css`, login ekrani, gorizontal scroll yo'q, `error-log`. 14/14 o'tdi. Login/post/chat qadamlari `TEST_EMAIL`/`TEST_PASSWORD` (alohida TEST akkaunt) berilganda yuradi — hozir faqat login qadami yozilgan; post/chat `[ ]`.

---

## 6. O'lchov jadvali (har fazadan keyin to'ldir)

| Ko'rsatkich | Baseline | F1 | F2 | F3 | F4 | F5 | F6 |
|---|---|---|---|---|---|---|---|
| Jami qator | 31.6k | ~31.5k (−64) | | | −104 (x-design) | | |
| CSS fayl / qator | 24 / 17.4k | 24 / ~17.4k | | | 22 / 17 055 | | |
| JS qator | ~13k | ~13.4k* | 13 472 (`modules/*.js`; F2 boshida 14 548) | | | | |
| Realtime kanal / user | ~8–10 | | | | | | |
| DB yozuv / onlayn user / daq | ~2.4+ | | | | | | |
| `!important` (x-design) | 76 | | | | **26** | | |
| Yuklash hajmi (mobil, kesh yo'q) | [MR DevTools] | | | | | | |
| Lighthouse (mobile perf) | [MR] | | | | | | |

*\*Hisob chegaralari farqi (SW/index.html hisobga kirgan); tendensiya muhim. CSS fayllar 22, chunki `auth-ig-style.css` allaqachon o'chirilgan (AUDIT C9).*

**Qayta o'lchov (2026-09-30 kech, `HEAD` = `816e98b`):**

| Ko'rsatkich | Qiymat |
|---|---|
| `modules/*.js` | 38 fayl, **12 826** qator |
| `CSS/*.css` | **6 fayl, 4 593** qator (manba); `app.css` 4 594 qator |
| `!important` | **12** |
| `sb.channel(` chaqiruvlari | 13 ta joyda: chat 4, auth 3, call 2, admin-badge 1, groups 1, view-actions 1, view-users 1 |

**Oldingi o'lchov (2026-09-29 kech, `main`):**

| Ko'rsatkich | Qiymat |
|---|---|
| `modules/*.js` | 33 fayl, **12 624** qator |
| `CSS/*.css` | 23 fayl, **16 737** qator (manba); `app.css` — yig'ma |
| `sb.channel(` chaqiruvlari | 14 ta joyda: chat 5, auth 3, call 2, admin-badge 1, groups 1, view-actions 1, view-users 1 |
| `explore.js` | 281 qator (`main`); `diet/03-explore` da 179 |


---

## 7. Smoke test ro'yxati (har faza oxirida)

*(Mazmun o'zgarmadi. Status: 2026-09-30 da MR barcha punktlarni brauzer/qurilmada o'tkazdi.)*

**Auth**
- [x] Yangi user ro'yxatdan o'tadi → "kutish" ekrani
- [x] Admin tasdiqlaydi → user ilovaga kiradi
- [x] Admin rad etadi → "rad etildi" ekrani
- [x] Bloklangan user kira olmaydi; blok tugagach kiradi

**Lenta**
- [x] Rasm/video post yuklanadi (≤ limit), lentada ko'rinadi
- [x] Like, izoh ishlaydi; markdown (qalin/egik) chiqadi

**Chat**
- [x] Yozma, ovozli xabar, fayl yuboriladi
- [x] Reply, qidiruv, o'qildi belgisi
- [x] "Yozmoqda..." va onlayn/oxirgi faollik (5-fazadan keyin 2 qurilmada)
- [x] Push bildirishnoma (telefon yopiq holda) keladi

**Guruh**
- [x] Guruh yaratiladi, a'zo qo'shiladi, xabar keladi
- [x] Faqat-adminlar rejimi (ex-kanal) ishlaydi

**Qo'ng'iroq**
- [x] Audio va video qo'ng'iroq Wi-Fi ↔ mobil tarmoqda ulanadi

**Admin**
- [x] E'lon yuboriladi va hamma ko'radi
- [x] Parol reset (2-fazadan keyin)
- [x] O'chirilgan user ma'lumoti ketadi

**Texnik**
- [x] Konsolda qizil xato yo'q
- [x] Yangi deploydan keyin user ilovani ochsa yangi versiya keladi (6-fazadan keyin)
- [x] Dark/light va mobil/desktop tartib buzilmagan

---

## 8. Qarorlar jurnali (ochiq savollar)

| # | Savol | Tavsiya | Qaror |
|---|---|---|---|
| Q1 | Guruhlar: hamma ko'radimi (A) yoki faqat taklif (B)? | B | **B** (2026-09-29, MR) |
| Q2 | Muqova rasmi qolsinmi? | Oddiy yuklash, crop yo'q | **De-fakto: olib tashlangan** (3.5, `bd3fb42`; kodda shunday, MR tasdiqladi 2026-10-01) |
| Q3 | Profilda website/location? | O'chir | **O'chirildi** (2026-09-29, MR tasdiqi) |
| Q4 | Eski shaxsiy postlar? | Egasi bilan hal qil | Kerak emas: bazada 0 ta shaxsiy post (3.6 sanovi, 2026-09-30) |
| Q5 | Parol reset: majburiy almashtirish? | Yo'q | **Yo'q** (2026-10-01) |
| Q6 | SW nomini o'zgartirish? | Qolsin (`firebase-messaging-sw.js`), izoh yoz | **Qolsin** (izoh yozildi, 2026-09-29) |
| Q7 | Media bucket public qolsinmi? | Qolsin, rasmiy qaror sifatida yoz | **Qolsin** (README, 2026-09-29) |
| Q8 | Like/comment counter triggerlari? | Hozircha qolsin | **De-fakto: qolgan** (5.4 tegilmagan; MR tasdiqladi 2026-10-01) |
| Q9 | Splash/loading animatsiya? | Bitta yengil animatsiya qoldir | **Mavjud aylanuvchi `.spinner` qoladi** (2026-10-01; kod o'zgarmaydi) |
| Q10 | Supabase Pro'ga o'tish? | Storage 1 GB dan oshsa | **Hozir kerak emas**; admin paneldagi Storage qatori kuzatadi (2026-10-01) |
| Q11 | *(yangi, F4'dan)* Mono palitrada accent fonlarda matn `#000` (qora) bo'lishi — tasdiq? | Ha, mono maqsadi shu; lekin `.nav-badge`, `.chat-voice-btn.recording`, `.cmt-send` MR ko'z testi bilan tasdiqlansin | **Ha** (2026-10-01) |

---

## 9. Xavflar reestri

| Xavf | Ehtimol | Ta'sir | Yumshatish | Holat |
|---|---|---|---|---|
| CSS qayta yig'ishda dark/mobil buzilishi | yuqori | o'rta | Skrinshot taqqoslash, fayl-bittalab commit, preview | ⚠️ qisman realized: C11 regressiyasi yuz berdi, C12'da ildiz topildi va tuzatildi; yakuniy brauzer-testi hali oldinda |
| Push obunasi uzilishi (SW o'zgarganda) | o'rta | yuqori | Nom o'zgartirmaslik (Q6) | ochiq |
| Kanal→guruh migratsiyasida ma'lumot yo'qolishi | past | yuqori | Export, idempotent SQL, test guruh | ochiq |
| Realtime birlashtirishda xabar/bildirishnoma yo'qolishi | o'rta | o'rta | Bitta-bitta ko'chirish, 2 qurilmada sinov | ochiq |
| Storage 1 GB to'lishi | o'rta | yuqori | Siqish + limit + monitoring (7.2) | ochiq |
| Testsiz refaktor (Ts adapter) | yuqori | o'rta | 6.1 ni oxirga qoldir, modul-modul | ochiq |
| Admin panelni qayta yozishda xavfsizlik teshigi | past | yuqori | RLS/guard tegilmaydi; admin tekshiruvi serverda (`is_admin()`) | ochiq |
| Vercel build yiqilishi (env yo'q) | past | o'rta | Preview'da tekshir (0-faza) | ochiq |

---

## 10. Git va deploy tartibi

```
main  (816e98b, 2026-09-30)
 ├─ diet/00-safety      (tag: pre-diet)        ← qismiy (tag/remote bor; preview/smoke MR ishi)
 ├─ diet/02-admin       ✅ main'ga qo'shilgan
 ├─ diet/03-channel-*, 03-groups-b, 03-product-profile   ✅ main'ga qo'shilgan
 ├─ diet/03-explore, 01-vercel-cleanup, 06-precache, 04-inventory, 03-6-query   ✅ main'ga qo'shilgan (2026-09-29, tag `pre-merge-0929` = qaytish nuqtasi). ⚠️ Preview/brauzerda sinalmagan
 ├─ diet/04-css*        ✅ main'ga qo'shilgan (4.4/4.5); qolgani 4-fazada
 ├─ diet/05-realtime, 05-realtime-2   ✅ main'ga qo'shilgan
 ├─ diet/06-sw-update-toast           ✅ main'ga qo'shilgan
 ├─ diet/07-family      ✅ main'ga qo'shilgan
 └─ diet/08-docs, 08-migrations       ✅ main'ga qo'shilgan
```

1. Branch → push → Vercel Preview → smoke test (7-bo'lim) → `main` ga merge.
2. Har merge'dan keyin **tag** (`diet-01`, `diet-02`, ...).
3. DB patch tartibi: **kod deploy → 1 hafta → contract SQL.**
4. Oilaga xabar: 5 va 6-fazalar deploydan keyin "ilovani bir marta yopib oching".

---

## 11. Non-goals (buni QILMAYMIZ)

- Ommaviy ro'yxatdan o'tish, email tasdiqlash, ijtimoiy graf (follow/recommend).
- Analytics, A/B, feature flags, murakkab monitoring.
- Framework'ga ko'chish (React/Vue): vanilla JS qoladi. Muammo framework emas, ortiqcha funksiya.
- Guruh/kanal hamjamiyat funksiyalari (public discovery, katta auditoriya).
- Har narsani "ideal" qilish. 50 odam uchun yetarli = tugadi.

---

## 12. Tavsiya etilgan bajarish tartibi (yangilangan, 2026-09-29)

1. ~~F0 → F1~~ **F1 tayyor** (`09bce2c`, −64 q). F0 ning tashqi qismlari (tag, remote, preview, smoke) — MR terminal/dashboard/brauzer ishi, ro'yxat yuqorida.
2. **F4 to'xtash nuqtasi:** MR brauzerda 8 ekran solishtirsin (ayniqsa `.nav-badge`, `.chat-voice-btn.recording`, `.cmt-send`). Tasdiq → 4.1b inventar; rad → `git revert fbbcd8b`.
3. **F2 dietasi** (2.1–2.9; parol reset tayyor) — eng katta real foyda; F4 testini kutmaydi.
4. **F3** qolgani: 3.1 Explore→filtr kod tayyor (`diet/03-explore`, brauzer sinovi + merge); kanal→guruh, invite/ochiq-maxfiy, `website`/`location`, views, cover tayyor. 3.6 ham yopildi.
5. **F7.2–7.4** (storage, TURN) — bular ilovani omon saqlaydi, F4–F6 dan oldin ham bo'ladi.
6. **F4** davomi (chat.css ↔ mono → qolgan fayllar), keyin **F5**, **F6**.
7. **F8** (hujjat).

> **2026-09-30:** brauzer/qurilma tekshiruvlari (2-band F4 to'xtash nuqtasi, F0 smoke, F5/F6 qurilma sinovi) MR tomonidan o'tkazildi. Keyingi qadamlar: Vercel Preview + TURN_*, F4 4.3/4.4/4.8, DB contract (013: 2026-10-06 dan keyin), Q9/Q11.

### Yakuniy holat (2026-09-30 kech) — ESKI, hammasi 2026-10-01 da yopildi (pastga qarang)

**Kod tomoni tugadi.** Roadmapda faqat quyidagilar ochiq, ularni AI o'zi yopa olmaydi (ro'yxat: `docs/MR-QOLGAN.md`):

- [x] Vercel Preview + TURN sinovi (Wi-Fi ↔ mobil qo'ng'iroq).
- [x] 013 contract (`posts.views`, `increment_post_view()`): 2026-10-06 dan keyin, `supabase db dump` zaxirasi bilan. 007/008/009/010/011/012 — no-op, `migrations/` ga ko'chirish yoki o'chirish (MR tasdig'i). — YURGIZILDI (2026-10-01)
- [x] Qarorlar: Q5 (parol reset: majburiy almashtirish), Q9 (splash animatsiya), Q10 (Pro'ga o'tish, hozir dolzarb emas), Q11 (mono `#000` accent matn), F2 `[QAROR]`; Q2/Q8 — MR tasdig'i.
- [x] Ixtiyoriy: 4.8, 5.3 (`profile-<uid>` birlashtirish), 5.4 (Q8), Playwright post/chat qadamlari (`TEST_EMAIL`/`TEST_PASSWORD`). — BEKOR (2026-10-01)

> Qoida: **avval kes, keyin tartibla, oxirida chiroy.** Va C11 saboqi: **ko'z tekshiruviga qadar "tozalandi" dema.**

### Yakuniy yopilish (2026-10-01)

MR: "barcha ish bo'lgan". Natija:

- [x] Vercel deploy/Preview, TURN sinovi (Wi-Fi ↔ mobil) — MR tomonidan bajarildi.
- [x] Qarorlar: Q5 yo'q, Q9 mavjud `.spinner`, Q10 hozir kerak emas, Q11 ha, Q2/Q8 tasdiqlandi; F2 `[QAROR]` = Q5.
- [x] `supabase/unfulfilled/007`–`012` → `supabase/migrations/` (jonli dump bo'yicha no-op, hammasi idempotent; `git mv`).
- [x] Ixtiyoriylar BEKOR (qoida 11, "50 odam uchun yetarli = tugadi"): 4.8, 5.3 (`profile-<uid>` birlashtirish), 5.4 (Q8), Playwright post/chat qadamlari (alohida TEST akkaunt kerak).
- [x] **013 contract** (`posts.views`, `increment_post_view()`): MR (root) ruxsati bilan 2026-10-01 da, 1 haftalik kuzatuvdan OLDIN yurgizildi (qoida 3 ongli ravishda chetlab o'tildi). Zaxira: `~/Claude/backups/` (schema dump + `posts.views` JSON). Topilma: `posts_insert` RLS policy `views = 0` ga tayangan edi — policy shu shartsiz, qolgan shartlari aynan o'sha holda qayta yaratildi (bitta tranzaksiya). Tekshiruv: ustun yo'q, funksiya yo'q, policy yangi, 6 post joyida. Fayl `migrations/013_diet-views.sql` ga ko'chirildi.

**ROADMAP 100% YOPILDI (2026-10-01).**
