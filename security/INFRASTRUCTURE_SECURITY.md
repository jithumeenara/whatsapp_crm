# Infrastructure security

Part of the 2026-10 security audit. Index: [README.md](README.md). Sources: A6 infrastructure findings, A4 database findings, A1 round 2, and the reviewed examples in `Whatsapp-CRM/docs/deploy/` (`HARDENING.md`, `nginx.conf.example`, `ecosystem.config.example.cjs`).

> **Every server item in this document is a MANUAL ACTION.** The audit had no access to any VPS. No Nginx, PM2, systemd, firewall or database configuration exists in the repository, so the live servers could not be inspected. The repository now contains reviewed examples. Nginx is not installed in the audit environment, so `nginx.conf.example` has **not** been syntax-checked: run `sudo nginx -t` on the server. The step-by-step order is in [PRODUCTION_SECURITY_CHECKLIST.md](PRODUCTION_SECURITY_CHECKLIST.md).

## 1. Target layout per customer VPS

```
Internet ──443──> Nginx (TLS, HSTS, rate limits, body cap, X-Real-IP)
                    └──> 127.0.0.1:3000  Node (PM2, user "crm", NODE_ENV=production, 1 process)
                                         └──> PostgreSQL on localhost (role crm_app, scram-sha-256)
UFW: only 22 (limit), 80, 443 open.  SSH: keys only.  Backups: encrypted, off-site.
```

## 2. Application runtime (code-side controls already in place)

| Control | Where | Status |
|---|---|---|
| Production mode unless explicitly development | `server.ts` + `src/lib/security/startup-check.ts` (`isDevServer`). Dev mode only when `NODE_ENV=development`, or when it is unset under `npm run dev`. | FIXED in code (V-027) |
| Start-up secret check | Exits in production if `NEXTAUTH_SECRET`/`AUTH_SECRET` is missing, under 32 characters, a placeholder (`secret`, `password`, `example`, `changeme`, `placeholder`, …) or low-entropy, or if `ENCRYPTION_KEY` is not 64 hex characters or is repetitive. Warns on `APP_ENV=development`, `META_SOCIAL_SIGNATURE=observe`, `META_FLOWS_SIGNATURE=observe` and `AUTH_SECRET ≠ NEXTAUTH_SECRET`. Messages name the variable, never its value. | FIXED in code (V-028) |
| Loopback bind | `server.ts` binds `127.0.0.1` by default (`BIND_HOST`) | Pre-existing; keep `BIND_HOST` unset or `127.0.0.1` |
| Template secrets | `.env.local.example` leaves `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` and `META_APP_SECRET` blank, which fails closed. The DB password placeholder is `CHANGE_ME`. 19 previously undocumented variables are now documented. | FIXED |
| Non-production guard | `APP_ENV` development/dev/local/test/preview/staging stops every outbound message, tenant webhook, flow/automation HTTP step (every verb), call-forward, Meta Graph write and other provider write API (Telegram, Microsoft Graph, SMS gateways, SendGrid, Google writes/revoke, Razorpay, PhonePe). OAuth/token reads and AI calls stay open. `DEV_ALLOWED_HOSTS` is an exact-host opt-in that never unlocks messages. Preview/staging still **run background jobs** (`server.ts` stops them only for `APP_ENV=development`); their outbound effects are blocked. **Never set `APP_ENV` on production.** | FIXED in code (V-092) |
| Response headers (app) | CSP (enforced, `unsafe-inline` scripts; strict nonce policy report-only), HSTS, X-Frame-Options DENY + `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy, `poweredByHeader:false`, COOP `same-origin-allow-popups`, CORP `same-origin` on `/api/*` (except webchat and meta-ads/track), `object-src 'none'`, `/api` no-store | Mostly FIXED; CSP inline scripts remain (V-032) |

**Environment variable names** read by the app (values are never included here): ALLOWED_INVITE_HOSTS, APP_ENV, AUTH_SECRET, AUTOMATION_CRON_SECRET, BIND_HOST, DATABASE_URL, DEV_ALLOWED_HOSTS, DEV_ALLOWED_RECIPIENTS, DEV_ALLOW_SENDING, DEV_RUN_JOBS, ENCRYPTION_KEY, FACEBOOK_VERIFY_TOKEN, FLOWS_PRIVATE_KEY, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_TTS_CREDENTIALS(_B64), HOSTNAME, INSTAGRAM_APP_SECRET, INSTAGRAM_VERIFY_TOKEN, META_APP_SECRET, META_FLOWS_SIGNATURE, META_SOCIAL_SIGNATURE, NEXTAUTH_SECRET, NEXTAUTH_URL, NEXT_BUILD_CPUS, NEXT_PUBLIC_ALLOW_SIGNUP, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SITE_URL, NEXT_SKIP_TYPECHECK, NODE_ENV, PLATFORM_ADMIN_EMAILS, PORT, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SSRF_ALLOW_PRIVATE (ignored in production), USD_INR_RATE, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT, VIRUS_SCAN_WEBHOOK_URL, VOICE_AGENT_SECRET. No secret is exposed through `NEXT_PUBLIC_*`.

## 3. Secrets on the server (MANUAL)

- `.env` is owned by the app user with mode `600`. Generate every secret fresh (`openssl rand -hex 32`).
- Set **`NEXTAUTH_SECRET` only.** Leave `AUTH_SECRET` unset or equal to it: NextAuth prefers `AUTH_SECRET`, while `src/proxy.ts` reads `NEXTAUTH_SECRET`.
- Replacing a weak `NEXTAUTH_SECRET` **signs everyone out once**. No data is affected.
- **Never change `ENCRYPTION_KEY` on a server that has data.** Every stored WhatsApp, Instagram and Facebook token, provider API key and TOTP secret becomes unreadable. If the start-up check rejects the current key, restore the exact key the server was using; do not generate a new one. Keep it in a password manager, separate from backups.
- Never set on a server: `APP_ENV=development`, `META_SOCIAL_SIGNATURE=observe`, `BIND_HOST=0.0.0.0`, `SSRF_ALLOW_PRIVATE`, `DEV_ALLOW_SENDING`. Set `META_FLOWS_SIGNATURE=observe` only briefly while rolling out the Flows signature check.
- `NODE_ENV`, `PORT`, `BIND_HOST` and `HOSTNAME` are read **before** Next loads `.env`, so they must come from PM2's `env` block.
- Set `NEXT_PUBLIC_SITE_URL` (or `ALLOWED_INVITE_HOSTS`). Otherwise invitation links are built from the Host header (V-023), and Socket.io CORS has no allowed origin for cross-origin use.

## 4. Nginx and TLS (MANUAL — `docs/deploy/nginx.conf.example`)

| Concern | Setting in the example |
|---|---|
| TLS | TLS 1.2 + 1.3 only, Mozilla intermediate ECDHE-AES-GCM/CHACHA20 ciphers, `ssl_prefer_server_ciphers off`, session cache, **session tickets off**, certificates from certbot (reload hook) |
| OCSP | `ssl_stapling on` — a no-op with Let's Encrypt, which ended OCSP in 2025 |
| HSTS | Sent once, by Nginx: `max-age=63072000; includeSubDomains`. Add `preload` only after deciding to submit the **apex** domain, because that commits every subdomain. |
| Unknown Host | `ssl_reject_handshake on` (nginx ≥ 1.19.4; on 1.18 use the real certificate and `return 444`) |
| Leakage | `server_tokens off`, `X-Powered-By` hidden. Dotfiles (except `.well-known`) and `*.env/*.pem/*.key/*.sql/*.dump/*.bak/*.sh` → 404. Never `alias` the `uploads/` folder; files are served only through the authenticated `/api/files`. |
| Body size | `client_max_body_size 17m`, matching the app's 16 MB routes and 17 MB `proxyClientMaxBodySize` |
| Client IP | `proxy_set_header X-Real-IP $remote_addr` and `X-Forwarded-For $remote_addr` are **set, never appended**. `src/lib/net/client-ip.ts` keys every per-IP rate limit on them (V-036: PARTIALLY FIXED; the code mitigation is the loopback bind, and this Nginx setting is the manual remainder). Behind a CDN, use `set_real_ip_from` with the CDN's ranges only, and firewall 80/443 to those ranges. |
| WebSockets | `/socket.io/` and `/api/ai/live-voice`: Upgrade/Connection headers, buffering off, long timeouts |
| Rate limits | `crm_auth` 10 r/min (sign-in, register, password, MFA, verify, invitations); `crm_webhook` 50 r/s burst 200 (provider webhooks, Flows); `crm_public` 10 r/s (webchat, forms, `v/`, csp-report, MCP, voice, pixel, sheet-ping); `crm_api` 30 r/s; status 429 |
| Crons | `/api/(automations\|flows\|chatbot\|scheduled-messages\|offers)/cron` → `allow 127.0.0.1; allow ::1; deny all;` |

Verify on the server: `sudo nginx -t`; `curl -sI https://<host>` shows one HSTS header, `Server: nginx` with no version, and no X-Powered-By; `/.env` → 404; `/api/automations/cron` → 403; from another machine, `nmap --script ssl-enum-ciphers -p 443 <host>` shows no TLS 1.0 or 1.1.

## 5. PM2 and NODE_ENV (MANUAL — `docs/deploy/ecosystem.config.example.cjs`)

- Run as the non-root user `crm` (`pm2 startup systemd -u crm --hp /home/crm`). Never `sudo pm2`.
- **One process, fork mode** (`instances: 1`). Rate limits, Socket.io rooms, background sweeps, the TOTP replay memory and the legacy-file business-count cache all live in process memory. Cluster mode would multiply allowed guesses and run jobs twice.
- `env: { NODE_ENV: 'production', PORT: '3000', BIND_HOST: '127.0.0.1' }`. Secrets stay in `.env`, because `pm2 env` and `pm2 show` print the ecosystem env.
- `node_args: --max-old-space-size=1024`, `max_memory_restart: 1200M` (2 GB VPS), `kill_timeout: 10000`, timestamped logs.
- `pm2-logrotate`: `max_size 50M`, `retain 14`, `compress true`.
- Do not install with `--omit=dev`: `npm start` uses `tsx`, a dev dependency (see [DEPENDENCY_AUDIT.md §6](DEPENDENCY_AUDIT.md#6-recommendations)).
- Verify: the process user is `crm`; `ss -ltnp | grep 3000` shows `127.0.0.1:3000` only; after sign-in the cookie is named `__Secure-authjs.session-token` and flagged Secure (dev mode would use `authjs.session-token`); `pm2 env 0 | grep NODE_ENV` shows production.

## 6. Firewall — UFW (MANUAL)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp        # or your SSH port
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```
Never open 3000 or 5432. Docker, if ever installed, bypasses UFW, so publish container ports on 127.0.0.1 only. Verify from another machine: `nmap -Pn -p 1-65535 <ip>` shows only 22, 80 and 443.

## 7. SSH (MANUAL)

`/etc/ssh/sshd_config.d/99-hardening.conf`: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `AuthenticationMethods publickey`, `MaxAuthTries 3`, `LoginGraceTime 20`, `X11Forwarding no`, `AllowAgentForwarding no`, `AllowUsers <admin user>` (not `crm`, not root). Use ed25519 keys with a passphrase. Test a second session before closing the first, then run `sshd -t` and reload. fail2ban jails: `sshd` (4 tries per 10 min, 1 h ban) and `nginx-limit-req`. The hosting provider's browser console is the break-glass path.

## 8. PostgreSQL (MANUAL)

- `listen_addresses = 'localhost'`, `password_encryption = scram-sha-256`, `log_connections = on`. In `pg_hba.conf`: local and loopback only, scram everywhere, **no `trust`**.
- **Least privilege:** a `crm_owner` (NOLOGIN) role owns the schema; `crm_migrate` (login, in `crm_owner`) runs migrations; the runtime role `crm_app` is NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION with DML-only grants and default privileges. `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. Full SQL is in `HARDENING.md §6`.
  - **Caveat (V-066):** `server.ts` runs start-up DDL, and some routes call `ensureTable()` (`CREATE TABLE IF NOT EXISTS`). Under a DML-only role those fail. Either keep CREATE on `public` for `crm_app` for now (still not superuser), or move that DDL into migrations first. Dry-run on `crm_prod_copy`. `.env.local.example` previously suggested the `postgres` superuser; use a dedicated role.
- **sslmode:** `sslmode=disable` is fine over the Unix socket or loopback. Use `sslmode=verify-full` for any remote database. The DB scripts and the backup route now honour `?sslmode=` (V-064). Consider `connection_limit` and `pool_timeout` in `DATABASE_URL`.
- Isolation is enforced in application queries only (there is no RLS on the app's connection). Supabase-era RLS policies and RPCs in early migrations are inert on self-hosted PostgreSQL; a later cleanup migration is recommended (A4).
- Verify: `\du` shows `crm_app` with no attributes; `ss -ltn | grep 5432` shows loopback only.

## 9. Backups (MANUAL, plus code fixes)

| Item | State |
|---|---|
| DB password on `pg_dump` argv (visible in `ps`) | **FIXED** in `scripts/backup-db.sh`: it sources `pg-env.sh`, passes the password as `PGPASSWORD`, uses `umask 077` (V-063) |
| `sslmode` dropped | **FIXED** (V-064) |
| Backup files | `0600` files in a `0700` directory, 14-day local retention (pre-existing) |
| Encryption at rest | **MANUAL:** `age -r <public key>` (private key offline) before anything leaves the server (V-069) |
| Off-site copy | **MANUAL:** rclone to S3/B2 with a write-only key and object lock/versioning; 3-2-1 rule: 14 days local, 30 daily + 12 monthly off-site |
| uploads/ | **MANUAL:** not in the DB dump; back it up too |
| Restore drill | **MANUAL:** monthly restore into a *new* database (`crm_restore_check`), count rows, drop it, record the date |
| In-app whole-DB download | Platform owner only. A failed dump is now a 500 and pg_dump gets a minimal environment. **No step-up re-authentication yet** (V-046). |
| Key separation | Keep `ENCRYPTION_KEY` and `.env` out of the backup bucket |

## 10. Monitoring (MANUAL)

- External uptime check on `https://<host>/login` every minute; certificate-expiry alert at 14 days.
- Alerts for disk > 80 %, swap use, PM2 restarts > 3/hour, PostgreSQL down, and a backup heartbeat (alert if none within 26 h).
- Security signals to watch:
  - `[startup]` refusals or warnings
  - `[DEV] blocked …` lines (these must never appear on production; if they do, `APP_ENV` is set)
  - `[webhook] HMAC mismatch`
  - HTTP **432** (Flows signature failures)
  - **403** spikes after the role changes
  - 429 counts
  - `[uncaughtException]`, fail2ban bans, new SSH logins, CSP reports (`/api/csp-report`)
- Unattended security upgrades with reboot at 03:30 and `needrestart`. Node.js is **not** covered: check `node -v` against nodejs.org security releases monthly. Use Node 22 LTS at the latest patch (≥ 22.22.2) or Node 24 LTS; Node 20 is end of life.

## 11. Logging and redaction

| Item | State |
|---|---|
| Passwords, OTPs, session tokens, Authorization headers, full bodies | Not logged (A6 grep of 822 `console.*` calls). The send guard masks `access_token`. |
| Webhook verify tokens | Only the token length is logged (V-081 FIXED) |
| Phone numbers | `maskForLog()` (last 4 characters) in call-handler, whatsapp/send and the IG postback (V-057 PARTIALLY FIXED) |
| Still logging personal data | `src/lib/flows/meta-send.ts` (IGSID + message snippet; line 542: IGSID + start of a media URL), `src/lib/flows/webhook-handler.ts` (values customers enter in Flow forms), `contacts/[id]/block` (V-057) |
| `[DEV] blocked` lines | Provider name and host only; no path, query, body, token, authkey or phone numbers (V-119, FIXED in `f9b10c4`; before, the full URL was logged with only `access_token` masked) |
| Error responses | No `.stack` returned anywhere. Catch-alls in the A3 and A8 areas return fixed sentences. Some A9 sites are not confirmed (V-056). |
| Retention (MANUAL) | PM2 and nginx 14 days, compressed; journald `SystemMaxUse=500M`, `MaxRetentionSec=30day`; backup log weekly × 8; log files `640`. Logs contain DPDP personal data, so do not ship them to third parties without a data-processing agreement. |
