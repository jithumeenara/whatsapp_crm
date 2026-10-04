#!/usr/bin/env bash
# Apply a numbered range of migrations, in order, stopping at the first
# failure.
#
#   scripts/apply-migrations.sh 100 118     (from the app folder)
#
# Each file runs as one transaction (--single-transaction), so a file
# that fails leaves nothing half-applied, and the run stops there: later
# migrations may depend on it. Connection details come from .env through
# scripts/pg-env.sh, never from the command line.
#
# Only for ranges known to be safe to run again. As of 118, every
# migration from 072 onward is (IF NOT EXISTS, and the two backfills —
# 106 and 110 — only fill empty values). 064–071 are NOT: run
# scripts/db-state.sql first and never re-run those.

set -euo pipefail

if [[ $# -ne 2 || ! $1 =~ ^[0-9]{1,3}$ || ! $2 =~ ^[0-9]{1,3}$ ]]; then
  echo "usage: scripts/apply-migrations.sh <from> <to>   e.g. 100 118" >&2
  exit 2
fi
# 10# — a leading zero would otherwise make bash read 064 as octal.
from=$((10#$1)); to=$((10#$2))
if (( from < 72 )); then
  echo "Refusing: migrations before 072 cannot be re-run safely. Apply those by hand after checking db-state.sql." >&2
  exit 2
fi

# shellcheck source=/dev/null
source "$(dirname "$0")/pg-env.sh"
[[ -n ${PGDATABASE:-} ]] || { echo "No database settings — is .env here?" >&2; exit 1; }

applied=0
for f in $(ls supabase/migrations/*.sql | sort); do
  n=$(basename "$f" | cut -c1-3)
  [[ $n =~ ^[0-9]{3}$ ]] || continue
  (( 10#$n < from || 10#$n > to )) && continue
  echo "== $(basename "$f")"
  psql -v ON_ERROR_STOP=1 --single-transaction -q -f "$f"
  applied=$((applied + 1))
done
echo "Done: ${applied} migration(s) applied, ${from} to ${to}."
