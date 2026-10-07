# CSP holati (2026-10-07)

## Hozirgi (vercel.json)

`script-src 'self' 'unsafe-inline'`
`style-src 'self' 'unsafe-inline'`

## Nima uchun unsafe-inline qoldi

1. `index.html` — boot/inline skriptlar (modul yuklashdan oldin).
2. `renderMarkdown` — spoiler, code copy, mention uchun `onclick=` atributlari (foydalanuvchi matni avval `esc()`).

## Keyinroq (ixtiyoriy)

- Inline skriptlarni tashqi faylga ko'chirish + nonce/hash.
- Markdown handlerlarni event delegation ga o'tkazish (onclick olib tashlash).
- Shundan keyin `unsafe-inline` ni olib tashlash mumkin.

## Boshqa sarlavhalar (saqlanadi)

HSTS, nosniff, X-Frame-Options DENY, COOP same-origin, CORP same-site, Permissions-Policy camera/microphone self.
