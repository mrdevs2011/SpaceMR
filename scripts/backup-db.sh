#!/usr/bin/env bash
# backup-db.sh — SpaceMR bazasining (Supabase Postgres) kunlik zaxirasi.
#
# Sozlash (bir marta):
#   1) Supabase → Project Settings → Database → Connection string (URI) ni oling
#      ("Session pooler" yoki "Direct"; [YOUR-PASSWORD] o'rniga baza parolini qo'ying).
#   2) Uni repodan TASHQARIDA, faqat o'zingiz o'qiy oladigan faylga yozing:
#        echo 'SUPABASE_DB_URL="postgresql://..."' > ~/.spacemr-backup.env && chmod 600 ~/.spacemr-backup.env
#   3) Sinab ko'ring:  bash scripts/backup-db.sh
#   4) Avtomatik (har kuni 03:30):  crontab -e  →
#        30 3 * * * bash $HOME/Claude/work/SpaceMR/scripts/backup-db.sh >> $HOME/Claude/backups/spacemr/backup.log 2>&1
#
# Natija: ~/Claude/backups/spacemr/spacemr-YYYYmmdd-HHMM.dump (pg_dump custom format, siqilgan).
# Qayta tiklash:  pg_restore --no-owner --clean --if-exists -d "$YANGI_BAZA_URL" fayl.dump
# Eslatma: bu faqat BAZA. Storage fayllari (rasm/audio) alohida zaxiralanadi.
set -euo pipefail

ENV_FILE="${SPACEMR_BACKUP_ENV:-$HOME/.spacemr-backup.env}"
OUT_DIR="${SPACEMR_BACKUP_DIR:-$HOME/Claude/backups/spacemr}"
KEEP="${SPACEMR_BACKUP_KEEP:-14}"   # oxirgi nechta zaxira saqlansin

if [[ -z "${SUPABASE_DB_URL:-}" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi
if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "XATO: SUPABASE_DB_URL topilmadi. Fayl: $ENV_FILE (sarlavhadagi 1-2 qadamga qarang)." >&2
  exit 1
fi
command -v pg_dump >/dev/null || { echo "XATO: pg_dump o'rnatilmagan" >&2; exit 1; }

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
TMP="$OUT_DIR/.spacemr-$STAMP.partial"
FINAL="$OUT_DIR/spacemr-$STAMP.dump"

# public (ilova ma'lumotlari) + auth (foydalanuvchilar) + storage (fayl metadata'si)
pg_dump "$SUPABASE_DB_URL" \
  --format=custom --compress=6 --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  --file="$TMP"

# bo'sh/buzuq fayl "zaxira" hisoblanmasin
if [[ ! -s "$TMP" ]] || ! pg_restore --list "$TMP" >/dev/null 2>&1; then
  rm -f "$TMP"
  echo "XATO: zaxira fayli buzuq yoki bo'sh" >&2
  exit 1
fi
mv "$TMP" "$FINAL"
chmod 600 "$FINAL"

# eskilarini tozalash: faqat oxirgi $KEEP tasi qoladi
ls -1t "$OUT_DIR"/spacemr-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --

echo "OK: $FINAL ($(du -h "$FINAL" | cut -f1)), jami zaxira: $(ls -1 "$OUT_DIR"/spacemr-*.dump | wc -l)"
