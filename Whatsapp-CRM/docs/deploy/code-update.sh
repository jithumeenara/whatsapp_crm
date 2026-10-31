#!/usr/bin/env bash
# Everyday update for one customer VPS: new code only, no database
# migrations. For a release that adds migrations, use the release's own
# script instead.
#
#   bash code-update.sh <app-dir> <pm2-name>
#
# Every step is checked; the first failure stops the script. If the build
# or the start fails, it puts the previous version back by itself.
# Secret values are never printed. Run it from your own shell (not sudo).

set -u
APP_DIR="${1:?app directory, e.g. /home/deploy/CRM/Whatsapp-CRM}"
PM2_NAME="${2:?pm2 app name, e.g. spcrm}"
say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   ✅ %s\n' "$*"; }
stop() { printf '\n   ❌ %s\n   Send this output.\n' "$*"; exit 1; }

cd "$APP_DIR" || stop "No folder $APP_DIR"
OLD="$(git rev-parse HEAD)"

say "1. Checks"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || stop "Node $(node -v) is too old (22 or newer needed)"
grep -qE '^APP_ENV=' .env && stop "APP_ENV is set in .env — it must not be on a live server"
FREE_MB="$(df -Pm . | awk 'NR==2{print $4}')"
[ "$FREE_MB" -ge 2000 ] || stop "Less than 2 GB free disk"
ok "Node $(node -v), disk ${FREE_MB} MB free"

say "2. New code"
git fetch -q origin || stop "git fetch failed"
# A server's own `npm install` rewrites package-lock.json; that file alone may be reset.
CHANGED="$(git status --porcelain --untracked-files=no)"
if [ -n "$CHANGED" ]; then
  if [ -z "$(printf '%s\n' "$CHANGED" | grep -v 'package-lock\.json$')" ]; then
    git checkout -- package-lock.json || stop "Could not reset package-lock.json"
  else
    printf '%s\n' "$CHANGED" | sed 's/^/   /'
    stop "These files were changed on the server itself (listed above). Ask before continuing."
  fi
fi
NEW="$(git rev-parse origin/master)"
[ "$NEW" = "$OLD" ] && { ok "Already at ${OLD:0:7} — nothing to update"; exit 0; }
# Migrations in this update need the release script, not this one.
if git diff --name-only "$OLD" "$NEW" | grep -q '^supabase/migrations/'; then
  stop "This update adds database migrations — use the release's own update script"
fi
git merge -q --ff-only origin/master || stop "Could not move to the new code. Run: git status"
ok "now at $(git rev-parse --short HEAD) (was ${OLD:0:7})"

rollback() {
  say "ROLLBACK to ${OLD:0:7}"
  git checkout -q "$OLD" && npm ci --no-audit --no-fund >/dev/null 2>&1 && npx prisma generate >/dev/null 2>&1 \
    && NODE_ENV=production NEXT_SKIP_TYPECHECK=1 NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=1536" npm run build >/dev/null 2>&1
  NODE_ENV=production pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1
  printf '   Old version restored and started.\n'
  stop "$1"
}

say "3. Packages"
if git diff --name-only "$OLD" HEAD | grep -qE '^(package(-lock)?\.json|prisma/schema\.prisma)$'; then
  npm ci --no-audit --no-fund >/tmp/crm-npm-ci.log 2>&1 || rollback "npm ci failed — see /tmp/crm-npm-ci.log"
  npx prisma generate >/dev/null 2>&1 || rollback "prisma generate failed"
  ok "packages installed"
else
  ok "no package changes — skipped"
fi

say "4. Build (app stopped meanwhile to free memory)"
pm2 stop "$PM2_NAME" >/dev/null 2>&1
rm -f .next/BUILD_ID
NODE_ENV=production NEXT_SKIP_TYPECHECK=1 NEXT_BUILD_CPUS=1 NODE_OPTIONS="--max-old-space-size=1536" npm run build >/tmp/crm-build.log 2>&1
[ -f .next/BUILD_ID ] || rollback "Build failed — see /tmp/crm-build.log"
ok "build done"

say "5. Start in production mode"
NODE_ENV=production pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1 || rollback "pm2 could not start the app"
sleep 15
if pm2 logs "$PM2_NAME" --lines 60 --nostream 2>/dev/null | grep -q 'Refusing to start'; then
  rollback "The new code refused to start"
fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT:-3000}/login)"
[ "$CODE" = 200 ] || rollback "Login page answered $CODE instead of 200"
pm2 save >/dev/null 2>&1

say "DONE ✅  $(git rev-parse --short HEAD) is live"
