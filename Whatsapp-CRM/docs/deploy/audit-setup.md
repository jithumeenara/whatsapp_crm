# Audit log — off-server locker setup (phase 6)

What this sets up, per server (ACSTI, Hospital), once:

- **Role split:** the app can add audit events but can no longer change, delete,
  truncate, detach or drop them, even with its own database password.
- **crm-audit:** a separate Linux user that the app cannot read. Every hour it
  signs a checkpoint of each chain. Every 15 minutes it copies new events to
  Cloudflare R2. Once a day it checks everything and emails you.
- **R2 with Bucket Lock:** copies that nobody can delete or overwrite for 400
  days. Not even someone who takes over the server can remove them.
- **GitHub check:** once a day, away from the servers, it compares the R2 copy
  with each live server. On any mismatch it raises the alarm.

Plan: `docs/plans/audit-log-plan.md` §10, §11, §12, §20a.

Time needed: about 45 minutes the first time, then 15 minutes per server.

---

## 1. Cloudflare R2 — bucket, lock, two tokens (ഒരു സെർവറിന് ഒരു ബക്കറ്റ്)

Do this once per server. The Cloudflare account must have **2-step login on**,
because only the account owner can change the lock.

1. Sign in at dash.cloudflare.com → **R2 Object Storage**. The first time, it
   asks you to add a payment method. The free tier covers our use: about
   0.6 GB a year and about 3,000 writes a month.
2. **Create bucket** → name `crm-audit-acsti` (or `crm-audit-spcrm`) → location
   Automatic → Create.
3. Open the bucket → **Settings** → **Bucket lock rules** → **Add rule**:
   - Rule name: `keep-400-days`
   - Prefix: leave empty (the whole bucket)
   - Retention: **400 days**
   - Save.
4. Note the **S3 API** endpoint on the bucket's Settings page. It looks like
   `https://<account-id>.r2.cloudflarestorage.com`. Use it without the bucket
   name on the end.
5. R2 overview → **Manage R2 API Tokens** → **Create API token**:
   - **Token 1 (server, write):** name `acsti-audit-write`. Permission
     **Object Read & Write**. Under "Specify bucket", choose **only this
     bucket**. TTL forever. Create, then copy the **Access Key ID** and
     **Secret Access Key** (the secret is shown once).
     - The lock rule means that even a write token cannot delete or replace a
       locked object. The uploader only ever adds objects.
   - **Token 2 (read-only):** name `acsti-audit-read`. Permission **Object
     Read only**, same single bucket. Copy both values.
     - Used by the GitHub check, and optionally by the server's daily check.

Keep the four values in your password manager. They go into the server prompt
(step 4) and GitHub (step 7). Never put them in the app's `.env`.

## 2. Mail — Zoho app password (ഇമെയിൽ)

The alarm mail is sent by crm-audit, not by the app.

- **Zoho** (`info@scycon.com`):
  1. accounts.zoho.in → Security → **App Passwords** → Generate.
  2. Name it `crm-audit` and copy the password.
  3. SMTP server `smtp.zoho.in`, port `465`.
- **Gmail fallback:**
  1. Turn on 2-step verification.
  2. myaccount.google.com → App passwords → create one.
  3. SMTP server `smtp.gmail.com`, port `465`.
- **Recipients:**
  - the business owner's email
  - your own (platform owner) email
  - These are fixed in a root file. Nobody can change them from the app.

## 3. Check before you start (ആദ്യം പരിശോധിക്കുക)

On the server, in the app folder:

- Migration 157 must already be applied:

  ```bash
  source scripts/pg-env.sh && psql -c "select to_regclass('audit_events')"
  ```

- Take a fresh backup:

  ```bash
  bash scripts/backup-db.sh
  ```

- Know your database name and app role:
  - ACSTI: role `acsti_data`, app folder `~/whatsapp-crm/Whatsapp-CRM`
  - Hospital: role `db_spfort`, app folder `/home/deploy/CRM/Whatsapp-CRM`
  - The database name is in `.env` `DATABASE_URL`, after the last `/`.

## 4. Run the setup (സെർവറിൽ)

```bash
cd ~/whatsapp-crm/Whatsapp-CRM            # Hospital: cd /home/deploy/CRM/Whatsapp-CRM
sudo bash docs/deploy/audit-setup.sh acsti <database> acsti_data
#   Hospital: sudo bash docs/deploy/audit-setup.sh spcrm <database> db_spfort
```

It asks for your sudo password, then:

1. **Creates the `crm-audit` user and its folders.**
2. **Does the role split.** Type `yes` when asked. It prints a table: every line
   must say **PASS**. If one says FAIL, it stops and changes nothing.
   It also gives schema `public` to `postgres`: whoever owns a schema can DROP
   anything in it, and the app (the database owner) owned it. The app keeps
   CREATE there for its own tables. An `INFO` line says if the app still owns
   the database — it could DROP the whole database, which the nightly backup
   and the R2 copy cover.
3. **Creates the signing key** and prints its **fingerprint in a box. WRITE IT
   DOWN OFF THE SERVER** (paper, phone or password manager). Every daily mail
   shows the fingerprint. If the mail ever shows a different one, treat it as
   an alarm.
4. **Asks for the R2 and mail details.** Secrets are typed hidden.
5. **Builds the scripts into `/opt/crm-audit`** and installs cron jobs:
   - signer at :07 every hour
   - upload every 15 minutes
   - summary mail at 02:30 server time
   - retention on the 2nd of each month, off until you set it
6. **Runs a test:** sign, upload, and a test mail. Check your inbox and spam.

The role split can also be run on its own:

```bash
sudo -u postgres psql -d <database> -v app_role=acsti_data -f docs/deploy/audit-role-split.sql
```

## 5. The head endpoint secret (ആപ്പിന്റെ .env)

1. Make a secret:

   ```bash
   openssl rand -hex 32
   ```

2. Add it to the app's `.env` as `AUDIT_HEAD_TOKEN=<that value>`.
3. Restart the app: `pm2 restart whatsapp-crm` (Hospital: `pm2 restart spcrm`).
4. Test it:

   ```bash
   curl -s -H "Authorization: Bearer <value>" https://<your-domain>/api/audit/head
   ```

   The answer shows only account ids, seq numbers and hashes. Without the header
   the answer is 401.

## 6. After setup — three things to know

- **Restoring a database:**
  - Always restore into a NEW database first.
  - After the restore, run `audit-role-split.sql` again on the restored
    database. A restore done as the app role makes the app the owner again.
  - Then wait for the daily mail. Events after the backup are missing, and the
    alarm about that gap is expected after a restore.
- **Migrations:**
  - Never re-run migration 157 with `apply-migrations.sh` after the split. The
    app role no longer owns the audit functions, so it would fail.
  - A future migration that changes audit tables is run like this:

    ```bash
    sudo -u postgres psql -d <db> -c 'SET ROLE crm_audit_owner' -f <file>
    ```

- **Retention (off by default):**
  - In `/etc/crm-audit/<app>.retention` (root), set `AUDIT_RETENTION_MONTHS=13`.
  - Try it first with nothing changed:

    ```bash
    sudo DRY_RUN=1 bash /opt/crm-audit/retention.sh acsti
    ```

  - Legal hold: set `AUDIT_RETENTION_HOLD=1`.
  - Archives go to `/var/backups/crm-audit/archive/` and to R2. Rows are never
    deleted one by one: a whole month is dumped, checked, uploaded and
    checkpointed, and only then detached and dropped.

## 7. GitHub secrets (സെർവറിന് പുറത്തുള്ള പരിശോധന)

1. Open the repo on GitHub → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**.
2. Add these for each server. Use the prefix `ACSTI_` or `HOSPITAL_`:

   | Secret | Value |
   |---|---|
   | `ACSTI_AUDIT_HEAD_URL` | `https://<acsti domain>/api/audit/head` |
   | `ACSTI_AUDIT_HEAD_TOKEN` | the `AUDIT_HEAD_TOKEN` from step 5 |
   | `ACSTI_AUDIT_PUBLIC_KEY` | the public key block printed in step 4, every line from `-----BEGIN PUBLIC KEY-----` to `-----END PUBLIC KEY-----` |
   | `ACSTI_R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `ACSTI_R2_BUCKET` | `crm-audit-acsti` |
   | `ACSTI_R2_READ_ACCESS_KEY_ID` | read-only token, Access Key ID |
   | `ACSTI_R2_READ_SECRET_ACCESS_KEY` | read-only token, Secret Access Key |

3. Add these once, shared by both servers:

   `AUDIT_SMTP_HOST`, `AUDIT_SMTP_PORT` (465), `AUDIT_SMTP_USER`,
   `AUDIT_SMTP_PASS`, `AUDIT_SMTP_FROM`, `AUDIT_ALARM_TO` (comma-separated).

4. Then go to **Actions** → **Audit off-server check** → **Run workflow**. Each
   server's job should end green. A server with no secrets yet is skipped.
   - The check runs daily at 07:00 IST.
   - A red job also emails the alarm.
   - The check reads only R2 (read-only) and the head endpoint. It never
     touches the server.

## 8. What the mails look like (ദിവസേനയുള്ള മെയിൽ)

**All good** (once a day), subject `✅ Audit log — ACSTI — all good`:

```
Audit log — ACSTI — 2026-11-03

00000000-0000-0000-0000-000000000000: 412 events, chain OK, last checkpoint seq 412, R2 checkpoint seq 412
5f0c…-…: 18 230 events, chain OK, last checkpoint seq 18 230, R2 checkpoint seq 18 230

Checkpoints signed in the last 24 h (24):
  2026-11-02T03:07:01.412Z  5f0c…  through seq 17 890  9a1c3e…  (+31)
  …

Signing key fingerprint (SHA-256): 3f2a 9c1d …
Compare it with the fingerprint you wrote down at setup (kept OFF the server).
```

**Alarm** (sent at once, at most every 6 hours for the same problem), subject
`🔴 Audit alarm — ACSTI: …`. It lists what failed, for example "chain head went
BACKWARDS", "the server's chain is SHORTER than the off-server copy", "BAD
SIGNATURE", or "the off-server upload has not succeeded since …".

### If an alarm arrives

1. **Don't** restart, restore or "fix" anything yet. The evidence is on the
   server's disk.
2. Take a disk snapshot at the hosting provider.
3. Read the alarm line. It names the account and the seq where things differ.
4. Compare with the R2 copy, which cannot be changed. See plan §20a
   ("If a server is hacked").
5. Expected alarms:
   - right after a database restore
   - when the head endpoint secret was changed without updating GitHub

## Files

| File | Runs as | When |
|---|---|---|
| `docs/deploy/audit-role-split.sql` | postgres | once, and after any restore |
| `docs/deploy/audit-setup.sh` | root (sudo) | once per server |
| `/opt/crm-audit/signer.cjs` ← `scripts/audit/signer.ts` | crm-audit | hourly |
| `/opt/crm-audit/upload.cjs` ← `scripts/audit/upload.ts` | crm-audit | every 15 min |
| `/opt/crm-audit/daily-mail.cjs` ← `scripts/audit/daily-mail.ts` | crm-audit | daily |
| `/opt/crm-audit/retention.sh` ← `scripts/audit/retention.sh` | root | monthly, off until set |
| `scripts/audit/external-verify.ts` | GitHub Actions | daily |
| `/etc/crm-audit/<app>.json` | read by crm-audit (0400) | settings + secrets |
| `/var/lib/crm-audit/<app>/` | crm-audit (0700) | progress, `checkpoints.ndjson`, alarm log |

After a code update that changes `scripts/audit/*`, rebuild — build as the
app user, copy as root (root never runs the app's esbuild or npm). Running
`audit-setup.sh` again does exactly this; by hand:

```bash
B=$(sudo -u <app user> mktemp -d)
sudo -u <app user> -H bash scripts/audit/build.sh "$B"
sudo install -m 0640 -o root -g crm-audit "$B"/*.cjs /opt/crm-audit/
sudo install -m 0750 -o root -g crm-audit scripts/audit/retention.sh /opt/crm-audit/
sudo rm -rf "$B"
```
