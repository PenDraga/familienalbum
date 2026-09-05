#!/usr/bin/env bash
# Tägliches Backup: pg_dump + rsync der Medien auf ein zweites Ziel.
# Cron-Beispiel: 30 3 * * * /opt/familienalbum/infra/backup.sh >> /var/log/familienalbum-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")"
set -a; source .env; set +a

BACKUP_TARGET="${BACKUP_TARGET:-/mnt/backup/familienalbum}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"

mkdir -p "$BACKUP_TARGET/db" "$BACKUP_TARGET/media"

echo "[$STAMP] pg_dump ..."
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  | gzip > "$BACKUP_TARGET/db/familienalbum_$STAMP.dump.gz"

echo "[$STAMP] rsync media ..."
rsync -a --delete "${MEDIA_PATH:-./data/media}/" "$BACKUP_TARGET/media/"

echo "[$STAMP] alte Dumps (> $KEEP_DAYS Tage) löschen ..."
find "$BACKUP_TARGET/db" -name '*.dump.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$STAMP] fertig."
