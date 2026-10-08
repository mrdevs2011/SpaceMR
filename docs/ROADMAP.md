# SpaceMR — Mahsulot Roadmap (10 band)

Bu fayl AI agent (Claude Code) va dasturchi uchun. Har bir bandni alohida branch'da, kichik commit'lar bilan bajaring.

## Qat'iy qoidalar

- **Faqat dark mode.** Light (yorug') mode QO'SHILMAYDI. Mavzu almashtirgich (theme toggle) qilinmaydi. Mavjud `data-theme="dark"` o'zgarmaydi.
- UI matnlari **o'zbekcha** (lotin). Xato xabarlari tushunarli bo'lsin ("Xato" emas, "Internet yo'q, qayta urinib ko'ring").
- Yangi CSS `!important` bilan to'ldirilmasin; avval mavjud qoidani toping va o'sha yerni tuzating (`CSS/` papka, `app.css` build natijasi: `node scripts/build-css.mjs`).
- Mobil (≤1099px) va desktop (≥1100px) alohida tekshiriladi.
- `main`ga to'g'ridan-to'g'ri push qilinmaydi: branch → preview → merge.
- Bazaga tegadigan o'zgarishdan oldin zaxira (`scripts/backup-db.sh`), migratsiya `supabase/` ichida.
- Maxfiy kalit/token repoga yozilmaydi.

## Tartib (ustuvorlik)

| Faza | Bandlar | Nega avval |
|------|---------|------------|
| 1 — Ishonch | 4 (oflayn), 9 (xatolar), 10 (fikr-mulohaza) | Ilova qotmasin, muammo ko'rinsin |
| 2 — Tezlik va asosiy tajriba | 2 (tezlik), 5 (chat), 6 (kamroq bosish) | Kundalik foydalanish |
| 3 — O'sish va ishonch | 1 (birinchi kirish), 7 (maxfiylik), 3 (bildirishnoma) | Yangi foydalanuvchi, xavfsizlik |
| 4 — Qaytarish | 8 (qayta qaytarish) | Qolgan hammasi tayyor bo'lgach |

---

## 1. Birinchi kirish tajribasi

**Maqsad:** yangi foydalanuvchi bo'sh lentani ko'rmasin.

- [ ] Birinchi kirishda 2–3 qadamli qisqa tanishtiruv (lenta, chat, SpaceMR guruhi). Bir marta ko'rsatiladi, o'tkazib yuborish tugmasi bor.
- [ ] Lenta bo'sh bo'lsa: "Odamlarni toping" ro'yxati (qidiruv/foydalanuvchilar sahifasiga havola).
- [ ] "Ko'rsatildi" belgisi `localStorage`da (kalit nomi `spacemr_*` formatida).
- [ ] Tanishtiruvda "Muammo bo'lsa SpaceMR guruhiga yozing" (7-band va 10-bandga bog'liq).

**Qabul mezoni:** yangi hisob bilan kirganda tanishtiruv bir marta chiqadi, qayta kirganda chiqmaydi; bo'sh lentada bo'sh ekran emas, yo'naltiruvchi blok bor.

## 2. Tezlik

**Maqsad:** lenta va chat darrov ochilsin.

- [ ] Avval keshdagi ma'lumotni ko'rsatish, yangisini orqada yuklab almashtirish (mavjud `modules/core/store/` kesh qatlamidan foydalaning).
- [ ] Skelet (shimmer) yuklanish ko'rinishi: lenta, chat ro'yxati, profil.
- [ ] Rasm/videolar lazy-load; lentada ko'rinmagan media yuklanmasin.
- [ ] O'lchash: birinchi ko'rinadigan kontentgacha vaqt (mobil, 4G). Natijani shu faylga yoki `docs/`ga yozing.

**Qabul mezoni:** ikkinchi ochilishda lenta keshdan 1 soniyadan kam vaqtda ko'rinadi; yuklanish paytida bo'sh qora ekran yo'q.

## 3. Bildirishnomalar

**Maqsad:** faqat kerakli narsalar, foydalanuvchi sozlay olsin.

- [ ] Push faqat: yangi xabar, izohga javob, tilga olish (mention). Har bir layk uchun push yo'q.
- [ ] Sozlamalarda turlar bo'yicha yoqish/o'chirish.
- [ ] Suhbat va guruhni **ovozsiz qilish** (mute).
- [ ] Ilova ichidagi bildirishnoma sahifasi (`notifs`) bilan push turlari mos bo'lsin.
- Eslatma: vaqt bo'yicha "tinch soatlar" va mavzu sozlamalari bu bandga kirmaydi.

**Qabul mezoni:** o'chirilgan tur uchun push kelmaydi; mute qilingan guruhdan push kelmaydi, lekin ilovada o'qilmagan soni ko'rinadi.

## 4. Oflayn holat

**Maqsad:** internet uzilsa ilova qotmasin.

- [ ] "Ulanish yo'q" yo'lagi (banner), ulanish qaytganda o'zi yo'qoladi.
- [ ] Yozilgan chat xabari oflaynda navbatga tushadi va ulanganda yuboriladi; holat belgisi ("yuborilmoqda", "yuborilmadi — qayta urinish").
- [ ] Post yozish: oflaynda qoralama sifatida saqlanadi.
- [ ] Service worker (`sw.js`): server yo'naltirishi (302 → `/login`) keshdagi qobiq bilan almashtirilmasligi saqlansin (regressiya bo'lmasin).
- [ ] Oflayn bo'lganda har bir so'rov xatosi aniq xabar bilan ko'rsatiladi, bo'sh ekran emas.

**Qabul mezoni:** samolyot rejimida ilova ochiladi, keshdagi lenta/chat ko'rinadi, xabar yozish mumkin; ulanganda xabar yuboriladi.

## 5. Chat sifati

**Maqsad:** ilovadagi eng ko'p ishlatiladigan qism ravon bo'lsin.

- [ ] Tekshirish: o'qildi belgisi, javob berish (reply), reaksiyalar, ovozli xabar, pin — qaysilari to'liq ishlashini ro'yxatga oling, yo'qlarini qo'shing.
- [ ] Chat ichida xabar qidirish.
- [ ] Uzun suhbatda tez scroll (virtualizatsiya yoki sahifalash), yuqoriga scrollda eski xabarlar.
- [ ] Yozayotgani ("yozmoqda…") ko'rsatkichi (agar yo'q bo'lsa).
- [ ] Media xabarlarda yuklash progressi va xatoda qayta urinish.

**Qabul mezoni:** 1000+ xabarli suhbat qotmaydi; xabar qidiruvi natija beradi; ovozli va rasmli xabar xatoda qayta yuborilishi mumkin.

## 6. Kamroq bosish

**Maqsad:** asosiy amallar bir tegishda.

- [ ] Eng ko'p ishlatiladigan amallarni aniqlang: post yozish, chatga o'tish, SpaceMR guruhi, bildirishnomalar.
- [ ] Header va pastki menyuda ortiqcha tugmalarni olib tashlang yoki "yana" menyusiga o'tkazing.
- [ ] Bugungi header qoidasi saqlansin: chapda logo (bosilsa home + faqat feed/story yangilanadi), yonida "SpaceMR" yozuvi (bosilsa guruh chati).
- [ ] Profil sozlama tugmasi desktopda ko'rinmaydi, faqat mobilda.
- [ ] Barcha bosiladigan elementlar mobilda kamida 44×44px.

**Qabul mezoni:** post yozish va chatga o'tish 1–2 teginish; header'da takroriy logo/tugma yo'q.

## 7. Maxfiylik va xavfsizlik

**Maqsad:** yopiq tarmoqda ishonch.

- [ ] Post/story kimga ko'rinishi aniq belgilansin.
- [ ] Foydalanuvchini bloklash va kontentga shikoyat qilish tugmasi (profil va post menyusida). Hozir mavjudligini tekshiring.
- [ ] Hisobni o'chirish oson topilsin (sozlamalarda), tasdiqlash bilan. Chiqqandan keyin `/login` ga o'tadi.
- [ ] `privacy.html` va `terms.html` sozlamalardan havola bilan ochilsin.
- [ ] Muammo/shikoyat uchun yo'l: SpaceMR guruhi (10-band).

**Qabul mezoni:** bloklangan foydalanuvchi xabar yoza olmaydi va kontenti ko'rinmaydi; hisobni o'chirish 3 teginishdan oshmaydi.

## 8. Qayta qaytarish (yengil)

**Maqsad:** ortiqcha bosimsiz, odamni ilovaga qaytarish.

- [ ] Yangi story'lar uchun nuqta/halqa (allaqachon bor story halqasini tekshiring).
- [ ] O'qilmagan xabar/bildirishnoma soni (belgi).
- [ ] Ixtiyoriy: haftalik qisqa xulosa ("bu hafta 12 ta yangi post"), faqat ilova ichida.
- [ ] Streak yoki majburlovchi mexanika QO'SHILMAYDI, agar foydalanuvchi so'ramasa.

**Qabul mezoni:** foydalanuvchi ilovani ochmasdan nima yangi ekanini bilmaydi, lekin ochganda darrov ko'radi; hech qanday bezovta qiluvchi eslatma yo'q.

## 9. Xatolik xabarlari

**Maqsad:** tushunarli o'zbekcha matn.

- [ ] Barcha `toast(..., 'error')` va `catch` matnlarini ro'yxatga oling.
- [ ] Texnik xabar ("Failed to fetch", `e.message`) foydalanuvchiga ko'rsatilmasin; o'rniga: sabab + nima qilish kerak.
- [ ] Namuna matnlar: "Internet yo'q, qayta urinib ko'ring", "Server javob bermadi, birozdan keyin urinib ko'ring", "Bu amalga ruxsat yo'q".
- [ ] Texnik tafsilot `client_errors`ga yoziladi (foydalanuvchiga emas).

**Qabul mezoni:** ilovada inglizcha yoki texnik xato matni qolmagan.

## 10. Fikr-mulohaza (SpaceMR guruhi orqali)

**Maqsad:** muammo va takliflar bir joyga tushsin; alohida forma kerak emas.

- [ ] Chap paneldagi va header'dagi "SpaceMR" tugmasi guruh chatini ochadi (mavjud). Tooltip: "Muammo va takliflar".
- [ ] Guruhda "Muammo yoki taklif bo'lsa shu yerga yozing, imkon bo'lsa skrinshot bilan" xabarini qadang (pin).
- [ ] Birinchi kirishda (1-band) bir marta shu haqda eslatma.
- [ ] Sozlamalarda "Muammo haqida yozish" qatori ham SpaceMR guruhini ochadi.
- [ ] Qora ekran qo'riqchisidagi "Ilova ochilmadi" panelida "Guruhga yozish" havolasi (ochilishi mumkin bo'lsa).

**Qabul mezoni:** foydalanuvchi har qanday ekrandan 2 teginishda guruhga muammo yoza oladi.

---

## Umumiy "tayyor" mezoni (har band uchun)

1. Mobil va desktopda qo'lda tekshirilgan.
2. Login → logout → qayta kirish oqimi buzilmagan (qora ekran yo'q).
3. `node --check` va mavjud testlar o'tgan (`tests/`).
4. UI matnlari o'zbekcha, dark mode'da to'g'ri ko'rinadi.
5. Kichik commit, tushunarli xabar bilan; branch → preview → `main`.
