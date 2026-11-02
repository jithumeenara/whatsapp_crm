#!/usr/bin/env bash
# One-time audit hardening for one server (docs/deploy/audit-setup.md).
#
#   cd <app folder> && sudo bash docs/deploy/audit-setup.sh <app> <database> <app-db-role>
#     ACSTI:    sudo bash docs/deploy/audit-setup.sh acsti <db> acsti_data
#     Hospital: sudo bash docs/deploy/audit-setup.sh spcrm <db> db_spfort
#
# What it does, in order (each step says what it did; safe to run again):
#   1. the crm-audit Unix user, its state and log folders; refuses if the app
#      user or pm2 is root
#   2. the role split (audit-role-split.sql, as postgres) + the signer's DB password
#   3. the Ed25519 signing key, readable only by crm-audit; prints the fingerprint
#   4. /etc/crm-audit/<app>.json from prompts (secrets typed hidden, never echoed)
#   5. the scripts built AS THE APP USER, then copied into /opt/crm-audit by root
#      (root never runs esbuild, npm or node from the app; node is run as crm-audit)
#   6. cron: signer hourly, upload every 15 min, summary mail daily, retention monthly (off until set)
#   7. a dry test: sign + upload + test mail
#
# Never touches the app's .env or its data. The app keeps running throughout.

set -euo pipefail

APP="${1:-}"; DB="${2:-}"; APP_ROLE="${3:-}"
if [[ ! $APP =~ ^[a-z][a-z0-9-]{1,30}$ || ! $DB =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ || ! $APP_ROLE =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
  echo "usage: sudo bash docs/deploy/audit-setup.sh <app> <database> <app-db-role>" >&2
  exit 2
fi
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 2; }
[ -f docs/deploy/audit-role-split.sql ] || { echo "run from the app folder (where docs/ is)" >&2; exit 2; }

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
stop() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { local v; read -r -p "  $1${2:+ [$2]}: " v; printf '%s' "${v:-${2:-}}"; }
ask_secret() { local v; read -r -s -p "  $1: " v; echo >&2; printf '%s' "$v"; }

ETC=/etc/crm-audit
CONF="$ETC/$APP.json"
KEY="$ETC/$APP-ed25519.pem"
PUB="$ETC/$APP-ed25519.pub"
STATE="/var/lib/crm-audit/$APP"
LOGDIR=/var/log/crm-audit
OPT=/opt/crm-audit

say "1. crm-audit user and folders"
if ! id crm-audit > /dev/null 2>&1; then
  useradd --system --home-dir /var/lib/crm-audit --shell /usr/sbin/nologin --user-group crm-audit
  ok "created Unix user crm-audit (no login shell)"
else
  ok "Unix user crm-audit already exists"
fi
install -d -m 0750 -o root -g crm-audit "$ETC"
install -d -m 0700 -o crm-audit -g crm-audit /var/lib/crm-audit "$STATE"
install -d -m 0750 -o crm-audit -g crm-audit "$LOGDIR"
# Not under /var/backups/crm: that folder belongs to the app user (backup-db.sh),
# who could move a root folder inside it out of the way.
install -d -m 0700 -o root -g root /var/backups/crm-audit /var/backups/crm-audit/archive
ok "folders: $ETC (root), $STATE (crm-audit, 0700), $LOGDIR"
# The app's Unix user must not be in the crm-audit group.
APP_USER="$(stat -c %U .)"
# An app running as root can read the signing key and become postgres:
# nothing below would protect anything from it.
[ "$APP_USER" != "root" ] || stop "the app folder is owned by root — the app must run as its own Unix user, not root. Move it to a normal user (and run pm2 as that user) before this setup."
for PM2_PID in $(pgrep -f 'PM2 v[0-9.]*: God Daemon|pm2: God' || true); do
  PM2_OWNER="$(ps -o user= -p "$PM2_PID" 2>/dev/null | tr -d ' ')"
  [ "$PM2_OWNER" != "root" ] || stop "pm2 is running as root (pid $PM2_PID). The app must run under pm2 as $APP_USER, not root: stop root's pm2 (sudo pm2 kill), start the app as $APP_USER, then run this again."
done
ok "app user $APP_USER is not root, and pm2 does not run as root"
if id -nG "$APP_USER" | tr ' ' '\n' | grep -qx crm-audit; then stop "the app user $APP_USER is in the crm-audit group — remove it (gpasswd -d $APP_USER crm-audit)"; fi
ok "app user $APP_USER is not in the crm-audit group"

say "2. Database role split (as postgres)"
echo "  This makes crm_audit_owner own the audit tables and takes UPDATE/DELETE/TRUNCATE away from $APP_ROLE."
[ "$(ask 'Continue? (yes/no)' no)" = "yes" ] || stop "stopped before the role split — nothing changed in the database"
# Through stdin: postgres may not be able to read the app folder.
sudo -u postgres psql -X -d "$DB" -v app_role="$APP_ROLE" -f - < docs/deploy/audit-role-split.sql | tee /tmp/crm-audit-split.$$
grep -q '^ *FAIL' /tmp/crm-audit-split.$$ && { rm -f /tmp/crm-audit-split.$$; stop "a role-split check FAILED — see the table above"; }
rm -f /tmp/crm-audit-split.$$
ok "role split done; every check PASS"

READER_PW=""
if [ -f "$CONF" ]; then
  ok "config exists — keeping the signer's current DB password"
else
  READER_PW="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
  # Through stdin, never on a command line (ps would show it).
  printf "ALTER ROLE crm_audit_reader WITH LOGIN PASSWORD '%s';\n" "$READER_PW" | sudo -u postgres psql -X -q -d "$DB" -f - > /dev/null
  ok "crm_audit_reader password set (random, 40 characters, stored only in $CONF)"
fi

say "3. Signing key (Ed25519)"
if [ -f "$KEY" ]; then
  ok "key exists — not replaced"
else
  ( umask 077; openssl genpkey -algorithm ed25519 -out "$KEY" )
  chown crm-audit:crm-audit "$KEY"; chmod 0400 "$KEY"
  ok "created $KEY (0400, crm-audit only)"
fi
openssl pkey -in "$KEY" -pubout -out "$PUB"; chown root:root "$PUB"; chmod 0444 "$PUB"
FP="$(openssl pkey -pubin -in "$PUB" -outform DER | sha256sum | cut -d' ' -f1)"
echo
echo "  ┌───────────────────────────────────────────────────────────────────────┐"
echo "  │ WRITE THIS DOWN, OFF THE SERVER (paper / your phone / password manager) │"
echo "  │ Audit key fingerprint for $APP:"
echo "  │   $(echo "$FP" | sed 's/.\{4\}/& /g')"
echo "  └───────────────────────────────────────────────────────────────────────┘"
echo "  Public key (GitHub secret ${APP^^}_AUDIT_PUBLIC_KEY):"
sed 's/^/    /' "$PUB"

say "3b. Node for crm-audit"
NODE_BIN="$(sudo -u "$APP_USER" -i bash -lc 'command -v node' 2>/dev/null || command -v node || true)"
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || stop "node not found for $APP_USER"
install -d -m 0750 -o root -g crm-audit "$OPT" "$OPT/bin"
# A copy crm-audit can run (the app's node may live in the app user's home,
# e.g. nvm). It is copied as a file only; root never runs it — every use
# below runs it as crm-audit.
install -m 0750 -o root -g crm-audit "$NODE_BIN" "$OPT/bin/node"
NODE_VERSION="$(cd / && sudo -u crm-audit "$OPT/bin/node" --version)" || stop "the copied node does not run as crm-audit"
ok "node $NODE_VERSION copied to $OPT/bin/node"

say "4. Settings file $CONF"
if [ -f "$CONF" ]; then
  ok "exists — not changed (to start over: sudo rm $CONF and run again)"
else
  LABEL="$(ask 'Server label for mails' "${APP^^}")"
  RECIPIENTS="$(ask 'Alarm/summary recipients (comma-separated emails)')"
  [ -n "$RECIPIENTS" ] || stop "at least one recipient is needed"
  DBPORT="$(ask 'Database port' 5432)"
  echo "  Cloudflare R2 (docs/deploy/audit-setup.md step 1):"
  R2_ENDPOINT="$(ask 'R2 endpoint (https://<account-id>.r2.cloudflarestorage.com)')"
  R2_BUCKET="$(ask 'R2 bucket' "crm-audit-$APP")"
  R2_KEY="$(ask 'R2 WRITE token: Access Key ID')"
  R2_SECRET="$(ask_secret 'R2 WRITE token: Secret Access Key (hidden)')"
  R2R_KEY="$(ask 'R2 READ-ONLY token: Access Key ID (Enter to skip)')"
  R2R_SECRET=""; [ -n "$R2R_KEY" ] && R2R_SECRET="$(ask_secret 'R2 READ-ONLY token: Secret Access Key (hidden)')"
  echo "  Mail (Zoho: smtp.zoho.in, Gmail: smtp.gmail.com — port 465, an APP password):"
  SMTP_HOST="$(ask 'SMTP host' smtp.zoho.in)"
  SMTP_PORT="$(ask 'SMTP port' 465)"
  SMTP_USER="$(ask 'SMTP user (full email)')"
  SMTP_PASS="$(ask_secret 'SMTP app password (hidden)')"
  SMTP_FROM="$(ask 'From address' "$SMTP_USER")"
  # Built by node from environment variables: correct JSON escaping, and no
  # secret ever appears on a command line.
  # As crm-audit with its own copy of node (root never runs the app's node);
  # --preserve-env passes the values through the environment, not argv.
  ( umask 077; cd /
    LABEL="$LABEL" RECIPIENTS="$RECIPIENTS" DB="$DB" DBPORT="$DBPORT" READER_PW="$READER_PW" KEY="$KEY" STATE="$STATE" \
    R2_ENDPOINT="$R2_ENDPOINT" R2_BUCKET="$R2_BUCKET" R2_KEY="$R2_KEY" R2_SECRET="$R2_SECRET" R2R_KEY="$R2R_KEY" R2R_SECRET="$R2R_SECRET" \
    SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" SMTP_USER="$SMTP_USER" SMTP_PASS="$SMTP_PASS" SMTP_FROM="$SMTP_FROM" \
    sudo -u crm-audit --preserve-env=LABEL,RECIPIENTS,DB,DBPORT,READER_PW,KEY,STATE,R2_ENDPOINT,R2_BUCKET,R2_KEY,R2_SECRET,R2R_KEY,R2R_SECRET,SMTP_HOST,SMTP_PORT,SMTP_USER,SMTP_PASS,SMTP_FROM \
    "$OPT/bin/node" -e '
      const e = process.env
      const r2 = (id, secret) => ({ endpoint: e.R2_ENDPOINT, bucket: e.R2_BUCKET, access_key_id: id, secret_access_key: secret })
      const c = {
        label: e.LABEL,
        db_url: `postgresql://crm_audit_reader:${encodeURIComponent(e.READER_PW)}@localhost:${e.DBPORT}/${e.DB}`,
        signing_key: e.KEY,
        state_dir: e.STATE,
        r2: r2(e.R2_KEY, e.R2_SECRET),
        ...(e.R2R_KEY ? { r2_read: r2(e.R2R_KEY, e.R2R_SECRET) } : {}),
        smtp: { host: e.SMTP_HOST, port: Number(e.SMTP_PORT), user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.SMTP_FROM },
        recipients: e.RECIPIENTS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      }
      process.stdout.write(JSON.stringify(c, null, 2) + "\n")
    ' > "$CONF" )
  chown crm-audit:crm-audit "$CONF"; chmod 0400 "$CONF"
  unset R2_SECRET R2R_SECRET SMTP_PASS READER_PW
  ok "wrote $CONF (0400, crm-audit only)"
fi
if [ ! -f "$ETC/$APP.retention" ]; then
  ( umask 077; printf '# Audit retention (scripts/audit/retention.sh). Empty = OFF.\nAUDIT_RETENTION_MONTHS=\nAUDIT_RETENTION_HOLD=0\nDB_NAME=%s\n' "$DB" > "$ETC/$APP.retention" )
  ok "wrote $ETC/$APP.retention (retention OFF until AUDIT_RETENTION_MONTHS is set)"
fi

say "5. Scripts in $OPT"
NPM_BIN="$(dirname "$NODE_BIN")/npm"; [ -x "$NPM_BIN" ] || NPM_BIN="$(sudo -u "$APP_USER" -i bash -lc 'command -v npm' 2>/dev/null || true)"
[ -n "$NPM_BIN" ] || stop "npm not found for $APP_USER (needed once, to install nodemailer)"
# Built AS THE APP USER into a scratch folder: esbuild and npm come from the
# app's folder, and root never runs a program the app user could have changed.
# Root only copies the finished files into $OPT.
BUILD_DIR="$(sudo -u "$APP_USER" mktemp -d /tmp/crm-audit-build.XXXXXX)"
trap 'rm -rf "$BUILD_DIR"' EXIT
sudo -u "$APP_USER" -H env PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin" NPM="$NPM_BIN" \
  bash scripts/audit/build.sh "$BUILD_DIR" || stop "building the scripts (as $APP_USER) failed — see above"
for f in signer upload daily-mail; do
  [ -s "$BUILD_DIR/$f.cjs" ] || stop "build produced no $f.cjs"
  install -m 0640 -o root -g crm-audit "$BUILD_DIR/$f.cjs" "$OPT/$f.cjs"
done
# retention.sh runs as root from cron: copied from the repo as a plain file (never built or run by the app user).
install -m 0750 -o root -g crm-audit scripts/audit/retention.sh "$OPT/retention.sh"
[ -d "$BUILD_DIR/node_modules/nodemailer" ] || stop "nodemailer was not installed by the build"
rm -rf "$OPT/node_modules"
cp -R "$BUILD_DIR/node_modules" "$OPT/node_modules"
# Readable by crm-audit, writable only by root.
chown -R root:crm-audit "$OPT/node_modules"
chmod -R u=rwX,g=rX,o= "$OPT/node_modules"
rm -rf "$BUILD_DIR"; trap - EXIT
ok "scripts built as $APP_USER and copied into $OPT (root-owned, crm-audit can read)"

say "6. Cron"
cat > "/etc/cron.d/crm-audit-$APP" <<CRON
# crm-audit jobs for $APP (docs/deploy/audit-setup.md). Times are the server clock.
SHELL=/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=""
7 * * * *    crm-audit $OPT/bin/node $OPT/signer.cjs --config $CONF >> $LOGDIR/$APP.log 2>&1
*/15 * * * * crm-audit $OPT/bin/node $OPT/upload.cjs --config $CONF >> $LOGDIR/$APP.log 2>&1
30 2 * * *   crm-audit $OPT/bin/node $OPT/daily-mail.cjs --config $CONF >> $LOGDIR/$APP.log 2>&1
45 3 2 * *   root      bash $OPT/retention.sh $APP >> $LOGDIR/$APP-retention.log 2>&1
CRON
chmod 0644 "/etc/cron.d/crm-audit-$APP"
cat > /etc/logrotate.d/crm-audit <<'ROT'
/var/log/crm-audit/*.log {
  monthly
  rotate 24
  compress
  missingok
  notifempty
  su crm-audit crm-audit
  create 0640 crm-audit crm-audit
}
ROT
ok "installed /etc/cron.d/crm-audit-$APP (signer :07 hourly, upload every 15 min, summary 02:30 server time ($(date +%Z)), retention on the 2nd)"

say "7. Dry test"
run() { sudo -u crm-audit "$OPT/bin/node" "$OPT/$1.cjs" --config "$CONF" "${@:2}"; }
run signer && ok "signer ran" || echo "  ✗ signer failed (see above)"
run upload && ok "upload ran" || echo "  ✗ upload failed (see above)"
run daily-mail --test && ok "test mail sent — check the inbox (and spam) of: $(sudo -u crm-audit "$OPT/bin/node" -e 'console.log(require(process.argv[1]).recipients.join(", "))' "$CONF")" || echo "  ✗ test mail failed (see above)"

say "Left for you"
echo "  • Keep the fingerprint above OFF this server."
echo "  • Add to the app's .env (then pm2 restart): AUDIT_HEAD_TOKEN=<a long random value>, e.g.:"
echo "      openssl rand -hex 32"
echo "    and the same value as GitHub secret ${APP^^}_AUDIT_HEAD_TOKEN (docs/deploy/audit-setup.md step 7)."
echo "  • After any database restore: run this role split again on the restored database."
