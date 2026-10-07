#!/usr/bin/env node
/* build-css.mjs — CSS/*.css (9 fayl) ni bitta app.css ga yig'adi. Kutubxonasiz concat.
   Kaskad tartibi MUHIM (oxirgi fayl g'olib): tokens → base → features → layers → admin → mono-x → video-note → chat-attach → motion.
   Ishlatish: node scripts/build-css.mjs  (yoki: npm run build). app.css qo'lda tahrirlanmaydi. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['tokens', 'base', 'features', 'layers', 'admin', 'mono-x', 'video-note', 'chat-attach', 'apps', 'profile-pro', 'profile-x', 'avi-crop', 'motion'].map(n => `CSS/${n}.css`);

const parts = ['/* SpaceMR app.css — build-css.mjs orqali avtomatik yig\'ilgan. Qo\'lda tahrirlamang! */'];
for (const f of FILES) parts.push(readFileSync(join(ROOT, f), 'utf8').trim());

const out = parts.join('\n') + '\n';
writeFileSync(join(ROOT, 'app.css'), out);
// SW CACHE_VERSION scripts/bump-sw.mjs orqali (Vercel buildCommand) — lokal build fayllarni iflos qilmaydi.
console.log(`OK: app.css yig'ildi — ${FILES.length} manba, ${out.split('\n').length} qator, ${(Buffer.byteLength(out) / 1024).toFixed(1)} KB`);
