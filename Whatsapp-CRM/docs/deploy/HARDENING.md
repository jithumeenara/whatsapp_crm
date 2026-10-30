# Production server hardening (Ubuntu + nginx + PM2 + PostgreSQL)

Every item here is a **MANUAL ACTION** on the VPS — nothing in this repo
applies it. Work top to bottom; each section ends with a command that
proves the step took. Replace `crm.example.com`, `crm` (the app's Linux
user) and paths with your own. Example files: `docs/deploy/nginx.conf.example`,
`docs/deploy/ecosystem.config.example.cjs`, `.env.local.example`.

## 0. Upgrading an existing server

Read this **before** deploying the 2026-10 security release onto a server that is
already running. A production start now checks its secrets and **refuses to start**
if one is weak. The pm2 log names the variable and what is wrong with it
(`[startup] NEXTAUTH_SECRET is 20 characters long; it must be at least 32 …`),
never its value. Check these first, in the server's environment file
(e.g. `.env.production`), without printing them:

```bash
# lengths only — never echo the values themselves
for v in NEXTAUTH_SECRET AUTH_SECRET ENCRYPTION_KEY; do
  printf '%s: ' "$v"; grep -E "^$v=" .env.production | cut -d= -f2- | tr -d '\n"' | wc -c
done
```

- **`NEXTAUTH_SECRET`** (and **`AUTH_SECRET`**, if set): at least 32 random
  characters, and must not contain a placeholder word such as `secret`,
  `password`, `example`, `changeme`, `placeholder`. If it fails, make a new one with
  `openssl rand -hex 32`. Changing it **signs everyone out once** (they sign in
  again; no data is touched). Keep `AUTH_SECRET` unset, or equal to
  `NEXTAUTH_SECRET`.
- **`ENCRYPTION_KEY`**: exactly 64 hexadecimal characters. **Do NOT change it on a
  server that already has data**: every stored WhatsApp/Instagram/Facebook token,
  provider API key and password it encrypted becomes unreadable, and each channel
  must then be reconnected by hand. If the check rejects the key a running server is
  using, stop and restore the exact key it was started with (backup of the env file,
  password manager) rather than generating a new one. Only a brand-new server takes
  a fresh key (`openssl rand -hex 32`).
- **Migration 154** turns off API keys made before key creators were recorded
  (`supabase/migrations/154_revoke_creatorless_api_keys.sql`, dry-run on
  `crm_prod_copy` first). Tell account owners: Settings → API keys shows a notice;
  they create a new key and update their integrations.
- **Old uploads (optional, manual).** Files uploaded before per-account folders
  (`uploads/<name>`, not `uploads/account-<id>/<name>`) that have no `file_uploads`
  row are served and sendable only while the server has **one business** (an
  account with at least one member who can sign in; holding accounts of removed
  members and empty personal accounts do not count) **and** public sign-up is
  closed. Once a second business exists, they return 404. To make them
  permanently the business's own, on a server that has exactly one business, run
  once from the app directory (back up the database first):

  ```bash
  npx tsx --env-file=.env scripts/backfill-legacy-file-owner.ts           # dry run: counts only
  npx tsx --env-file=.env scripts/backfill-legacy-file-owner.ts --apply   # record the owner
  ```

  It only adds `file_uploads` rows (never deletes or moves a file), skips files
  already recorded so a second run changes nothing, prints counts only, and
  writes nothing if there are zero or two or more businesses. The recorded files
  then appear in that business's File Manager.

## 1. App user and files

```bash
sudo adduser --disabled-password --gecos "" crm      # the app never runs as root
sudo -iu crm git clone <repo> ~/Whatsapp-CRM
cd ~/Whatsapp-CRM
cp .env.local.example .env && chmod 600 .env          # fill in; secrets are blank on purpose
chmod 700 ~ ~/Whatsapp-CRM/uploads 2>/dev/null || true
```

- Generate every secret fresh: `openssl rand -base64 32` (NEXTAUTH_SECRET,
  cron/voice secrets), `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  (ENCRYPTION_KEY). Keep ENCRYPTION_KEY in a password manager **separate from
  backups** — without it, stored channel tokens are unreadable; with it plus a
  dump, they are readable.
- Set `NEXTAUTH_SECRET` only, not `AUTH_SECRET` (two different values lock
  everybody out: NextAuth prefers AUTH_SECRET, `src/proxy.ts` reads NEXTAUTH_SECRET).
- Never set on a server: `APP_ENV=development`, `META_SOCIAL_SIGNATURE=observe`,
  `META_FLOWS_SIGNATURE=observe` (only briefly, while rolling out the Flows
  endpoint signature check), `BIND_HOST=0.0.0.0`.
- `NODE_ENV`, `PORT`, `BIND_HOST`, `HOSTNAME` are read by `server.ts` **before**
  Next loads `.env`, so they must come from PM2's `env` block, not from `.env`.
- Check: `stat -c '%a %U' .env` → `600 crm`; `grep -c '^[A-Z_]*=$' .env` lists nothing you rely on.

## 2. Nginx reverse proxy

Install `docs/deploy/nginx.conf.example` as `/etc/nginx/sites-available/crm`. It provides:

| Concern | Setting |
|---|---|
| TLS | TLS 1.2 + 1.3 only, Mozilla intermediate ciphers, session tickets off; certificates from certbot (`sudo certbot certonly --webroot -w /var/www/letsencrypt -d crm.example.com`; renewal timer is installed by the package, add `--deploy-hook "systemctl reload nginx"`). |
| OCSP | `ssl_stapling on` — only effective for a CA that still serves OCSP (Let's Encrypt ended OCSP in 2025). |
| HSTS | Sent once, by nginx: `max-age=63072000; includeSubDomains`. `preload`: only add after deciding to submit the **apex** domain at hstspreload.org — that commits every subdomain of the apex to HTTPS for months, and on a `crm.` subdomain the token alone does nothing. |
| Body size | `client_max_body_size 17m` = AGENTS.md rule 9 (routes 16 MB, `proxyClientMaxBodySize` 17mb). |
| Client IP | `X-Real-IP $remote_addr` and `X-Forwarded-For $remote_addr` are **set**, never appended — `src/lib/net/client-ip.ts` keys every rate limit on them. Behind a CDN, use `set_real_ip_from` with the CDN's ranges only and firewall 80/443 to those ranges. |
| WebSockets | `/socket.io/` and `/api/ai/live-voice` get `Upgrade`/`Connection` headers, buffering off, 1 h timeouts. |
| Rate limits | `crm_auth` 10 r/min (sign-in, register, password, MFA, verify, invitations), `crm_webhook` 50 r/s burst 200 (Meta batches), `crm_public` 10 r/s (website chat, forms, MCP, voice), `crm_api` 30 r/s. Cron routes: localhost only. |
| Leakage | `server_tokens off` (in nginx.conf), `X-Powered-By` hidden, dotfiles and `*.env/*.pem/*.sql/*.dump/*.sh` → 404, unknown Host → TLS handshake refused. |
| Uploads | Served only through the app (`/api/files/…`, with auth) — never `alias` the `uploads/` folder. |

Check:
```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://crm.example.com | grep -iE 'strict-transport|server:|x-powered'   # one HSTS, "Server: nginx", no version, no X-Powered-By
curl -s -o /dev/null -w '%{http_code}\n' https://crm.example.com/.env              # 404
curl -s -o /dev/null -w '%{http_code}\n' https://crm.example.com/api/automations/cron   # 403
nmap --script ssl-enum-ciphers -p 443 crm.example.com    # from another machine: no TLS 1.0/1.1
```

## 3. PM2

Use `docs/deploy/ecosystem.config.example.cjs`:

- Runs as user `crm` (`pm2 startup systemd -u crm --hp /home/crm`); never `sudo pm2`.
- **One process, fork mode.** Rate limits, Socket.io rooms and background sweeps live in
  the process's memory; cluster mode multiplies allowed guesses and runs jobs twice.
- `NODE_ENV=production` in `env` — otherwise `server.ts` starts Next in dev mode
  (no `Secure` cookie, dev error pages with stack traces).
- `max_memory_restart: 1200M`, `--max-old-space-size=1024` for a 2 GB VPS.
- Secrets stay in `.env`, not in the ecosystem file (`pm2 env 0` / `pm2 show` print the
  ecosystem `env`; the file is easily shared).
- Log rotation: `pm2 install pm2-logrotate`, `max_size 50M`, `retain 14`, `compress true`.
- Deploy sequence: `git pull && npm ci && npx prisma generate && NEXT_BUILD_CPUS=1 npm run build && pm2 reload whatsapp-crm`.
  `npm start` uses `tsx` (a devDependency), so do not install with `--omit=dev`.

Check: `ps -o user= -p $(pgrep -f 'server.ts' | head -1)` → `crm`; `ss -ltnp | grep 3000` → `127.0.0.1:3000` only;
and after signing in, the browser shows the session cookie as `__Secure-authjs.session-token`, flagged Secure (dev mode would name it `authjs.session-token`).

## 4. Firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp          # or your SSH port; "limit" = 6 attempts / 30 s per IP
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Nothing else: not 3000 (Node binds 127.0.0.1 anyway), not 5432. Docker, if ever
installed, bypasses UFW via iptables — publish container ports on 127.0.0.1 only.
Check from another machine: `nmap -Pn -p 1-65535 <server-ip>` → only 22, 80, 443 open.

## 5. SSH

`/etc/ssh/sshd_config.d/99-hardening.conf`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowAgentForwarding no
AllowUsers deploy            # your admin user; not "crm", not root
```

Test a second session with the key **before** closing the first, then `sudo sshd -t && sudo systemctl reload ssh`.
Use ed25519 keys with a passphrase. Hostinger's browser console remains the break-glass path.

fail2ban: `sudo apt install fail2ban`, `/etc/fail2ban/jail.d/local.conf`:

```
[sshd]
enabled = true
maxretry = 4
bantime = 1h
findtime = 10m

[nginx-limit-req]
enabled = true
logpath = /var/log/nginx/crm.error.log
maxretry = 20
bantime = 30m
```

Check: `sudo fail2ban-client status sshd`.

## 6. PostgreSQL

- `postgresql.conf`: `listen_addresses = 'localhost'`, `password_encryption = scram-sha-256`,
  `ssl = on` (needed only if the DB is ever reached over a network), `log_connections = on`,
  `log_min_duration_statement = 2000`.
- `pg_hba.conf` — local only, scram everywhere, no `trust`:
  ```
  local   all          postgres                     peer
  local   whatsapp_crm crm_app                      scram-sha-256
  host    whatsapp_crm crm_app   127.0.0.1/32       scram-sha-256
  host    whatsapp_crm crm_app   ::1/128            scram-sha-256
  ```
- Least-privilege runtime role (no superuser, no CREATEDB/CREATEROLE). Migrations run
  separately as an owner role:
  ```sql
  CREATE ROLE crm_owner NOLOGIN;                         -- owns the schema/tables
  CREATE ROLE crm_migrate LOGIN PASSWORD '<random>' IN ROLE crm_owner;
  CREATE ROLE crm_app LOGIN PASSWORD '<random>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  ALTER DATABASE whatsapp_crm OWNER TO crm_owner;
  REVOKE ALL ON DATABASE whatsapp_crm FROM PUBLIC;
  GRANT CONNECT ON DATABASE whatsapp_crm TO crm_app;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO crm_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE crm_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE crm_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO crm_app;
  ```
  **Caveat before switching:** `server.ts` runs start-up DDL (`ensureDataStoreColumns`,
  `ensureEmailColumns`, `ensureAiMetaColumn`) and some routes call `ensureTable()`
  (`CREATE TABLE IF NOT EXISTS`, e.g. Facebook config). Under a DML-only role those fail.
  Either keep CREATE on schema `public` for `crm_app` for now (still no superuser), or
  move that DDL into `supabase/migrations/` first. Dry-run on `crm_prod_copy`.
- `DATABASE_URL` with `?sslmode=disable` is fine over the Unix socket/loopback; use
  `sslmode=verify-full` for any remote database.
- Check: `sudo -u postgres psql -c "\du"` → `crm_app` has no attributes; `ss -ltn | grep 5432` → 127.0.0.1 only.

## 7. Backups

`scripts/backup-db.sh` (cron at 02:30) makes a verified, `chmod 600` dump on the same disk. Add:

- **Uploads too**: `uploads/` holds every received file and is not in the database dump.
- **Encrypt before it leaves the server** (public-key, so the server cannot decrypt):
  `age -r <age-public-key> -o file.dump.age file.dump` (private key kept offline).
- **Off-site, append-only**: rclone to S3/B2/Drive with a key that can write but not
  delete (object lock / versioning on). 3-2-1: local 14 days, off-site 30 daily + 12 monthly.
- **Restore drill monthly**: download the latest off-site copy, decrypt, `pg_restore` into a
  *new* database (`crm_restore_check`), count rows in `accounts`, `contacts`, `messages`,
  then drop it. Write the date and duration down; an untested backup is not a backup.
- Alert when the newest off-site file is older than 26 h (see §9).
- Keep ENCRYPTION_KEY and `.env` in a password manager, not in the backup bucket.

## 8. Unattended upgrades

```bash
sudo apt install unattended-upgrades needrestart
sudo dpkg-reconfigure -plow unattended-upgrades
```
`/etc/apt/apt.conf.d/52unattended-upgrades-local`:
```
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
Unattended-Upgrade::Mail "ops@example.com";
```
Node.js and npm packages are not covered: check `node -v` against nodejs.org security
releases monthly and run `npm audit --omit=dev` on every deploy.
Check: `sudo unattended-upgrade --dry-run --debug | tail`.

## 9. Monitoring and alerting

- **Uptime**: external check (UptimeRobot / Better Stack / Healthchecks) on
  `https://crm.example.com/login` (public, expect 200) every minute, alert by phone/email.
- **Certificate expiry**: same tool, alert at 14 days.
- **Resources**: alert at disk > 80 %, RAM swap use, PM2 restart count > 3/hour
  (`pm2 jlist`), PostgreSQL down. Netdata or a cron'd script is enough at this size.
- **Backups**: the backup cron pings a Healthchecks URL on success; a missed ping alerts.
- **Security signals** worth a daily glance or alert: `[webhook] HMAC mismatch`,
  `[uncaughtException]`, 429 counts in the nginx log, `fail2ban` bans, new SSH logins
  (`/var/log/auth.log`), `pm2 logs whatsapp-crm | grep csp-report`.

## 10. Log retention

Application logs contain phone numbers, Instagram ids, contact names and snippets of
message text (DPDP personal data). Keep them only as long as they serve debugging:

- PM2: `pm2-logrotate` `retain 14`, compressed.
- nginx: `/etc/logrotate.d/nginx` → `daily`, `rotate 14`, `compress`.
- journald: `/etc/systemd/journald.conf` → `SystemMaxUse=500M`, `MaxRetentionSec=30day`.
- `/var/log/crm-backup.log`: add to logrotate (`weekly`, `rotate 8`).
- Log files `640`, owned by the writing user; never ship them to a third party
  without a data-processing agreement.
