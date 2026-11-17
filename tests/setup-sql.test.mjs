/* supabase/setup.sql — statik himoya: sir yo'q, eski cheklov obyektlari faqat tozalash bo'limida, asosiy bo'limlar bor. */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8');

assert.ok(!/[0-9a-f]{40,}/i.test(sql), 'setup.sql ichida uzun hex (sir) bo\'lmasligi kerak');
assert.ok(/v_secret text := '__WEBHOOK_SECRET__'/.test(sql), 'webhook siri placeholder bo\'lishi kerak');

const cleanupAt = sql.indexOf('15. ESKI (ENDI KERAK BO');
assert.ok(cleanupAt > 0, 'tozalash bo\'limi bor');
const before = sql.slice(0, cleanupAt);
for (const dead of ['storage_object_violation', 'check_storage_rate_limit', 'enforce_only_jpg_png_storage', 'enforce_no_video_audio_rows', 'can_access_media', '_dbg_rate', 'cleanup_media_on_delete']) {
  assert.ok(!before.includes(dead), `${dead} tozalash bo'limidan oldin bo'lmasligi kerak`);
}
for (const must of ['CREATE EXTENSION IF NOT EXISTS "pgcrypto"', 'CREATE POLICY "media_insert"', 'on_auth_user_created', 'file_size_limit', 'FUNCTION "public"."is_approved"']) {
  assert.ok(sql.includes(must), `${must} bo'lishi kerak`);
}
const nAdd = (sql.match(/ADD CONSTRAINT "/g) || []).length;
const nGuard = (sql.match(/pg_constraint WHERE conname = '/g) || []).length;
assert.strictEqual(nAdd, nGuard, 'har bir ADD CONSTRAINT guard (IF NOT EXISTS) ichida bo\'lishi kerak');
console.log('OK: setup.sql statik tekshiruvlari o\'tdi');
