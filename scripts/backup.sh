#!/usr/bin/env bash
# Compressed pg_dump of the compose database into $BACKUP_DIR, keeping 14 days. Run it from cron on the host:
#   0 3 * * * BACKUP_DIR=/var/backups/atendente /bin/bash /opt/atendente-24h/scripts/backup.sh
set -euo pipefail
umask 077

: "${BACKUP_DIR:?BACKUP_DIR is required}"
RETENTION_DAYS=14
cd "$(dirname "$0")/.."
export ENV_FILE="${ENV_FILE:-.env.production}"

mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/atendente-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
trap 'rm -f "$target.partial"' EXIT
# The dump runs inside the db container with its own credentials; the file only appears once it is complete.
docker compose --env-file "$ENV_FILE" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > "$target.partial"
mv "$target.partial" "$target"
find "$BACKUP_DIR" -name 'atendente-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
echo "$target"
