#!/usr/bin/env bash
# Nightly database backup — run on the server by cron, never from the app.
#
#   bash scripts/backup-db.sh                # one backup now
#
# Install once (as the user that runs the app), backing up at 02:30 every night:
#
#   crontab -e
#   30 2 * * * cd /path/to/Whatsapp-CRM && bash scripts/backup-db.sh >> /var/log/crm-backup.log 2>&1
#
# Reads DATABASE_URL from .env (or .env.local) in this folder. Writes a
# compressed custom-format dump to $BACKUP_DIR (default /var/backups/crm)
# and keeps the last $KEEP_DAYS days (default 14). Prints no password.
#
# A backup on the same disk dies with the disk. Copy the folder somewhere
# else as well — another server, Google Drive (rclone), or S3.
#
# To restore — into a NEW database first, never over the live one:
#   createdb crm_restore_check
#   pg_restore --no-owner -d crm_restore_check /var/backups/crm/<file>.dump
#   (check it, then point DATABASE_URL at it and restart)

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=""
for f in .env .env.local; do
  if [ -f "$f" ] && grep -q '^DATABASE_URL=' "$f"; then ENV_FILE="$f"; break; fi
done
if [ -z "$ENV_FILE" ]; then
  echo "backup-db: no DATABASE_URL in .env or .env.local" >&2
  exit 1
fi

# Connection details go to pg_dump as PG* environment variables, never
# as a URL argument: anything on a command line can be read, password
# included, by every user on the machine (ps, /proc/<pid>/cmdline).
# pg-env.sh also carries ?sslmode= across and drops Prisma's ?schema=.
PGENV_FILE="$ENV_FILE"
# shellcheck source=/dev/null
source "scripts/pg-env.sh" > /dev/null
unset PGENV_FILE
if [ -z "${PGDATABASE:-}" ]; then
  echo "backup-db: could not read DATABASE_URL in $ENV_FILE" >&2
  exit 1
fi

# Every file this run creates — the .partial included — is owner-only
# from the moment it exists, not after a later chmod.
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/crm}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

DB_NAME="$PGDATABASE"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.dump"

pg_dump --format=custom --no-owner --no-acl --file="$OUT.partial"
mv "$OUT.partial" "$OUT"
chmod 600 "$OUT"

# A dump that cannot be read is not a backup.
pg_restore --list "$OUT" > /dev/null

find "$BACKUP_DIR" -name "${DB_NAME}-*.dump" -type f -mtime +"$KEEP_DAYS" -delete

echo "backup-db: $(date -Is) wrote $OUT ($(du -h "$OUT" | cut -f1))"
