# SpaceMR — Konsolidatsiya Roadmap

> Maqsad: **kam kod → ko‘p narsa**. Bir ish = bir joy. Brauzerga baribir **bitta** `app.css`.
> Sana: 2026-10-04 · Holat: **faol**

---

## 0. Temir qoidalar (buzilmasin)

1. **Bitta manba (SSOT)** — bir selector / bir helper faqat bitta faylda yashaydi.
2. **Oxirgi kaskad g‘olib** — hozir: `tokens → base → features → layers → admin → mono-x`.
3. **O‘xshash UI = bir xil class** — DM va guruh bitta bubble tizimi (allaqachon shunday).
4. **O‘chirishdan oldin** — computed-style yoki 2 qurilmada smoke; regressiya bo‘lsa revert.
5. **`app.css` qo‘lda tahrirlanmaydi** — faqat `CSS/*.css` + `npm run build` / `node scripts/build-css.mjs`.
6. **`git add -A` yo‘q** — faqat tegishli fayllar.
7. **Push:** `GIT_ASKPASS="$HOME/.gh-askpass.sh" GIT_TERMINAL_PROMPT=0`.

---

## 1. Hozirgi holat (audit 2026-10-04)

### CSS manbalar

| Fayl | ~qator | Rol |
|------|--------|-----|
| `tokens.css` | 105 | Rang, spacing, glass→solid alias |
| `base.css` | ~180 | Reset, auth, toast, asos |
| `features.css` | ~3100 | Feed, call, voice, ko‘p feature |
| `layers.css` | ~1300 | Qatlam/override aralash |
| `admin.css` | ~700 | Admin |
| `mono-x.css` | ~3600 | X-dizayn final theme (oxirgi so‘z) |
| **app.css** | ~9100 | Build chiqishi (ulanish) |

**Muammo:** ~344 selector **2+ faylda** takrorlanadi; chat-msg ~61 (features) + 72 (mono-x).

### JS (yaxshi tomonlar)

| Domen | SSOT | Holat |
|-------|------|--------|
| DM + guruh paint | `chat.js` → `paintMessages` | ✅ Guruh `paintGroupThread` orqali |
| Bubble HTML | `components/message-bubble.js` | ✅ |
| Umumiy chat helper | `chat-shared.js` | ✅ (+ `getChatFileIcon` 2026-10-04) |
| Right-rail | `ui/right-rail.js` + asosan mono-x | ✅ |
| Call | `call/call.js` + features CSS | ✅ |

### Qilingan (shu sessiyadan)

- [x] Chat domenida features/layers dan mono-x qayta yozgan property’lar tozalangan
- [x] `getChatFileIcon` ×3 → `chat-shared.js` ×1
- [x] Glass / backdrop-filter olib tashlangan
- [x] Call UI bitta clean blok (features)
- [x] Voice: chiziqli wave o‘chirildi, circular pulse + red REC

---

## 2. Domen egaligi (SSOT xarita)

Har domen uchun **yozish huquqi** bitta joyda. Boshqa faylda faqat *import / qayta-export*.

### 2.1 CSS domenlari

| Domen | Yozish (SSOT) | Boshqa faylda |
|-------|----------------|---------------|
| Tokenlar, tema | `tokens.css` | — |
| Auth / splash / toast | `base.css` | mono faqat rang override kerak bo‘lsa |
| **Chat thread + guruh bubble + voice + input** | `mono-x.css` | features/layers da **qayta yozilmasin** |
| **Call (incoming + active)** | `features.css` | mono da call deyarli yo‘q — saqlansin |
| **Feed / post / stories** | `features.css` | mono faqat micro-theme |
| **Right-rail / desktop shell** | `mono-x.css` | features da rr- yo‘q |
| **Nav / header / sidebar** | `mono-x.css` | — |
| **Admin** | `admin.css` | — |
| **Profile grid** | `features` layout + `mono-x` theme | |

### 2.2 JS domenlari

| Domen | SSOT | Qoida |
|-------|------|--------|
| Xabar chizish | `chat.js` `paintMessages` | Guruh faqat wrapper |
| Bubble markup | `message-bubble.js` | HTML string faqat shu yerda |
| Sana / pending / file icon | `chat-shared.js` | Duplicate helper yo‘q |
| Ovoz yozish | `chat-voice-record.js` | |
| Ovoz ijro | `chat-voice-player.js` | |
| RT mesh | `rt-chat.js` | |
| Guruh CRUD / a’zolar | `groups.js` | Paint qayta yozilmasin |
| Feed | `feed/feed.js` | |
| Call | `call/call.js` | |
| Install guide | `ui/install-guide.js` | Login + settings bir API |

---

## 3. Fazalar (ketma-ket, har biri alohida commit)

### Faza A — CSS dedupe (xavfsiz, avtomatik)
**Maqsad:** Bir xil selector + bir xil property: faqat oxirgi fayl qolsin.

| Qadam | Ish | DoD |
|-------|-----|-----|
| A1 | Chat/voice/grp selectorlar: features→mono props strip (qisman qilindi) | app.css build; chat ochiladi |
| A2 | Qolgan `features ∩ mono` (119 selector) — prop-level strip | Diff faqat o‘lik props |
| A3 | `layers ∩ mono` (104) — xuddi shu | layers kichrayadi |
| A4 | `layers ∩ features` (80) — layers g‘olib yoki features; ikkalasi emas | |

**Vosita:** prop-level script; har commitdan keyin login, chat 1v1, guruh, call, feed smoke.

### Faza B — Chat CSS yakuniy uyushtirish
**Maqsad:** DM + guruh = **bir visual tizim**, kodda ham.

| Qadam | Ish | DoD |
|-------|-----|-----|
| B1 | Chat thread stillari **bitta** faylda (tavsiya: mono-x SSOT; features dan ko‘chirish) | Faqat bitta manba |
| B2 | `.grp-*` faqat guruh form/members; bubble = `.chat-*` | Guruh thread = DM |
| B3 | Call faqat features; mono call override yo‘q | Call OK |

### Faza C — JS yupqalashtirish

| Qadam | Ish | DoD |
|-------|-----|-----|
| C1 | Bubble string → faqat `message-bubble.js` | |
| C2 | groups HTML dublikatlari → shared | |
| C3 | Feed + chat file icon → ixtiyoriy `core/file-icons.js` | |
| C4 | `icons.js` bosqichma-bosqich | |

### Faza D — Fayl tashkil (ixtiyoriy)

| Variant | Tavsif |
|---------|--------|
| D-keep | 6 fayl + domen banner | Past risk |
| D-split | `CSS/chat.css` va h.k. + build ro‘yxati | Aniqroq |

Avval A–C; keyin D.

### Faza E — Inventar

| Qadam | Ish |
|-------|-----|
| E1 | CSS-INVENTORY joriy 6 fayl | |
| E2 | O‘lik selector (DIET) | |
| E3 | STATUS har faza oxirida | |

---

## 4. Prioritet

```
P0  A2–A3   xavfsiz prop dedupe
P1  B1–B2   chat+group CSS SSOT
P2  C1–C3   JS helper
P3  E*      inventar
P4  D*      ixtiyoriy split
```

---

## 5. DoD — «mukammal»

1. Chat thread CSS **bitta** manbada.
2. File icon / bubble generator **bitta** JS manbada.
3. Yangi feature uchun SSOT jadvalidan javob bor.
4. Smoke: login, DM, guruh, call, feed, install.
5. A+B+C yopilgan.

---

## 6. Qilma

- Parallel still features + mono-x
- Guruh uchun alohida bubble class
- app.css qo‘lda edit
- Bitta ulkan commit
- Glass qaytarish

---

## 7. Buyruqlar

```bash
node scripts/build-css.mjs
GIT_ASKPASS="$HOME/.gh-askpass.sh" GIT_TERMINAL_PROMPT=0 git push origin main
```

---

## 8. Progress log

| Sana | Faza | Natija |
|------|------|--------|
| 2026-10-04 | A1 qisman + file icon | chat props strip; getChatFileIcon SSOT |
| — | A2 | pending |
| — | B1 | pending |

*Har faza tugagach §8 va STATUS.md yangilanadi.*
