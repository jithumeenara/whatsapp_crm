# Audit log — implementation plan

Status: **plan only** (2026-11-02). Nothing here is built. No schema, auth or
production change is made until the owner approves this plan.

Inputs: a codebase inventory (every log-like table, auth path, mutating route
and non-user actor in this repo) and a standards brief (OWASP Logging + Logging
Vocabulary, NIST SP 800-92 / 800-53 AU-2/3/9/10/11/12, ISO 27001:2022 A.8.15,
A.8.16, A.5.28, SOC 2 CC6.1/CC7.2, AWS CloudTrail integrity validation, GitHub /
Stripe / Salesforce / Google Cloud / Okta audit models, OWASP LLM06 and Agentic
AI T8, DPDP Rules 2025 Rule 6). An independent security review of this
document follows in §21.

---

## 0. Decisions in one page

| Question | Decision |
|---|---|
| Where | One app-level table `audit_events` in the same Postgres, monthly partitions. No pgaudit, no external SIEM (a 2–4 GB VPS per customer). |
| What writes it | One server helper `audit()` in `src/lib/audit/`, called where the actor is known (route handlers, services, AI tools, webhooks, sweeps). Not DB triggers — they only know the DB user. |
| Who reads it | **Admin and owner of that account only**, enforced in the API (`requireRole('admin')` + `account_id`), not only in the UI. Supervisors, agents, viewers, API keys: refused. |
| Who can change it | **Nobody through the app.** No update/delete code path exists; DB triggers refuse UPDATE, DELETE and TRUNCATE; rows are hash-chained per account. |
| Tamper evidence | Reuse the proven `admin_chat_audit` pattern (SHA-256 chain + `pg_advisory_xact_lock` per account), with every column hashed and a contiguous `seq`. Hourly checkpoints are signed by a **separate Unix user the app cannot read** and emailed off the server. **Honest limit:** someone holding the app's DB login can still remove rows; the plan makes that *detected*, and phase 6 removes it where the server allows. |
| Personal data | Field names + masked values only. Never secrets, tokens, OTPs, password hashes, full Aadhaar, raw message bodies, or raw record snapshots. |
| Retention | 13 months online (covers DPDP Rule 6's one-year minimum), then a month partition is archived to a dump and detached — never `DELETE`. |
| AI agents | Always `actor_type = 'agent'` with the agent kind, the human principal, the tool, the approval (if any) and the conversation — never disguised as a staff member or the owner. |
| Rollout | Six phases, each shippable alone, behind `AUDIT_LOG=on`. Security/admin events first, because those are where the app has no record today. |

---

## 1. What exists today (and why this is needed)

Durable records that already exist:

- **`admin_chat_audit`** (migration 141, `src/lib/admin-chat/audit.ts`): append-only, SHA-256 hash chain over `prev|account|event|stableJson(detail)|createdAt`, `pg_advisory_xact_lock` per account, `verifyAuditChain()`. **The model for this plan.** Its weakness: rows cascade-delete with the account, and write failures are swallowed.
- `google_activity`, `assignment_events`, `ai_usage_events`: narrow, mutable or actor-less.
- `lead_activities`, `automation_logs`, `flow_run_events`: business timelines; **rows are deleted or re-pointed** on contact delete/merge, so they are not evidence.
- `user_sessions` (IP, user agent, revoked_at) and `contact_merges` (full PII snapshot — itself a privacy concern).

Actions that leave **no durable record today** (from the inventory):

1. Login success/failure, MFA verify failures, MFA enrol/disable, password change, admin password reset, email verify, register, rate-limit refusals.
2. Role, `page_access`, `restrict_to_assigned` changes; member deactivate/revive; ownership transfer; invitations (hard-deleted).
3. API key create/revoke (revoke is a hard delete) and per-request key use; **API-key actions are attributed to the key's creator** (`requireRoleOrApiKey` drops `keyId`).
4. Whole-database backup download (console line only); platform Meta config changes.
5. WhatsApp / AI / integration / webhook-secret / payment / channel config changes.
6. Permanent contact delete (which also deletes its lead_activities); Data Store record update/delete; table delete; imports; broadcast and contact-list exports; broadcast send/retry/rescue.
7. Edits/deletes of templates, automations, flows, chatbots, pipelines.
8. AI and webhook writes: AI tools write with `user_id = null` or fall back to the owner; `external/webhook` writes as the owner.
9. CSP reports and security warnings reach only pm2 logs.

---

## 2. Architecture

```
route handler / service / AI tool / webhook / sweep
        │  ctx = { accountId, actor, requestId, ip, ua, source }
        ▼
src/lib/audit/audit.ts  ── audit(ctx, event)          ← the only writer
        │   1. validate action name (registry)
        │   2. sanitize: allow-listed fields, mask, cap sizes, strip CR/LF
        │   3. diff(before, after) → changes
        ▼
SQL function audit_append(...)  (SECURITY DEFINER, phase 5)
        │   pg_advisory_xact_lock(account) → prev_hash → row_hash
        ▼
audit_events  (partitioned by month; UPDATE/DELETE/TRUNCATE refused by trigger)
        │
        ├── daily: audit_checkpoints row + Ed25519 signature → off-server copy
        ├── /api/audit/*  (admin only) → Settings → Audit log
        └── verify job: walk chains, check checkpoints → alert owner
```

Why app-level and not triggers or pgaudit: the inventory shows one DB role, runtime DDL, and actors (AI, API keys, webhooks) that only the app can name. Triggers would record "crm_app did UPDATE" for every one of them. pgaudit needs a superuser (Hospital's DB user is not), writes text to the server log, and costs disk the VPS does not have. A narrow trigger on money/permission tables is listed as an optional later layer (§20).

---

## 3. Database schema (migration 157, written in phase 1)

Requires PostgreSQL 13 or later (BEFORE ROW triggers on partitioned tables). Phase 1 checks `server_version_num` and refuses to run below 130000.

```sql
CREATE TABLE IF NOT EXISTS audit_events (
  id             bigint      NOT NULL,          -- set inside audit_append (nextval), before hashing
  seq            bigint      NOT NULL,          -- contiguous per chain (1,2,3…): the chain is walked by seq, so a rolled-back id never looks like a gap
  account_id     uuid        NOT NULL,          -- no FK: history outlives the account. Events with no account (failed login with an unknown email, register, proxy rate limits) use the PLATFORM chain: a fixed sentinel uuid, readable only by the platform owner
  occurred_at    timestamptz NOT NULL,          -- set in audit_append as date_trunc('milliseconds', clock_timestamp()): JS and SQL then hash the same value
  ingested_at    timestamptz NOT NULL,          -- differs from occurred_at only for replayed fallback rows
  -- who
  actor_type     text        NOT NULL CHECK (actor_type IN ('user','api_key','agent','system','webhook')),
  actor_id       text,                          -- user id / api key id / agent kind / job name / provider
  actor_label    text,                          -- name at the time ("Anu (admin)"), masked if it is a phone
  actor_role     text,                          -- role at the time of the action
  on_behalf_of   uuid,                          -- the human principal an agent/key acted for
  -- what
  action         text        NOT NULL,          -- 'lead.update', 'member.role_change', 'auth.login_fail'
  category       text        NOT NULL,          -- auth | access | admin | config | data | export | agent | system
  outcome        text        NOT NULL CHECK (outcome IN ('success','denied','failure')),
  reason         text,                          -- user-supplied reason or the error class, ≤ 500 chars
  -- on what
  target_type    text,                          -- 'lead', 'contact', 'member', 'data_record', 'setting'
  target_id      text,
  target_label   text,                          -- masked display label
  changes        jsonb,                         -- {"status":["new","won"], "phone":["••••7997","••••7998"]}
  -- context
  request_id     text,
  correlation_id text,                          -- groups a bulk action, an import, an agent turn
  source         text        NOT NULL,          -- web | api | mcp | job | webhook | ai | admin_chat | system
  ip             inet,
  user_agent     text,                          -- ≤ 300 chars
  meta           jsonb,                         -- small extras (agent model, tool, approval id, counts)
  -- integrity
  prev_hash      text        NOT NULL,
  row_hash       text        NOT NULL,
  PRIMARY KEY (id, occurred_at),
  UNIQUE (account_id, seq, occurred_at)
) PARTITION BY RANGE (occurred_at);
```

- **Partitions:** one per month.
  - **Created ahead, not lazily:** `audit_append` creates the current month's partition if it is missing, and a daily job creates three months ahead. *Not* `onceSchemaPatch`, which runs once per process and lazily. A process that stays up for months would miss later partitions, rows would land in the default partition, and creating the real partition would then fail for good.
  - **Default partition:** kept only as a net. A daily check alerts the owner if it holds any row.
  - **Immutability triggers go on every partition** as well as the parent, from the same helper that creates partitions. A `TRUNCATE` aimed at one partition does not fire the parent's trigger.
- **Indexes (per partition):** BRIN `(occurred_at)`; B-tree `(account_id, occurred_at DESC, id DESC)` (main list + cursor paging); `(account_id, target_type, target_id, occurred_at DESC)` (record history); `(account_id, actor_id, occurred_at DESC)`; `(account_id, request_id)`; `(account_id, correlation_id)`. No GIN on JSONB (RAM).
- **Immutability triggers:** `BEFORE UPDATE OR DELETE … FOR EACH ROW` and `BEFORE TRUNCATE … FOR EACH STATEMENT` raising `audit_events is append-only`.
- **`audit_checkpoints`**: `(account_id, through_id, through_hash, row_count, created_at, signature, key_id)`, same immutability triggers.
- **`audit_chain_heads`**: `(account_id PK, last_seq, last_id, last_hash)`, the per-account chain head, updated only inside `audit_append`. It is never trusted on its own: the verifier compares it against the newest off-server checkpoint (§11).
- Safe to run twice (`IF NOT EXISTS`, guarded `DO` blocks). Dry-run inside `BEGIN … ROLLBACK` on `crm_prod_copy` first. On Hospital (DB user not superuser), every step must work without `CREATE ROLE`; the role split is phase 5 and optional per server.

---

## 4. Audit event structure and naming

- **Action names:** `resource.verb`, lower-case, from a fixed registry `src/lib/audit/actions.ts` (an unknown name throws in tests and is refused at runtime). Examples:
  - **auth:** `auth.login_success`, `auth.login_fail`, `auth.logout`, `auth.mfa_fail`, `auth.mfa_enabled`, `auth.mfa_disabled`, `auth.password_changed`, `auth.password_reset_by_admin`, `auth.session_revoked`, `auth.signed_out_everywhere`, `auth.rate_limited`
  - **access:** `access.denied` (403 from `requireRole` / `requirePageAccess`), `access.audit_viewed`, `access.audit_exported`, `access.audit_verified`
  - **admin:** `member.invited`, `member.invite_cancelled`, `member.joined`, `member.role_changed`, `member.pages_changed`, `member.deactivated`, `member.revived`, `account.ownership_transferred`, `api_key.created`, `api_key.revoked`, `database.backup_downloaded`
  - **config:** `config.whatsapp_changed`, `config.ai_changed`, `config.integration_changed`, `config.webhook_changed`, `config.payment_changed`, `config.channel_changed`, `config.security_changed`, `config.platform_meta_changed` (values never stored — only which fields changed)
  - **data:** `<entity>.created|updated|deleted|archived|restored|merged|status_changed|assigned`, `<entity>.bulk_updated|bulk_deleted` (one event with `correlation_id` + counts, plus per-record events up to a cap), `import.completed`, `file.uploaded|deleted`, `payment.link_created|paid|refunded`, `broadcast.sent|retried|rescued`
  - **export:** `export.contacts|broadcast|contact_list|data_table|audit`
  - **agent:** `agent.tool_called`, `agent.record_written`, `agent.action_confirmed|rejected`, `agent.handover`
  - **system:** `system.job_failed`, `system.webhook_rejected` (bad signature), `system.audit_write_failed`, `system.chain_broken`
  - These map one-to-one onto OWASP Logging Vocabulary names (`authn_login_fail` → `auth.login_fail`) for SIEM-friendly exports.
- **Changes format:** `{ field: [before, after] }`, only changed fields, only fields in that entity's allow-list. Long text is stored as `"(changed, 1,240 chars)"`, not its content.
- **Never stored** (enforced in the sanitizer and in tests): passwords and hashes, TOTP secrets, OTP/MFA codes, session tokens, API key values or hashes, webhook/signing secrets, OAuth tokens, encrypted config blobs, `ENCRYPTION_KEY`-sealed values, full Aadhaar/PAN/bank/card numbers, raw WhatsApp/email message bodies, raw Data Store record snapshots, full contact snapshots.

---

## 5. Logging strategy — what is recorded

Principle (Google Cloud's split): **all writes and all security/admin events are always on; routine reads are not logged** (volume). Exceptions where a read *is* logged: exports, audit-log views/exports, backup downloads, permanent-delete confirmations, and opening a sensitive record's hidden fields (if that feature is added).

Coverage, by priority (each line names where the hook goes):

| Priority | Events | Hook point |
|---|---|---|
| P1 auth | login success/fail (unknown user → email hashed with a server-side pepper, not plain), MFA fail/enrol/disable, password change/admin reset, logout, session revoke, sign-out-everywhere, register, email verify, rate-limit refusal (aggregated: one event per key per window) | `src/auth.ts` `authorize`/`events.signOut`; `api/auth/*`; `api/account/mfa/*`; `api/account/sessions*`; `rateLimitResponse` |
| P1 admin | invitations, members PATCH (role/pages/assigned-only/hours as separate field diffs), deactivate/revive, ownership transfer, agents POST, API key create/revoke, backup download, platform config | `api/account/*`, `lib/auth/deactivate-member.ts`, `api/api-keys/*`, `api/database/backup`, `api/platform/*` |
| P1 config | WhatsApp, AI config (12 handlers), integrations, webhooks, Telegram/SMS/RCS/email, payments, Meta Ads, lead settings secret, admin-chat settings, Google config (alongside `google_activity`) | each settings route, via one `auditConfigChange(ctx, area, before, after)` helper that records field names only |
| P2 data | deletes/archives/restores, permanent contact delete, merges, bulk endpoints, imports, exports, status/assignment changes, payments, broadcast send/retry/rescue, Data Store record/table changes, templates/automations/flows/chatbots/pipelines definition changes, sheet-verification create/delete/send/revoke | domain routes; bulk = one parent event + capped children |
| P2 data (ordinary edits) | lead/contact/deal field edits | the existing PATCH routes, diffed against the row they already load |
| P3 actors | AI tools that write (`save_my_details`, `schedule_callback`, `book_appointment`, registration create/update), admin-chat confirmed actions (mirrored), automations/flows/chatbot writes, inbound webhooks that write (external webhook, Lead Ads, payments), sweeps that write, rejected webhook signatures | `lib/ai/customer-tools.ts`, `lib/ai/registration-tools.ts`, `lib/admin-chat/actions.ts`, engines, webhook routes, `server.ts` sweeps |

Added after the independent review:

| Priority | Events | Hook point |
|---|---|---|
| P1 | Google and Microsoft OAuth grant/revoke **with scopes** (Gmail, Drive); `admin/setup-flows-key`; `account/capture-config`; `account/session-settings`; admin MFA reset; webhook-secret rotation | those routes |
| P1 | Sign-in from a **new device or IP** (from the `jwt` callback / `recordDeviceSession`); socket `join_account` refusals | `src/auth.ts`, `server.ts` |
| P1 | Every **API-key and MCP call**, grouped per key per endpoint per hour (count, first/last time, IPs). MCP authenticates with `verifyApiKey` directly, so it is hooked there, not only in `requireRoleOrApiKey`. | `src/lib/auth/account.ts`, `src/app/api/mcp/route.ts` |
| P2 | **Sensitive reads, opt-in per account** ("Log who opens files and sensitive records"): `/api/files/[...path]` downloads and views of Data Store tables marked sensitive, grouped per person per item per day. For the hospital tenant this is the record an auditor asks for first. | files route, data-tables read routes |
| P2 | Public writes through `/api/v/[token]` (check details) and `/f/<token>` forms (`actor_type='webhook'`-style public actor, with the masked reference); admin-chat sessions opened/closed | those routes |
| P3 | Nightly `scripts/backup-db.sh` success/failure, migrations applied, deploys (`code-update.sh` writes one event at the end via a small CLI); a **boot event** on every start saying whether audit logging is on, so a switched-off period shows as a gap with a reason | scripts, `server.ts` |
| P1 config | Config changes store field names **and an HMAC of the before and after values** (a key kept apart from the database). A later dispute such as "was the AI prompt changed on the 3rd?" can be proven without the log ever holding the prompt. | `auditConfigChange` |

**Aggregation that does not hide attacks.** Login failures and rate-limit refusals are counted separately per source IP and per target account, every minute. Each stored event carries the count, the number of distinct targets and up to five sample target hashes. A password spray across 500 accounts therefore shows as "1 IP, 500 targets", not as one quiet row. The counters are flushed on shutdown, so a restart loses at most a minute.

**A coverage test that cannot be fooled.**
- A CI test lists every mutating route under `src/app/api` and fails when a route is neither audited nor on a reviewed "not audited, because…" list.
- It also lists the GET routes that write (the Google OAuth callback, verify-email), the socket handlers in `server.ts`, and the sweeps.
- Every entry marked "audited" must have a route test proving the event is really written. Finding `audit(` in the file is not enough.

---

## 6. Admin-only access control

- **API:** every `/api/audit/*` handler starts with `requireRole('admin')` (owner passes, by hierarchy) and filters `account_id = ctx.accountId`. **`requireRoleOrApiKey` is never used**, so API keys and MCP cannot read the log. Supervisors, agents and viewers get 403, which itself writes `access.denied`.
- **Page:** a new Settings tab `{ key: 'audit', adminOnly: true }`. It is **not** added to `PAGE_SECTIONS`, so it can never be granted to an agent through page access (the inventory shows `page_access` would otherwise make it grantable).
- **No self-hiding:** the log records admins' own actions, including their audit views (`access.audit_viewed`, once per admin per day) and exports.
- **No edit or delete, even for owners.** There is no endpoint, no UI, and the DB refuses it. Retention is a scheduled archive job (§12), not a button.
- **Platform owner:** sees only their own account's log in the UI. Cross-account review stays a server-side task (`psql`), in line with the "restore on the server, never from the app" rule.
- **Escalation paths closed:**
  - A role change is itself audited before it takes effect (same transaction).
  - It also clears that member's 60-second profile cache (`src/lib/auth/account.ts`), so a demoted admin loses access at once instead of after a minute.
  - 403s from someone probing `/api/audit` are logged and counted.
  - Page-access edits cannot reach the tab.
- **No id guessing across accounts:** `events/[id]` and every neighbour query (same request, same correlation) filter by `account_id`. Another account's id returns the same 404 as an id that does not exist.
- **The platform chain** (pre-login events with no account) is readable only by the platform owner (`isPlatformOwner`), on a separate view.

---

## 7. Backend integration

1. **Request context.** `src/proxy.ts` always **generates** `x-request-id` on the server and sets it on the request and response. A client-sent id is kept only as `meta.client_request_id`, so a caller cannot join another request's group. A small `auditContext(req, ctx)` builds `{ accountId, actor, requestId, ip: clientIp(headers), ua, source: 'web' }` from what `requireRole` already returns.
2. **Actor identity fixes** (no permission changes, only *more* information):
   - `requireRoleOrApiKey` also returns `apiKeyId`, so key actions become `actor_type='api_key'`, `on_behalf_of = key creator`.
   - The external webhook, AI tools and sweeps stop borrowing the owner's id *for the audit actor* (business columns that need a user id are left as they are).
3. **The writer.**
   - `audit(ctx, event)` validates, sanitizes, diffs and calls `audit_append` in one statement.
   - `auditInTx(tx, ctx, event)` is used inside `prisma.$transaction` only for **security-critical actions a person starts**: role/page changes, deactivation, ownership transfer, API keys, permanent delete, config secrets. If the audit write fails, the action rolls back (fail closed).
   - **Never fail closed for events from outside.** A payment webhook has already moved real money, so refusing it loses the fact. Those use best-effort plus the fallback.
   - **Keep the lock short.** Security-critical transactions take the per-account advisory lock last and keep the audit insert tiny, so they stay well inside Prisma's 5-second interactive-transaction limit and the small connection pool on the 2 GB box. A bulk action writes its child events in one `audit_append` call, not one per row.
   - **Everything else is best-effort.** A failed write is retried once, then goes to a local fallback file `logs/audit-fallback.ndjson` (0600):
     - Each line is HMAC'd with a key separate from the signing key.
     - The file is capped at 10 MB; overflow is counted and reported, not silently lost.
     - The replay job rejects lines whose HMAC fails, and writes the rest with `meta.replayed = true` and `ingested_at` set, keeping the original `occurred_at`. A forged line therefore cannot pass as a normal event.
     - `system.audit_write_failed` records how many events were delayed or dropped.
4. **Sanitizer** `src/lib/audit/sanitize.ts`: one place that merges the masking helpers already in the repo (`maskValue`, `isSensitiveColumn`, `isIdOrAccountColumn`, `maskForLog`, `maskSensitive`, `redactSensitive`).
   - **Caps:** 500 chars for `reason`, 200 for other strings, 8 KB for the whole event.
   - **Log injection:** strips CR/LF and control characters.
   - **Allow-lists:** applies per-entity field allow-lists from `src/lib/audit/fields.ts`, and **per-tool argument allow-lists for AI tools**.
   - **Pattern masking on every string field,** including `reason`, labels, `meta` and tool arguments. Aadhaar, PAN, card, bank-account, phone and email patterns are masked wherever they appear, not only in named fields.
   - **Failed-login email:** stored as an HMAC whose pepper lives outside the database and `.env` (the `crm-audit` user's key file). The privacy notice calls it *pseudonymous*, not anonymous, because email addresses can be guessed.
5. **Diffs:** routes that already load the row before updating pass `before`. Bulk endpoints record ids and counts, plus per-record diffs up to 200 rows.

---

## 8. Frontend integration

- Settings → **Audit log** tab (admin/owner), lazy-loaded like the other tabs. Built from `src/components/ui/*` per `DESIGN.md`, with sentence case and the 360px, dark-theme and reduced-motion checks, `crm-ui-review` and `playwright-cli`.
- **History** button on lead, contact and Data Store record pages, visible to admins only: the same API, filtered to that `target_type`/`target_id`.
- The browser never computes or trusts anything security-relevant. The UI only displays what `/api/audit` returns.

---

## 9. API security

- `GET /api/audit/events`:
  - **Filters:** `from`, `to` (ISO with offset), `actor`, `category`, `action`, `outcome`, `target_type`, `target_id`, `request_id`, `correlation_id`, `q` (label search).
  - **Validation:** each filter is checked against an allow-list or a format. Any column name from input goes through an allow-list, and raw SQL is used only via `Prisma.sql`.
  - **Paging:** cursor `(occurred_at, id)`, at most 100 rows a page.
- `GET /api/audit/events/[id]`: one event with its full (masked) `changes`, its request-group and its correlation-group neighbours.
- `POST /api/audit/export`:
  - **Format:** CSV or JSON, at most 50,000 rows, at most 92 days per export.
  - **Rate limit:** 3 per hour **per account**, not per admin, so several admins cannot multiply the cap. Counted in the database, not in memory, so a restart does not reset it.
  - **Values:** formula-safe via `safeText` (`src/lib/files/spreadsheet-safe.ts`).
  - **Auditing:** the export is itself audited with its filter.
  - **Download:** streamed, `Cache-Control: no-store`.
- `POST /api/audit/verify` (owner only): runs the chain and checkpoint verification for the account and returns pass/fail with the first bad id. The result is audited.
- Every response carries only masked data. There is no endpoint that changes or deletes an event.

---

## 10. Database security

Honest scope:
- **The threat this stops:** anyone using the app, including an admin or an attacker with an admin login.
- **The threat it can only detect:** someone holding the server's DB credentials or shell.

Today the app's single DB role owns its tables and runs `ALTER`/`CREATE` at runtime (in `schema-patch.ts` and about 20 other routes and lib files). So with phases 1–4 alone, whoever holds the app's DB login can:
- run `ALTER TABLE audit_events DISABLE TRIGGER`;
- `DETACH` and `DROP` a partition;
- `TRUNCATE` one partition directly.

None of these fires a row trigger. **The triggers stop mistakes and app-level misuse. They do not stop someone with the DB login.** Detection (§11) is what covers that case.

**A restore removes events.** The in-app backup dumps with `--clean --if-exists`, and restoring a dump drops and reloads `audit_events`, so every event after that backup is gone. A restore is therefore always followed by a chain check against the newest off-server checkpoint (§11). The gap is expected after a restore; anywhere else it is an alarm.

- **Phases 1–4 (works on every server):**
  - Triggers refuse UPDATE, DELETE and TRUNCATE.
  - The app has no code path that changes rows.
  - Hash chain plus off-server signed checkpoints make any change or deletion **detectable**.
- **Phase 5 (where the server allows it):**
  - Create `crm_audit_owner` (NOLOGIN) to own `audit_events`, `audit_checkpoints` and `audit_chain_heads`.
  - `REVOKE UPDATE, DELETE, TRUNCATE` from the app role.
  - Grant only `EXECUTE` on the `SECURITY DEFINER` function `audit_append` (search_path pinned) and `SELECT`.
  - The runtime schema patches never touch audit tables. Partition creation moves into `audit_append`/a `SECURITY DEFINER` helper.
  - **Preconditions per server, checked and written into this plan before phase 6:**
    - The app's DB role is **not superuser**, has **NOCREATEROLE**, and is **not a member of `crm_audit_owner`**. Check with `SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user` and `pg_auth_members`. A superuser bypasses every grant and trigger, and a CREATEROLE role can make itself a member of the owner role.
    - The roles are created from a separate admin connection that the app never holds (a one-time server step, like the Node upgrade), not from a migration the app could replay.
    - If ACSTI's app user turns out to be a superuser, the fix is a new non-superuser app role. That is its own reviewed change, not part of this plan.
    - Hospital's DB user is not superuser. There the role step may be possible from the server's admin account. Where it is not, the step is skipped and reported, and detection still holds.
- **Optional, either server:** `pgaudit.log = 'ddl, role'` only, to catch someone disabling the triggers outside the app. Needs a superuser and `shared_preload_libraries`; decided per server.

---

## 11. Immutable logging and tamper detection

- **Chain:**
  - `audit_append` first sets `id = nextval(...)`, `seq = last_seq + 1` and `occurred_at = date_trunc('milliseconds', clock_timestamp())`, then hashes.
  - `row_hash = sha256(stableJson({ every column except row_hash }))`. That covers `prev_hash`, `seq`, the actor columns, labels, reason, request and correlation ids, source, IP, user agent, changes and meta.
  - JSON with sorted keys and a fixed format keeps the field boundaries unambiguous: no plain concatenation, so `"a"+"bc"` can never equal `"ab"+"c"`.
  - The hash is computed in **one language only**: in Node, with the same `stableJson` as `admin_chat_audit` (`src/lib/admin-chat/rules.ts`). The function then stores it. SQL's `jsonb::text` formatting is never used for hashing.
  - One chain per account, walked by `seq`. The genesis `prev_hash` is `sha256('audit:' ‖ account_id)`.
  - Serialised by `pg_advisory_xact_lock(hashtext('audit:'‖account_id))` and the `audit_chain_heads` row, inside `audit_append`.
  - This is the pattern `admin_chat_audit` already runs in production, generalised and fixed for the gaps above.
- **Hourly checkpoint (CloudTrail-style):**
  - Each hour, for each chain with new events, write `(through_seq, through_hash, row_count)`.
  - **The signer is not the app.** A cron job running as a separate Unix user (`crm-audit`) reads the chain heads read-only and signs with an Ed25519 key that only that user can read. The Node process never holds the private key, so code running as the app cannot forge a checkpoint.
  - **Mandatory off-server copy.** Each hour's checkpoints are emailed to the account owner's fixed address and to the platform owner. The file copy under `/var/backups/crm/audit-checkpoints/` is a convenience only, because it sits on the same disk.
  - **The public key fingerprint is pinned off the server.** It is sent to the owner at setup and printed in the handover sheet. The fingerprint shown in the app is only for comparison, never the trust anchor.
- **What it catches:**
  - An edited row, in any column: its hash no longer matches.
  - A deleted middle row: `seq` jumps and the chain breaks.
  - A rollback, or deleted newest rows: the chain is shorter than, or different from, the newest checkpoint held **off the server**. This covers rows older than one hour. The last hour stays a known window.
  - A forged checkpoint: the signature fails, because the app cannot read the key.
  - A partition detached or dropped: its range of `seq` numbers is missing.
- **Verify job:**
  - Runs nightly, on demand, and after any restore.
  - Walks each chain incrementally by `seq`.
  - Always ends by comparing against the newest checkpoint from the off-server copy (the owner's checkpoint mail, or an uploaded checkpoint file), never only against the database's own checkpoint table, which a rollback would bring back too.
  - On failure it writes `system.chain_broken` and alerts the owner's fixed email and the platform owner. These alerts do not go through the admin-configurable staff-alert numbers, which an admin could redirect.
- **Cost:** one SHA-256 and one advisory lock per event, plus a small hourly cron. At CRM volumes (thousands of events a day per account) this is negligible.

---

## 12. Data retention

- **Online:** 13 months (DPDP Rules 2025 Rule 6(1)(e): at least one year; GitHub and Stripe keep 180 days; SOC/ISO practice is about 1 year hot).
- **Archive:** each month after 13, a scheduled job **outside the app**: a server script run by cron as the audit owner, never app code, so the app role does not need the right to drop partitions. It:
  1. Takes a `pg_dump` of that month's partitions into `/var/backups/crm/audit-archive/YYYY-MM.dump` (0600), and verifies it with `pg_restore -l`.
  2. Records a final checkpoint.
  3. `DETACH PARTITION … CONCURRENTLY`.
  4. Drops the detached partition only after the dump is verified.
  
  There is no row `DELETE`, which keeps to the repo's data-safety rule. The job is reviewed like a migration and **off by default** until the owner sets a retention period.
- **Legal hold:** `AUDIT_RETENTION_HOLD=1` stops the archive job, for disputes or investigations.
- **Erasure (DPDP s.8(7) and s.12, GDPR 17(3)):**
  - Personal values in audit rows are already masked.
  - Erasing a contact deletes or anonymises the source record.
  - The audit row (ids plus masked diff) stays for the legal retention period, so the chain stays valid.
  - This is stated in the privacy notice.
- **Account deletion:** audit rows have no FK to `accounts`, so they survive, unlike `admin_chat_audit` today. They are archived with the same job.

---

## 13. Backup and recovery

- The existing nightly `scripts/backup-db.sh` dump includes the audit tables. Checkpoint files and archives live under `/var/backups/crm/`, which is already backed up.
- **Off-server copies** (the brief's AU-9(2) point; today backups sit on the same disk):
  - The separate **encrypted** off-site backup work (bonus check B3 from the security review) carries the audit archives too.
  - Backups must be encrypted, because the audit tables hold IP addresses for every account.
  - The emailed hourly checkpoints are the off-server trust anchor from phase 1 onward; they do not wait for B3.
- **Restore test:** restore a dump into a new database (never over production), run `verifyAuditChain` against the restored copy plus the off-server checkpoints, and expect pass.

---

## 14. Audit log dashboard

Settings → Audit log (admin/owner):

- **Header:** totals for the selected period (events, failed logins, denied, config changes, exports), the integrity status ("Verified to #48,211 · today 03:00" or a red banner) and the public key fingerprint.
- **Filter bar:**
  - Date range in the business time zone, sent as ISO with offset.
  - Who (member picker plus "AI agent", "API key", "System", "Webhook").
  - Category chips; action; outcome (success, denied, failed).
  - Record (type plus id or reference); request id.
  - Free text on labels, debounced with a `loadSeq` guard.
  - **Every filter lives in the URL**, so a link to "what happened to lead X yesterday" can be shared.
- **List:**
  - Rows show time (business zone, with UTC on hover), actor with a type badge, action in plain words ("changed the role of Anu from agent to supervisor"), target, outcome and source.
  - Cursor paging with "Load more". Virtualised when the list grows long.
- **Detail drawer:**
  - A before/after table for each changed field (masked).
  - Context: IP, device, request id, source.
  - The agent block: agent kind, model, tool, approval, the human it acted for.
  - "Same request" and "Same operation" groups (via `correlation_id`).
- **Record history:** the same drawer opened from a lead, contact or record page.
- **Export:** CSV or JSON with the current filters, within the limits in §9.
- **States:** empty ("No events in this period"), loading skeleton, error text with retry. Nothing here can edit or delete.

---

## 15. Search and filtering

- **Indexes:** every filter is served by one of the §3 composite indexes, always scoped by `account_id` first. Free-text search uses `ILIKE` on `target_label`/`actor_label`, but only within a mandatory date range of 92 days or less, so it never scans the whole table.
- **Default view:** the last 7 days.
- **Counts:** "about N" from paging, never `count(*)` over months.

---

## 16. Export security

- **Who:** admin and owner only.
- **Limits:**
  - Rate limit of 3 per hour; 92 days and 50,000 rows at most.
  - Masked values only; CSV cells formula-safe (`safeText`).
- **Integrity:**
  - The export includes its own filter and the chain head it was cut at (`through_id`, `through_hash`), so a recipient can check it against a checkpoint.
  - Every export is an audit event (`access.audit_exported`, with row count and filter).

---

## 17. Performance and scalability

- **Size:** about 1 KB per event. At around 50,000 events per account per month that is about 600 MB a year online, well under the VPS disk.
- **Writes:** one insert, one hash and one lock per event, with only security-critical events inside the business transaction. Bulk operations write one parent event plus at most 200 children.
- **Memory and maintenance:**
  - BRIN plus three B-trees per monthly partition, with no JSONB GIN, keep RAM low on the 2 GB ACSTI box.
  - Monthly partitions keep vacuum cheap and make retention a detach rather than a delete.
- **Rate-limit floods:** `auth.rate_limited`, `auth.login_fail` and `access.denied` are aggregated per IP and per target each minute (§5), so an attack cannot fill the disk through the log and is still visible.

---

## 18. Agent activity tracking

- **Every non-human write** carries:
  - `actor_type`: `agent`, `system`, `webhook` or `api_key`.
  - `actor_id`: the agent kind (`ai_reply`, `admin_chat`, `chatbot`, `flow`, `automation`, `registration`) or the job/provider name.
  - `on_behalf_of`: the human principal. That is the staff member who triggered it (admin chat, an AI Draft press), or null when the trigger is a customer message. The customer is recorded as `meta.contact_id` with a masked label.
  - `meta`: `{ tool, model, flow_or_bot_id, version, conversation_id, message_id, approval_id, approved_by, confidence }`.
  - `correlation_id`: one id per AI turn or automation run, so every write from one turn groups together.
- **Admin-chat confirmed actions:** keep writing `admin_chat_audit` (it is wired and tested) **and** mirror into `audit_events`, so the dashboard shows one timeline.
- **The agent cannot reach the log:** no AI tool reads or writes it, and tool arguments are masked before they are stored. This is OWASP Agentic T8: the agent cannot alter its own trail.
- **The authority is visible:** a webhook-created lead now shows `actor=webhook:external`, not the owner's name. Agents are always shown with their own badge in the UI.

---

## 19. Testing strategy (test first, per AGENTS.md)

- **Unit (vitest, next to the code):**
  - Sanitizer: none of the never-store values survive (passwords, tokens, an Aadhaar number, a message body) and CR/LF are stripped.
  - Diff: only allow-listed changed fields are kept.
  - The action registry.
  - Hash function: stable JSON, and the same input gives the same hash.
  - Verify: an edited row, a deleted middle row, a truncated tail and a forged checkpoint are each detected.
- **Route tests:**
  - Each P1 route writes exactly the expected event (actor, action, outcome, masked changes).
  - Security-critical routes roll back when the audit write fails.
  - `/api/audit/*` returns 403 for supervisor, agent, viewer, API key and MCP.
  - Another account's events are never returned.
- **Coverage guard:** a test enumerates the mutating handlers under `src/app/api` and fails if one is neither audited nor on the reviewed exemption list.
- **DB tests on `crm_test_scratch`:**
  - The migration runs twice.
  - UPDATE, DELETE and TRUNCATE on `audit_events` raise.
  - 50 concurrent inserts for one account produce one unbroken chain.
  - Partition creation and detach work.
- **Playwright:** the dashboard at 360px and in dark theme; filters survive a reload; the export downloads; non-admins cannot open the tab.
- **Independent review:** a separate agent reviews each phase's diff for security, like this plan's own review (§21).

---

## 20. Deployment strategy

Each phase ships on its own, behind `AUDIT_LOG=on` (default off until phase 1 is verified on ACSTI). Migrations are idempotent, dry-run on `crm_prod_copy`, and applied by `docs/deploy/code-update.sh`, which takes a verified backup first.

**Before phase 1**, on each server (read-only checks, results written into this plan):
- PostgreSQL version must be 13 or later.
- The app role's `rolsuper`/`rolcreaterole`.
- Whether a separate `crm-audit` Unix user can be created.
- The owner's fixed email for checkpoint mail.

**Server check results (2026-11-02, read-only):**

| | ACSTI | Hospital |
|---|---|---|
| PostgreSQL | 16.15 ✅ | 16.15 ✅ |
| App DB role | `acsti_data`: not superuser, no CREATEROLE, no CREATEDB, no BYPASSRLS, member of no role ✅ | `db_spfort`: same ✅ |
| Table ownership | the app role owns all 114 public tables | the app role owns all 113 |
| pgcrypto / pgaudit | pgcrypto 1.3 installed / pgaudit **not available** | same |
| `shared_preload_libraries` | not readable by the app role (expected) | same |
| DB size | 34 MB | 17 MB |
| `admin_chat_audit` | 46 rows | 0 rows |
| DB host | localhost | localhost |
| Linux user | `acsti`, in `sudo` (with password) | `spfort`, in `sudo` (with password) |
| crontab | yes | yes |
| Disk free | 29 GB of 48 GB | 91 GB of 96 GB |

**What this decides:**
- **Phase 6's role split is possible on both servers.** The app roles are not superuser and cannot create roles, which is exactly the precondition in §10. The `crm_audit_owner` role and its grants are created once by a person running `sudo -u postgres psql` (a separate admin connection the app never holds).
- **The `crm-audit` Unix user and its hourly cron are possible on both,** with the server user's sudo password, as a one-time step.
- **pgaudit is not installed.** The optional "catch DDL outside the app" layer would need the `postgresql-16-pgaudit` package plus a Postgres restart. It stays optional and is not part of phases 1–5.
- **Size is no concern:** about 600 MB a year of audit data against 29 GB and 91 GB free.
- **Still needed from the owner:** the fixed email address for checkpoint mail, for each server.

| Phase | Content | Migrations |
|---|---|---|
| 1 Foundation | `audit_events` (partitioned; `seq`, `ingested_at`; triggers on every partition), `audit_chain_heads`, `audit_checkpoints`; platform chain; `src/lib/audit/*` (writer, sanitizer, registry, diff, chain, verify); partitions created in `audit_append` plus a three-months-ahead job and a default-partition alarm; server-generated request id; `apiKeyId` in `requireRoleOrApiKey` and the MCP path; hourly signer cron as `crm-audit`, with checkpoint email | 157 |
| 2 Security & admin (P1) | auth, members, invitations, API keys, backup download, config changes, access denied, rate limits; security-critical writes in-transaction | — |
| 3 Data (P2) | deletes/merges/bulk/imports/exports/payments/broadcasts/Data Store/definitions/sheet verification; ordinary lead/contact edits; coverage-guard test | — |
| 4 Actors (P3) | AI tools, registration, admin-chat mirror, engines, webhooks, sweeps; actor fixes for external webhook and owner fallbacks | — |
| 5 Dashboard | Settings → Audit log, record History, export, verify button | — |
| 6 Integrity hardening | Nightly verify against the off-server checkpoint plus owner/platform alert; `crm_audit_owner` role split where the preconditions in §10 hold; retention archive script run by cron as the audit owner (off until configured); sensitive-read logging opt-in | 158 |

Later and optional:
- A narrow trigger on permission and payment tables (actor via `set_config('app.user_id', …, true)`) as a second net.
- `pgaudit` with `ddl, role` where a superuser exists.
- Fixes the inventory surfaced but that are outside this plan's scope, each needing its own approval:
  - API key revoke is a hard delete and invitations are hard-deleted. Make them soft.
  - `contact_merges` keeps full PII snapshots.

Rollback: turning `AUDIT_LOG` off stops new events. Tables and rows stay, and are never dropped by a rollback.

---

## 20a. Off-server locker, alert email, and what to do after a hack (decided 2026-11-02)

**Layered against how much an attacker gets:**

| Attacker has | Protection | Result |
|---|---|---|
| An admin login | No edit or delete path in the app | Cannot remove events |
| The app's DB login | Role split (both servers qualify: the app roles are not superuser and have NOCREATEROLE, see §20). **Moved forward to the first deploy**, run once per server by a person with `sudo -u postgres psql` | Cannot remove events |
| Root or the Postgres superuser | The off-server WORM copy below | Local rows can go, but the copy survives and the external check alarms |
| The hosting account (VPS deleted) | The copy lives at a different provider | Evidence survives |

**Off-server WORM copy: Cloudflare R2 with Bucket Lock.**
- One bucket per server, with a lock rule retaining objects for 400 days. Free tier: 10 GB-month, 1M Class A ops and 10M Class B ops a month, free egress. Our volume is about 0.6 GB a year and about 3,000 writes a month.
- The server holds an R2 token with **object write only on that bucket**, never admin. It cannot remove the lock rule, and locked objects cannot be deleted or overwritten.
- Only the Cloudflare account owner can change the lock, so that account must have 2-step login.
- Every 15 minutes the `crm-audit` cron uploads the new events since the last upload as `audit/<account>/<yyyy>/<mm>/<seq-from>-<seq-to>.ndjson`, plus the signed checkpoint. These are masked rows exactly as stored.
- R2 credentials live only in the `crm-audit` user's 0400 file, never in the app's `.env` or database.

**External verifier.**
- A scheduled job **off the server** (GitHub Actions, daily) reads the R2 copy with a read-only token.
- It compares the copy against the server's `/api/audit/head` endpoint, which returns per-account `last_seq`, `last_hash` and a signature, behind a separate bearer secret held only by that job.
- On any mismatch or missing upload it emails the owners. A hacked server cannot silence it.

**Alert and summary email.**
- Sent by `crm-audit`, never by the app. The app's email settings are admin-editable and live in the database.
- **From:** the company's Zoho Mail Lite domain (scycon.com), over `smtp.zoho.in:465`, using an app password kept in `crm-audit`'s 0400 file. There is currently one licence (`info@scycon.com`); a dedicated `audit-alerts@scycon.com` needs a second licence. Until then `info@` with an app password works.
- **Fallback:** a dedicated Gmail with an app password, over `smtp.gmail.com:465`.
- **To:** each business owner's email plus the platform owner's. Set by us at setup, not editable in the app.
- **Volume:** one "all good" daily summary that carries the day's checkpoints, and an immediate 🔴 alarm on any failure.
- **Code:** add the `nodemailer` package for SMTP (well-known, MIT), used only by the `crm-audit` scripts, never on the request path.

**If a server is hacked:**
1. Take a provider disk snapshot (evidence), then cut the network.
2. Rotate every secret: DB password, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`-sealed tokens re-entered, WhatsApp/Meta/Google tokens, API keys, R2 write token.
3. Reconstruct what happened from the R2 copy.
4. Restore onto a new server from a backup made before the breach.
5. If personal data was affected, notify the Data Protection Board and the affected people as the DPDP Rules require. This applies especially to the hospital tenant; take legal advice.

## 21. Independent security review

A separate reviewer agent read the first draft and the code it relies on, and attacked it. Its verdict on the draft was "sound in direction, not ready as written". Every finding is now addressed in the text above:

| # | Finding | Severity | Where it is fixed |
|---|---|---|---|
| C1 | The app's DB role owns tables and runs DDL, so it can disable triggers, detach or drop partitions, or truncate a partition. A restore of a `--clean` dump drops the log. The retention job in app code needs the right to drop. | Critical | §3 (triggers on every partition), §10 (honest scope, restore note, per-server role preconditions), §12 (retention outside the app) |
| C2 | The signing key was readable by the app. The public key, the checkpoint files and the "last verified" state lived on the same server. Daily checkpoints left a 24-hour tail open. | Critical | §11 (separate `crm-audit` signer, hourly, mandatory email, off-server fingerprint, verifier compares against the off-server copy) |
| H1 | Hash left out columns, had ambiguous joins, microsecond vs millisecond timestamps, two JSON formats, and `bigserial` gaps. | High | §3, §11 (id, seq and ms time set before hashing; `stableJson` of all columns, in Node only; walk by `seq`; Postgres 13+) |
| H2 | Pre-login events have no account. | High | §3, §6 (platform chain, platform owner only) |
| H3 | Lazy `onceSchemaPatch` misses partitions, and the default partition then blocks them for good. | High | §3 (create in `audit_append`, three months ahead, default-partition alarm) |
| H4 | The fallback file was an injection path, with no size cap. | High | §7 (HMAC lines, replayed flag, `ingested_at`, 10 MB cap) |
| H5 | Sensitive reads (patient files) and API-key/MCP use were not recorded. | High | §5 (key/MCP calls grouped, opt-in sensitive reads) |
| M1 | Aggregation hid password sprays. | Medium | §5, §17 (per IP and per target, distinct-target count, samples) |
| M2 | Fail-closed on payment webhooks; lock held under Prisma's timeout. | Medium | §7 |
| M3 | Client-chosen request id; ids guessable across accounts. | Medium | §6, §7 |
| M4 | Tamper alerts went to admin-configurable numbers. | Medium | §11 |
| M5 | Missing events: OAuth scopes, flows key, capture/session settings, new device, socket refusals, backups/deploys, public form writes, admin-chat sessions; no value proof for config. | Medium | §5 |
| M6 | The coverage test could be passed without auditing. | Medium | §5, §19 |
| M7 | Personal data could slip into free text and tool arguments; weak email hashing; unencrypted backups. | Medium | §7, §13 |
| L1–L4 | Profile cache lag after a demotion; per-admin export limit; silent gaps when switched off; who reads a deleted account's rows. | Low | §6, §9, §5 (boot event), §12 (server-side only, platform owner) |

What the reviewer found right in the draft:
- App-level events where the actor is known.
- AI, API keys and webhooks as their own actors.
- Reads enforced in the API, not by the browser tab.
- The tab kept out of page access.
- Reuse of the production hash-chain pattern.
- Honesty about detect-versus-prevent.
- Detach-and-archive retention with no row `DELETE`.
- An explicit never-store list.

**Readiness:** with these changes the plan is ready to build, starting with the "before phase 1" server checks in §20. Each phase is reviewed again on its diff before it ships.
