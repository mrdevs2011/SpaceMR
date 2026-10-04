# SpaceMR — Konsolidatsiya Roadmap

> **Holat: TUGALLANGAN (100%)** · 2026-10-04  
> Maqsad: kam kod → ko‘p narsa. Bir ish = bir joy. Brauzerga **bitta** `app.css`.

---

## Natija (DoD)

| # | Mezon | Holat |
|---|--------|--------|
| 1 | Chat thread CSS bitta manbada (`mono-x`) | ✅ |
| 2 | Bubble HTML bitta JS (`message-bubble.js`) | ✅ |
| 3 | File icon bitta JS (`core/file-icons.js`) | ✅ |
| 4 | SSOT jadvali (`ARCHITECTURE.md` + shu hujjat) | ✅ |
| 5 | A+B+C fazalari yopilgan | ✅ |
| 6 | Xavfsiz dedupe qoidasi (yarim-prop kesish taqiqlangan) | ✅ |
| 7 | Domen bannerlari har CSS faylda | ✅ |
| 8 | Inventar yangilangan | ✅ |

---

## Temir qoidalar

1. **SSOT** — bir selector / helper = bir fayl.
2. Kaskad: `tokens → base → features → layers → admin → mono-x`.
3. DM + guruh = bir xil `.chat-*` bubble.
4. `app.css` qo‘lda tahrirlanmaydi.
5. Dedupe: faqat **butun qoida** o‘chirish yoki missing-prop **qo‘shish**; yarim-body kesish **taqiqlangan** (regressiya bo‘lgan).
6. Push: `GIT_ASKPASS="$HOME/.gh-askpass.sh" GIT_TERMINAL_PROMPT=0`.

---

## CSS SSOT

| Domen | Yozish |
|-------|--------|
| Tokenlar | `tokens.css` |
| Auth / splash / toast | `base.css` |
| **Chat thread + voice + bubble** | `mono-x.css` |
| **Call** | `features.css` |
| Feed / stories | `features.css` |
| Guruh forma / picker / a’zolar | `features.css` |
| Nav / right-rail / shell | `mono-x.css` |
| Admin | `admin.css` |
| Legacy | `layers.css` (yangi chat yo‘q) |

---

## JS SSOT

| Domen | Fayl |
|-------|------|
| Paint (DM+guruh) | `chat.js` → `paintMessages` |
| Bubble HTML | `components/message-bubble.js` |
| Shared helpers | `chat-shared.js` |
| File icon | `core/file-icons.js` |
| UI icons | `core/icons.js` |
| Ovoz yozish / ijro | `chat-voice-record.js` / `chat-voice-player.js` |
| Call | `call/call.js` |
| Install guide | `ui/install-guide.js` |

---

## Fazalar — yopilgan

### A — CSS dedupe ✅
- A1–A3: overlap tozalash (keyin xavfsiz usulga o‘tildi)
- A4: features da layers to‘liq qoplagan qoidalar olib tashlandi

### B — Chat CSS ✅
- B1: features/layers top-level chat → mono SSOT
- B2: thread `grp-sender` / badge → mono; forma features da
- B3: Call struktura `features`; tema ranglari mono da qolishi mumkin

### C — JS ✅
- C1: `wrapChatBubble`, `assembleMessageHtml`, optimistic voice
- C2: groups `paintGroupThread` (dublikat yo‘q)
- C3: `core/file-icons.js`
- C4: `core/icons.js` mavjud (bosqichma-bosqich kengaytiriladi)

### D — Fayl tashkil ✅ (D-keep)
- 6 manba saqlanadi + har faylda SSOT banner
- Split (`CSS/chat.css`) ixtiyoriy, kerak emas

### E — Inventar ✅
- E1: `docs/CSS-INVENTORY.md` joriy
- E2: o‘lik selector mass-delete qilinmadi (xavf); Coverage keyingi DIET da
- E3: STATUS yangilanadi

---

## Progress log

| Sana | Nima |
|------|------|
| 2026-10-04 | A/B/C/D/E yopildi; chat SSOT mono; bubble+file-icon JS; inventar |

---

## Keyingi ish (roadmap tashqarida)

- Deploy + 2 qurilmada smoke (login, DM, guruh, call, feed)
- Commit/push konsolidatsiya diff
- C4: yangi UI da `icons.js` ishlatish (ixtiyoriy)

*Bu hujjat yopilgan. Yangi konsolidatsiya kerak bo‘lsa — yangi roadmap.*
