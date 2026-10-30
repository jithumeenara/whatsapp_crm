# Production security checklist (per customer VPS)

Part of the 2026-10 security audit. Index: [README.md](README.md). Background: [INFRASTRUCTURE_SECURITY.md](INFRASTRUCTURE_SECURITY.md), [SECURITY_FIXES.md §2](SECURITY_FIXES.md#2-behaviour-changes-users-will-notice), and `Whatsapp-CRM/docs/deploy/HARDENING.md` (§0 "Upgrading an existing server").

Work top to bottom. Tick each box. **Never print secret values.** Check lengths only, as shown. Paths assume the app is in `~/Whatsapp-CRM`, running as user `crm`, under the PM2 app name `whatsapp-crm`. Adjust them to your server.

---

## 0. Once, before any server (repository and release)

- [ ] **Make the GitHub repository private.** It is public today, so attackers can read the code and diff the fixes. Then decide on `git rm --cached wacrm-main.zip` (an old vulnerable snapshot that is still tracked) and whether to purge it from history.
- [ ] Owner approval to push and deploy. Nothing is pushed yet.
- [ ] Staging/preview servers have `APP_ENV=staging` (or `preview`), so the send guard blocks messages and every outbound side effect (webhooks, flow HTTP steps, Meta and other provider writes). Even so, prefer separate provider accounts for staging (its own Telegram bot, test Razorpay keys). `DEV_ALLOWED_HOSTS` opens a host exactly, so use it only with test credentials.
- [ ] After the push: CI runs green on GitHub. In the repo settings, enable Dependabot alerts, Dependabot security updates and private vulnerability reporting.
- [ ] Re-run `npm audit` and `npm audit --omit=dev --audit-level=high` on the release commit. Expect 3 low and exit 0.
- [ ] **Dry-run migrations 152, 153 and 154 on `crm_prod_copy` inside `BEGIN … ROLLBACK`.** They have only been run on a throwaway database.
  ```bash
  # from Whatsapp-CRM/, against crm_prod_copy (connection from env, never on the command line)
  ( echo 'BEGIN;'; cat supabase/migrations/152_api_key_owner_expiry_invite_email.sql \
        supabase/migrations/153_social_page_unique.sql \
        supabase/migrations/154_revoke_creatorless_api_keys.sql; echo 'ROLLBACK;' ) | psql -v ON_ERROR_STOP=1 -d crm_prod_copy
  ```
  - [ ] First run the 153 **pre-check** queries in the file header. They list any `page_id` or `instagram_account_id` held by two workspaces. 153 fails, and changes nothing, if duplicates exist; resolve them first.
  - [ ] Note how many keys 154 would revoke: count `api_keys` rows `WHERE created_by_user_id IS NULL AND revoked_at IS NULL` (it is run after 152). Those owners must be told.

## 1. Pre-deploy (on each VPS)

- [ ] **Back up the database and `uploads/`**, and confirm the backup is readable:
  ```bash
  cd ~/Whatsapp-CRM && scripts/backup-db.sh          # verified dump, chmod 600; password via env, not argv
  tar -C ~/Whatsapp-CRM -czf ~/uploads-$(date +%F).tgz uploads
  ```
  Keep a copy off the server. Record the current commit: `git rev-parse HEAD`.
- [ ] **Node version:** `node -v` must be **22 LTS at the latest patch (≥ 22.22.2)** or **24 LTS**. Node 20 is end of life, and `engines` is now `>=22`. Upgrade first if needed.
- [ ] **Secrets check** (lengths only, never values):
  ```bash
  for v in NEXTAUTH_SECRET AUTH_SECRET ENCRYPTION_KEY; do
    printf '%s: ' "$v"; grep -E "^$v=" .env | cut -d= -f2- | tr -d '\n"' | wc -c
  done
  ```
  - [ ] `NEXTAUTH_SECRET` (and `AUTH_SECRET`, if set) is **≥ 32 random characters** with no placeholder word (`secret`, `password`, `example`, `changeme`, `placeholder`). If not, set a new one with `openssl rand -hex 32`. **This signs everyone out once**, so tell users. Keep `AUTH_SECRET` unset, or equal to `NEXTAUTH_SECRET`.
  - [ ] `ENCRYPTION_KEY` is **exactly 64 hex characters**. **Do NOT change it** on a server with data, or every stored channel token becomes unreadable. If the check would reject the current key, stop and restore the exact original key from the password manager.
  - [ ] `.env` is `chmod 600` and owned by `crm`.
- [ ] **`NODE_ENV=production` in PM2's `env` block** (`docs/deploy/ecosystem.config.example.cjs`), together with `PORT` and `BIND_HOST=127.0.0.1`. Check with `pm2 env 0 | grep -E 'NODE_ENV|BIND_HOST'`.
- [ ] **`APP_ENV` is unset on production.** Also unset: `META_SOCIAL_SIGNATURE`, `DEV_ALLOW_SENDING`, `DEV_ALLOWED_HOSTS`, `SSRF_ALLOW_PRIVATE`; and `BIND_HOST` is not `0.0.0.0`.
  ```bash
  grep -nE '^(APP_ENV|META_SOCIAL_SIGNATURE|META_FLOWS_SIGNATURE|DEV_ALLOW_SENDING|DEV_ALLOWED_HOSTS|SSRF_ALLOW_PRIVATE|BIND_HOST)=' .env   # names only matter; expect none (or BIND_HOST=127.0.0.1)
  ```
- [ ] `NEXT_PUBLIC_SITE_URL` is set to the public https origin. Invitation links and the Socket.io origin depend on it.
- [ ] **Meta signature rollout plan** (`META_FLOWS_SIGNATURE`, `META_SOCIAL_SIGNATURE`):
  - Default is **enforce**: leave both unset.
  - Confirm the Meta app secret is configured (`META_APP_SECRET` or the Quick Connect secret). Without it, Flows requests are refused (fail closed).
  - Only if live Flows or IG/FB webhooks start failing after the deploy (HTTP 432 for Flows): set the variable to `observe` **briefly**, restart, find the cause (wrong or missing app secret), then remove it and restart. The start-up check warns while either one is set.
- [ ] Infra baseline is in place, or scheduled. These are **manual**; see [INFRASTRUCTURE_SECURITY.md](INFRASTRUCTURE_SECURITY.md):
  - Nginx from `nginx.conf.example`, passing `nginx -t`: X-Real-IP set, crons localhost-only, `client_max_body_size 17m`
  - UFW: 22 (limit), 80 and 443 only
  - SSH: keys only
  - PostgreSQL on localhost with scram and a non-superuser role
  - Encrypted off-site backups
  - Monitoring
  - Log retention of 14 days

## 2. Deploy

- [ ] Announce a short maintenance window. If the session secret changes, everyone is signed out once.
- [ ] Fetch the approved release:
  ```bash
  cd ~/Whatsapp-CRM && git fetch && git checkout <approved release commit>
  ```
- [ ] Install exactly from the lockfile: `npm ci`. Do not use `--omit=dev`: `npm start` uses `tsx`, and jsdom is now an explicit devDependency.
- [ ] Apply the migrations (one transaction per file, stopping at the first failure; connection from `.env`):
  ```bash
  scripts/apply-migrations.sh 152 154
  ```
- [ ] `npx prisma generate`
- [ ] Build: `NEXT_BUILD_CPUS=1 npm run build`. Expect success. Two informational Turbopack warnings (`database/backup`, `lib/whatsapp/media-ref.ts`) are normal.
- [ ] Restart: `pm2 reload whatsapp-crm` (or `pm2 start ecosystem.config.cjs` the first time), then `pm2 save`.
- [ ] Check the start-up log: `pm2 logs whatsapp-crm --lines 100 | grep -E '\[startup\]'`. There must be **no refusal**. If the server exited, the message names the variable and what is wrong with it; fix it and restart.

## 3. Post-deploy

- [ ] **Smoke test:**
  - `https://<host>/login` loads.
  - After sign-in the cookie is `__Secure-authjs.session-token`, flagged Secure.
  - `curl -sI https://<host>` shows one HSTS header and no `X-Powered-By`.
  - `/.env` → 404.
  - `/api/automations/cron` from outside → 403.
  - `ss -ltnp | grep 3000` → `127.0.0.1` only.
- [ ] **Tell the business owners:**
  - **API keys made before this release no longer work** (migration 154). Settings → API keys shows a notice. They create a new key and update every integration that used the old one. Keys can now have an expiry of up to 365 days, and stop working if their creator is removed or demoted.
  - **Viewers lost write access.** They can still read. Agents can no longer take a colleague's chats or leads, and get AI drafts only on their own chats. Admins can no longer act on other admins. Only the owner can connect WhatsApp, email, SMS or RCS credentials, or create API keys.
  - Sessions now end 8 hours after sign-in. To replace MFA, disable it first with the password.
  - Saved webhook, automation or Flows URLs that redirect to another site with a request body now fail with a clear message. Save the final https address instead.
- [ ] **Optional — old uploads (single-business servers only).** Files under `uploads/` that are not in an `account-*` folder and not recorded are served only while the server has exactly one business and sign-up is closed. To record them permanently:
  ```bash
  npx tsx --env-file=.env scripts/backfill-legacy-file-owner.ts           # dry run: counts only
  npx tsx --env-file=.env scripts/backfill-legacy-file-owner.ts --apply   # after a DB backup
  ```
  It writes nothing if there are zero, or two or more, businesses. It only adds `file_uploads` rows, and the files then appear in File Manager.
- [ ] **Click-through on staging, then on one production server.** These were not browser-tested after the COOP header change:
  - [ ] WhatsApp **Embedded Signup** (Meta popup completes; the number connects)
  - [ ] **Google connect** popup (Sheets/Calendar) returns to the app
  - [ ] **Razorpay payment link** / checkout opens and the payment is recorded
  - [ ] **Webchat widget** on a real customer website loads, sends and receives
  - [ ] A WhatsApp Flow loads in WhatsApp (signature check in enforce mode)
- [ ] **Watch the logs** for the first days:
  ```bash
  pm2 logs whatsapp-crm | grep -E '\[startup\]|\[DEV\]|HMAC mismatch|uncaughtException'
  sudo awk '$9==432 || $9==403' /var/log/nginx/access.log | tail       # adjust to your log format
  ```
  - `[startup]` should show warnings only, no refusals.
  - **`[DEV]` lines must never appear on production.** If they do, `APP_ENV` is set: fix it at once.
  - A spike of **432** means the Flows signature check is failing (app secret).
  - A spike of **403** means users are hitting the new role floors. Expected at first; check that no legitimate workflow is blocked.
- [ ] Confirm the nightly backup still runs and the off-site copy arrives.

## 4. Rollback plan

Use only if the release cannot be fixed forward.

1. **Code:** `git checkout pre-security-audit` (the baseline tag), then `npm ci && npx prisma generate && npm run build && pm2 reload whatsapp-crm`. **Roll the app back before rolling back the migrations.** The new code reads the new columns and refuses creator-less keys whatever the database says.
   - The old code ignores the columns that 152 adds, and the indexes that 153 adds do not affect it. Leaving the migrations in place after a code rollback is therefore usually the safer choice. Roll them back only if required.
2. **Migrations, in reverse order, each with its commented ROLLBACK block** (run by hand inside a transaction):
   - **154** re-activates only the keys it revoked whose `revoked_at` is unchanged, then drops `api_key_revocations_154`. It was tested on a throwaway DB and restored exactly the 2 keys it revoked.
   - **153** drops the two partial unique indexes `facebook_config_page_id_key` and `instagram_config_instagram_account_id_key`.
   - **152** drops `account_invitations.email` with its constraint, and drops the `api_keys` index, FK and the columns `revoked_at`, `expires_at` and `created_by_user_id`.
3. **Secrets:** if `NEXTAUTH_SECRET` was replaced, the old code works with the new value; there is no need to go back. **Never change `ENCRYPTION_KEY`.** Values sealed by the new code (FB/IG tokens, webhook signing secrets) stay readable only with the same key. The old code reads them as plain text, so FB/IG channels saved after the upgrade must be reconnected after a code rollback.
4. **Full restore** (last resort): restore into a **new** database first, never over the live one, and never from the app.
   1. Stop the app (`pm2 stop whatsapp-crm`).
   2. Restore the pre-deploy dump into a new database and check row counts (`accounts`, `contacts`, `messages`).
   3. Point `DATABASE_URL` at it.
   4. Restore `uploads/` from the pre-deploy archive.
   5. Check out the recorded previous commit, run `npm ci && npm run build`, and start.
