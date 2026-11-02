#!/usr/bin/env bash
# Builds the crm-audit scripts into self-contained files under an output
# folder (default /opt/crm-audit), so the crm-audit user needs nothing from
# the app's folder at run time — not its node_modules, not its .env.
#
#   bash scripts/audit/build.sh <out-folder>      (from the app folder, as the APP user;
#   audit-setup.sh does this and copies the result into /opt/crm-audit as root)
#
# Uses the esbuild that is already in node_modules (it comes with tsx), so
# nothing new is installed into the app. pg is bundled in; nodemailer is
# installed beside the bundles (pinned) because it is not an app dependency.

set -euo pipefail
cd "$(dirname "$0")/../.."

OUT="${1:-/opt/crm-audit}"
ESBUILD="node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || { echo "esbuild not found in node_modules — run this from the app folder after npm install" >&2; exit 1; }

install -d -m 0755 "$OUT"
for s in signer upload daily-mail; do
  "$ESBUILD" "scripts/audit/$s.ts" --bundle --platform=node --target=node22 --format=cjs \
    --tsconfig=tsconfig.json --external:pg-native --log-level=warning --outfile="$OUT/$s.cjs"
done
install -m 0755 scripts/audit/retention.sh "$OUT/retention.sh"

if [ ! -d "$OUT/node_modules/nodemailer" ]; then
  # NPM: root often has no npm on its PATH when node came from nvm; audit-setup.sh passes the app user's.
  "${NPM:-npm}" install --prefix "$OUT" --no-audit --no-fund --omit=dev nodemailer@6.9.16 > /dev/null
fi

# Readable and runnable by crm-audit, writable only by root. (audit-setup.sh
# builds as the app user into a scratch folder and does this itself on copy.)
if [ "$(id -u)" -eq 0 ] && getent group crm-audit > /dev/null; then
  chown -R root:crm-audit "$OUT"
  chmod -R u=rwX,g=rX,o= "$OUT"
fi
echo "built: $(ls "$OUT"/*.cjs | xargs -n1 basename | tr '\n' ' ')into $OUT"
