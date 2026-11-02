#!/usr/bin/env bash
# Audit retention (docs/plans/audit-log-plan.md §12) — run by root's cron,
# NEVER by the app:
#
#   bash /opt/crm-audit/retention.sh <app>        (installed by audit-setup.sh, monthly)
#   DRY_RUN=1 bash /opt/crm-audit/retention.sh <app>   (say what it would do, change nothing)
#
# Settings in /etc/crm-audit/<app>.retention (root, 0600):
#   AUDIT_RETENTION_MONTHS=13   empty or missing = OFF (the default)
#   AUDIT_RETENTION_HOLD=1      legal hold: do nothing at all
#   DB_NAME=<database>
#
# For each monthly partition older than AUDIT_RETENTION_MONTHS, in order:
#   1. refuses if any of its rows are not yet in R2 (upload-state.json), or
#      if its seq ranges overlap a newer month (a chain must stay one piece)
#   2. pg_dump of that partition → /var/backups/crm-audit/archive/YYYY-MM.dump (0600)
#   3. pg_restore -l must list its table data, or it stops
#   4. uploads the dump to R2 (audit/archive/YYYY-MM.dump, never overwritten)
#   5. a final signed checkpoint per account at that month's last seq (the
#      point later checks start from)
#   6. DETACH PARTITION (plain, with a short lock timeout: CONCURRENTLY is
#      not allowed while a default partition exists), then DROP of the
#      detached table — only after 2–5 all succeeded.
# There is no row DELETE anywhere. Any failure stops the run and sends the
# red alarm; the partition stays attached.

set -euo pipefail
umask 077

APP="${1:-}"
[[ $APP =~ ^[a-z][a-z0-9-]{1,30}$ ]] || { echo "usage: retention.sh <app>" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 2; }

OPT=/opt/crm-audit
CONF="/etc/crm-audit/$APP.json"
SETTINGS="/etc/crm-audit/$APP.retention"
STATE="/var/lib/crm-audit/$APP"
ARCHIVE=/var/backups/crm-audit/archive
DRY="${DRY_RUN:-0}"

log() { echo "[retention $APP] $(date -Is) $*"; }
alarm() {
  log "ALARM: $*"
  sudo -u crm-audit "$OPT/bin/node" "$OPT/daily-mail.cjs" --config "$CONF" --alarm "Audit retention stopped: $*" || true
  exit 1
}

AUDIT_RETENTION_MONTHS=""; AUDIT_RETENTION_HOLD="0"; DB_NAME=""
# shellcheck source=/dev/null
[ -f "$SETTINGS" ] && source "$SETTINGS"
AUDIT_RETENTION_HOLD="${AUDIT_RETENTION_HOLD_OVERRIDE:-$AUDIT_RETENTION_HOLD}"
if [ "$AUDIT_RETENTION_HOLD" = "1" ]; then log "legal hold (AUDIT_RETENTION_HOLD=1) — nothing done"; exit 0; fi
if [ -z "$AUDIT_RETENTION_MONTHS" ]; then log "off (AUDIT_RETENTION_MONTHS not set) — nothing done"; exit 0; fi
[[ $AUDIT_RETENTION_MONTHS =~ ^[0-9]+$ ]] && [ "$AUDIT_RETENTION_MONTHS" -ge 13 ] || alarm "AUDIT_RETENTION_MONTHS must be a number of at least 13 (DPDP: one year), got '$AUDIT_RETENTION_MONTHS'"
[[ $DB_NAME =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || alarm "DB_NAME missing or invalid in $SETTINGS"

psqlq() { sudo -u postgres psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB_NAME" "$@"; }

# Partitions whose whole month ends on or before (start of this month − N months).
mapfile -t PARTS < <(psqlq -c "
  SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = 'public.audit_events'::regclass AND c.relname ~ '^audit_events_[0-9]{6}\$'
     AND to_date(substr(c.relname, 14), 'YYYYMM') + interval '1 month'
         <= date_trunc('month', now()) - make_interval(months => $AUDIT_RETENTION_MONTHS)
   ORDER BY c.relname")
if [ "${#PARTS[@]}" -eq 0 ]; then log "no month older than $AUDIT_RETENTION_MONTHS months — nothing to do"; exit 0; fi

# Upload anything pending first, so step 1 rarely refuses.
sudo -u crm-audit "$OPT/bin/node" "$OPT/upload.cjs" --config "$CONF" || alarm "the R2 upload before archiving failed"

for PART in "${PARTS[@]}"; do
  [[ $PART =~ ^audit_events_([0-9]{4})([0-9]{2})$ ]] || alarm "unexpected partition name $PART"
  MONTH="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}"
  log "month $MONTH ($PART)"

  # 1a. Every account's last seq in this month, and nothing newer below it.
  mapfile -t RANGES < <(psqlq -c "
    SELECT p.account_id || ' ' || p.max_seq || ' ' ||
           coalesce((SELECT min(e.seq) FROM audit_events e WHERE e.account_id = p.account_id AND e.tableoid <> '$PART'::regclass AND e.occurred_at >= to_date('${BASH_REMATCH[1]}${BASH_REMATCH[2]}', 'YYYYMM') + interval '1 month'), 0)
      FROM (SELECT account_id::text, max(seq) AS max_seq FROM $PART GROUP BY account_id) p")
  for R in "${RANGES[@]}"; do
    read -r ACC MAXSEQ NEXTMIN <<< "$R"
    if [ "$NEXTMIN" != "0" ] && [ "$NEXTMIN" -le "$MAXSEQ" ]; then alarm "$PART: account $ACC has newer-month rows at seq $NEXTMIN, below this month's last seq $MAXSEQ — not archiving"; fi
    # 1b. Already uploaded to R2?
    UP="$(ACC="$ACC" node_state="$STATE/upload-state.json" "$OPT/bin/node" -e 'const s=JSON.parse(require("fs").readFileSync(process.env.node_state,"utf8"));console.log((s.accounts[process.env.ACC]||{seq:"0"}).seq)' 2>/dev/null || echo 0)"
    [ "$UP" -ge "$MAXSEQ" ] || alarm "$PART: account $ACC is uploaded to R2 only through seq $UP, this month ends at $MAXSEQ — not archiving"
  done

  if [ "$DRY" = "1" ]; then log "DRY RUN: would archive $PART (${#RANGES[@]} account(s)) and then detach + drop it"; continue; fi

  # 2. Dump (custom format, this partition only).
  OUT="$ARCHIVE/$MONTH.dump"
  [ -e "$OUT" ] && alarm "$OUT already exists — check it by hand before re-running"
  install -d -m 0700 "$ARCHIVE"
  sudo -u postgres pg_dump -d "$DB_NAME" --format=custom --table="public.$PART" > "$OUT.partial" \
    || { rm -f "$OUT.partial"; alarm "pg_dump of $PART failed"; }
  mv "$OUT.partial" "$OUT"; chmod 0600 "$OUT"

  # 3. The dump must be readable and hold the table data.
  pg_restore -l "$OUT" | grep -q "TABLE DATA public $PART " || alarm "$OUT does not list the data of $PART — kept attached"
  log "dump verified: $OUT ($(du -h "$OUT" | cut -f1)), sha256 $(sha256sum "$OUT" | cut -c1-16)…"

  # 4. Off the server too (root reads the 0600 file and pipes it in).
  sudo -u crm-audit "$OPT/bin/node" "$OPT/upload.cjs" --config "$CONF" --stdin --key "audit/archive/$MONTH.dump" < "$OUT" \
    || alarm "uploading $OUT to R2 failed — kept attached"

  # 5. Final signed checkpoint per account at this month's last seq.
  for R in "${RANGES[@]}"; do
    read -r ACC MAXSEQ _ <<< "$R"
    sudo -u crm-audit "$OPT/bin/node" "$OPT/signer.cjs" --config "$CONF" --at "$ACC:$MAXSEQ" || alarm "final checkpoint for $ACC at $MAXSEQ failed — kept attached"
  done

  # 6. Detach, then drop the detached table. Never a row DELETE.
  psqlq -c "SET lock_timeout = '5s'; ALTER TABLE public.audit_events DETACH PARTITION public.$PART" || alarm "DETACH of $PART failed (busy?) — it stays attached; the dump is kept"
  psqlq -c "DROP TABLE public.$PART" || alarm "DROP of the detached $PART failed — it is detached but still present"
  log "archived and removed $PART"
done
log "done"
