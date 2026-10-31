#!/usr/bin/env bash
# Safe update to the 2026-10 security release, for one customer VPS.
#
#   bash docs/deploy/security-release-update.sh <app-dir> <pm2-name>
#
# Every step is checked; the first failure stops the script. It backs up
# the database and uploads first, and if the build fails it puts the
# previous version back by itself. Secret values are never printed.
# Run it from your own shell (not with sudo). Takes 10–20 minutes.

set -u
APP_DIR="${1:?app directory, e.g. /home/deploy/CRM/Whatsapp-CRM}"
PM2_NAME="${2:?pm2 app name, e.g. spcrm}"
STAMP="$(date +%F-%H%M)"
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   ✅ %s\n' "$*"; }
stop() { printf '\n   ❌ %s\n   Nothing after this step was done. Send this output.\n' "$*"; exit 1; }

cd "$APP_DIR" || stop "No folder $APP_DIR"
OLD="$(git rev-parse HEAD)"

say "1. Checks before touching anything"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || stop "Node $(node -v) is too old: the new code needs Node 22 or newer. Upgrade Node first."
ok "Node $(node -v)"
val() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"\r\n'; }
[ "$(val NEXTAUTH_SECRET | wc -c)" -ge 32 ] || stop "NEXTAUTH_SECRET is missing or shorter than 32 characters"
[ "$(val ENCRYPTION_KEY | grep -cE '^[0-9a-fA-F]{64}$')" = 1 ] || stop "ENCRYPTION_KEY is not 64 hex characters — do NOT change it; ask first"
if grep -qE '^AUTH_SECRET=' .env && [ "$(val AUTH_SECRET | sha256sum)" != "$(val NEXTAUTH_SECRET | sha256sum)" ]; then
  stop "AUTH_SECRET and NEXTAUTH_SECRET differ — ask before continuing"
fi
grep -qE '^APP_ENV=' .env && stop "APP_ENV is set in .env — it must not be on a live server"
ok "secrets look right (values not shown)"
FREE_MB="$(df -Pm . | awk 'NR==2{print $4}')"
[ "$FREE_MB" -ge 3000 ] || stop "Less than 3 GB free disk"
ok "disk ${FREE_MB} MB free"

say "2. Backup (database + uploads)"
if [ -f scripts/pg-env.sh ]; then source scripts/pg-env.sh >/dev/null; fi
if [ -z "${PGDATABASE:-}" ]; then
  DBURL="$(val DATABASE_URL | sed 's/?schema=public//')"
  pg_dump -Fc -f "$HOME/crm-before-security-$STAMP.dump" "$DBURL" || stop "Database backup failed"
else
  pg_dump -Fc -f "$HOME/crm-before-security-$STAMP.dump" || stop "Database backup failed"
fi
chmod 600 "$HOME/crm-before-security-$STAMP.dump"
pg_restore -l "$HOME/crm-before-security-$STAMP.dump" >/dev/null || stop "Backup file is not readable"
ok "database: ~/crm-before-security-$STAMP.dump ($(du -h "$HOME/crm-before-security-$STAMP.dump" | cut -f1))"
if [ -d uploads ]; then tar -czf "$HOME/crm-uploads-$STAMP.tgz" uploads || stop "Uploads backup failed"; ok "uploads: ~/crm-uploads-$STAMP.tgz"; fi

say "3. New code"
git fetch -q origin || stop "git fetch failed"
# A server's own `npm install` rewrites package-lock.json. That file is
# generated, and the new code brings its own, so it alone may be reset.
# Any other local change stops the update for a person to look at.
CHANGED="$(git status --porcelain --untracked-files=no)"
if [ -n "$CHANGED" ]; then
  if [ -z "$(printf '%s\n' "$CHANGED" | grep -v 'package-lock\.json$')" ]; then
    git checkout -- package-lock.json || stop "Could not reset package-lock.json"
    ok "reset the server's own package-lock.json (generated file)"
  else
    printf '%s\n' "$CHANGED" | sed 's/^/   /'
    stop "These files were changed on the server itself (listed above). Ask before continuing."
  fi
fi
git merge --ff-only origin/master >/dev/null || stop "Could not move to the new code (local changes?). Run: git status"
ok "now at $(git rev-parse --short HEAD) (was ${OLD:0:7})"

say "4. Settings added safely"
# WhatsApp Flows keep working exactly as today while the new signature
# check only logs. Remove this line after a week of clean logs.
grep -qE '^META_FLOWS_SIGNATURE=' .env || echo 'META_FLOWS_SIGNATURE=observe' >> .env
if ! grep -qE '^NEXT_PUBLIC_SITE_URL=' .env && grep -qE '^NEXT_PUBLIC_APP_URL=' .env; then
  echo "NEXT_PUBLIC_SITE_URL=$(val NEXT_PUBLIC_APP_URL)" >> .env
fi
ok "META_FLOWS_SIGNATURE=observe, NEXT_PUBLIC_SITE_URL set"

rollback() {
  say "ROLLBACK to ${OLD:0:7}"
  git checkout -q "$OLD" && npm ci --no-audit --no-fund >/dev/null 2>&1 && npx prisma generate >/dev/null 2>&1 \
    && NEXT_SKIP_TYPECHECK=1 NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=1536" npm run build >/dev/null 2>&1
  pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1 || pm2 start "$PM2_NAME" >/dev/null 2>&1
  printf '   Old version restored and started. The database migrations stay (the old code ignores them).\n'
  stop "$1"
}

say "5. Install packages (npm ci)"
npm ci --no-audit --no-fund >/tmp/crm-npm-ci.log 2>&1 || rollback "npm ci failed — see /tmp/crm-npm-ci.log"
ok "packages installed"

say "6. Database migrations"
bash scripts/apply-migrations.sh 145 154 || rollback "A migration failed (nothing in it was applied)"
ok "migrations up to 154"
npx prisma generate >/dev/null 2>&1 || rollback "prisma generate failed"
ok "prisma client generated"

say "7. Build (app stopped meanwhile to free memory)"
pm2 stop "$PM2_NAME" >/dev/null 2>&1
# The old build's marker goes first, so only a finished build can pass the check.
rm -f .next/BUILD_ID
NODE_ENV=production NEXT_SKIP_TYPECHECK=1 NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=1536" npm run build >/tmp/crm-build.log 2>&1
[ -f .next/BUILD_ID ] || rollback "Build failed — see /tmp/crm-build.log"
ok "build done"

say "8. Start in production mode"
NODE_ENV=production pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1 || rollback "pm2 could not start the app"
sleep 15
if pm2 logs "$PM2_NAME" --lines 60 --nostream 2>/dev/null | grep -q 'Refusing to start'; then
  pm2 logs "$PM2_NAME" --lines 60 --nostream 2>/dev/null | grep '\[startup\]'
  rollback "The new code refused to start (reason above)"
fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT:-3000}/login)"
[ "$CODE" = 200 ] || rollback "Login page answered $CODE instead of 200"
pm2 save >/dev/null 2>&1
ok "running — login page 200"
pm2 logs "$PM2_NAME" --lines 60 --nostream 2>/dev/null | grep '\[startup\]' | sed 's/^/   /'

say "DONE ✅  $(git rev-parse --short HEAD) is live"
printf '   Everyone has to sign in once again (safer cookies).\n'
printf '   Keep the backups for a week, then delete them:\n   ~/crm-before-security-%s.dump  ~/crm-uploads-%s.tgz\n' "$STAMP" "$STAMP"
