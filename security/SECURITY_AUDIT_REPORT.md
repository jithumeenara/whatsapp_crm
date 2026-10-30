# Security audit report — WhatsApp CRM (October 2026)

| | |
|---|---|
| Application | Self-hosted WhatsApp CRM: Next.js 16.4.3 (App Router), React 19.2.4, NextAuth v5 beta.32 (JWT sessions), Prisma 5.22 + PostgreSQL, Socket.io 4.8 on a custom `server.ts` |
| Deployment | One business per Ubuntu VPS today; several businesses per server is planned |
| Repository | `/home/user/whatsapp_crm` (app in `Whatsapp-CRM/`), branch `security/audit-2026-10` |
| Baseline | git tag `pre-security-audit` |
| Final code state | commit `f9b10c4` |
| Report date | 2026-10-30 |
| Related documents | [README.md](README.md) (index) · [VULNERABILITY_REGISTER.md](VULNERABILITY_REGISTER.md) · [SECURITY_FIXES.md](SECURITY_FIXES.md) · [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md) · [INFRASTRUCTURE_SECURITY.md](INFRASTRUCTURE_SECURITY.md) · [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md) · [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md) · [SECURITY_TEST_RESULTS.md](SECURITY_TEST_RESULTS.md) · [PRODUCTION_SECURITY_CHECKLIST.md](PRODUCTION_SECURITY_CHECKLIST.md) |

Nothing has been pushed or deployed. Pushing and deploying wait for the owner's approval.

---

## 1. Executive summary

**In plain words.** Before this audit the CRM kept customers' businesses apart reasonably well, but *inside* a business almost anyone with a login could do far more than their role allowed. A read-only "viewer" could create an API key with supervisor powers, replace the business's WhatsApp, email or SMS connection with their own, create outgoing webhooks that copy data out, and edit or switch on chatbots and automations. Several features that fetch a web address chosen by a user could be pointed at the server itself or at cloud credentials (server-side request forgery). An invitation link could create unlimited new business *owners* on a server that was supposed to be closed to sign-ups. The software also carried 24 known-vulnerable package versions, three of them critical. Development and staging copies could message real customers.

**What changed.** All of those problems are fixed, each one with a test that failed against the old code and now passes. An independent reviewer, who wrote none of the fixes, checked the work in six passes (rounds 1, 4, 5 and 6, a final check after round 7, and a final check of the lead's last fixes). The reviewer found more problems along the way, including one HIGH (any member could replace the email/SMS/RCS provider credentials) and gaps in the staging guard. It also found two problems that the fixes themselves had introduced. All of those are now fixed too. Third-party integration passwords and API keys are now encrypted in the database. The full test suite grew from 1,980 to 2,985 passing tests. The known-vulnerable packages are down from 24 advisories to 3 low-severity ones in a developer tool. A browser test of the production build passes 54 of 54 checks, against 50 of 54 on the original code.

**What is left.** All six workstreams are FIXED. None of the 38 findings that are not FIXED is critical or high. Six are medium, all PARTIALLY FIXED, and they need mostly configuration or follow-up hardening (see §9); the rest are low or informational. Every server-side item (Nginx, firewall, SSH, PostgreSQL roles, backups, Node version) is a **manual action**, because the audit had no server access. Three database migrations have been run twice against a throwaway PostgreSQL 16 database but have **not** yet been dry-run on a copy of production data (`crm_prod_copy`). The browser popups (Embedded Signup, Google connect, Razorpay) have not been clicked through since the COOP header change. The GitHub repository is **public**. We recommend making it private before anything else.

### Overall assessment

| | Before (`pre-security-audit`) | After (`f9b10c4`) |
|---|---|---|
| Overall rating | **High risk.** Viewer-to-owner-equivalent escalation inside a business; full-read SSRF to cloud metadata; owner creation through invitation links; critical dependency advisories (including Next.js RCE-class) | **Moderate-to-low residual risk**, conditional on the manual server hardening and the pre-deploy checklist being completed |
| Unique findings | 119 (1 critical, 18 high, 37 medium, 46 low, 17 info) | 81 FIXED (42 V2 + 39 V1, see §4) · 15 PARTIALLY FIXED · 21 UNRESOLVED · 2 NOT APPLICABLE |
| Critical / high open | 1 critical (dependencies) + 18 high | **0 critical, 0 high**; 6 medium PARTIALLY FIXED (V-013, V-025, V-036, V-046, V-071, V-072) |
| Tenant isolation (cross-business) | Several cross-tenant paths (file traversal, send paths reading other businesses' files, forged FB/IG webhooks, Google token cache, Flows data-exchange, pipeline stage IDOR, related-id references) | No cross-tenant path found in the reviewer's sample and Playwright tests |

---

## 2. Architecture and attack-surface map

### Components

```
Internet ──TLS──> Nginx (VPS, manual config) ──> Node server.ts on 127.0.0.1:3000
                                                   ├─ Next.js 16 App Router (pages + 335 API route handlers)
                                                   ├─ src/proxy.ts  (middleware: public allow-list, idle timeout, rate limits, CSP nonce)
                                                   ├─ Socket.io (account namespace, ticket auth; webchat namespace)
                                                   ├─ in-process jobs: broadcasts, automations, flows, sweeps
                                                   └─ Prisma ──> PostgreSQL (localhost)    uploads/ on local disk
Outbound: Meta Graph (WhatsApp/IG/FB/Ads/Flows), Google, Microsoft Graph, SendGrid, MSG91, TextBee,
          Twilio, Telegram, Razorpay, PhonePe, AI providers, FCM/web-push, tenant-configured URLs
```

Multi-tenancy is enforced in application queries only: 86 of 107 Prisma models carry `account_id`; there is no row-level security on the app's connection (A4).

### API route handlers by area (335 `route.ts` files under `src/app/api`)

| Area (owning agent) | Route files | Main groups |
|---|---|---|
| Core business (A3) | 159 | contacts 22, data-tables 21, broadcasts 15, leads 11, automations 7, conversations 7, integrations 5, file-manager 5, catalog 5, reports 4, pipelines 4, messages 4, … |
| Messaging, integrations, payments (A8) | 90 | whatsapp 24, google 15, meta-ads 7, email 7, webchat 5, instagram 4, facebook 4, sms 3, telegram 3, razorpay 3, calls 3, website-chat 3, rcs 2, webhooks 2, social 2, payments 1, meta 1, call-config 1 |
| AI, Flows, chatbot, voice, MCP (A9) | 44 | flows 16, ai-config 10, admin-chat 5, ai-knowledge 4, chatbot 4, voice 2, mcp 1, ai-usage 1, ai-quality 1 |
| Auth and account (A2) | 37 | account 20, auth 6, invitations 2, api-keys 2, platform 2, me/profile/profiles/admin/out-of-scope 1 each |
| Next.js runtime (A1) | 5 | csp-report, realtime/ticket, heartbeat, presence/leave, version |

(Counts are from the file system at `f9b10c4`. A8's own report said 87 for its area.)

### Entry points that do not use a staff session

| Kind | Endpoints | Authentication |
|---|---|---|
| Provider webhooks | WhatsApp, Instagram, Facebook, Telegram, SMS (`sms/webhook/[secret]`), email (SendGrid inbound `[secret]`), RCS (Twilio), Microsoft Graph notify, PhonePe, Razorpay payment links, Google Sheets ping, WhatsApp payments | HMAC over the raw body (Meta, Razorpay, Twilio, TextBee); per-bot secret header (Telegram); URL secret (SMS/email); clientState (MS Graph); per-link secret (Sheets) |
| Meta Flows | `/api/flows/[id]/webhook`, `/api/flows/data-exchange/[flowId]/[screenId]` | RSA-OAEP + AES-GCM, and now `X-Hub-Signature-256` (rollout switch `META_FLOWS_SIGNATURE`) |
| Crons | `automations/cron`, `chatbot/cron`, `flows/cron`, `scheduled-messages/cron`, `offers/cron` | Shared secret, timing-safe, fail closed; Nginx example restricts them to localhost |
| Public customer-facing | webchat (config/frame/session/messages/handoff), public forms `forms/[token]` (+ logo), read links `v/[token]`, Meta pixel `meta-ads/track`, `external/webhook` (`?secret=`) | Tokens / HMAC links / URL secret; per-IP rate limits |
| Machine-to-machine | `/api/mcp`, routes accepting `Bearer wcrm_…` API keys | Owner-minted API key (supervisor rank, creator-bound) |
| Voice agent | `/api/voice/context`, `/api/voice/transcript` | `VOICE_AGENT_SECRET`, timing-safe |
| Other | `/api/csp-report`, `file-manager/[id]/scan-result` (HMAC), `push/vapid`, auth routes (sign-in, register, MFA, invitation peek/redeem) | Rate-limited; register is closed unless `NEXT_PUBLIC_ALLOW_SIGNUP=true` or a valid invitation is claimed |
| Real-time | Socket.io `/socket.io/` (account namespace: signed 60 s ticket; webchat namespace), `/api/ai/live-voice` WebSocket | Ticket from a session; connections now expire after ~15 min and are cut on sign-out/removal |

Full per-route detail: [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md).

---

## 3. Method

- **Nine specialist agents with exclusive file ownership** (A1 Next.js architecture, A2 authentication and authorization, A3 core API, A4 database, A5 supply chain, A6 infrastructure, A7 frontend, A8 messaging integrations and webhooks, A9 AI, Flows and MCP). An agent could edit only the files it owned. A problem found in someone else's file was handed off with file:line and a proposed fix. Integration fixers (R3, then R4, R5, R6 and R7) handled cross-ownership handoffs, review findings and the rest of workstream D. The lead implemented V-060 (integration secrets at rest).
- **Tests first.** The repository's own rule (AGENTS.md: "fixed" means a test went red → green) was applied. For each CONFIRMED finding, the regression test was run against the unchanged code and had to fail *for the bug's reason* (for example `expected 201 to be 403`) before the fix was written. The few exceptions, where the test was written after the fix, are marked in the findings. The reviewer later mutation-checked four of them against the old code.
- **Independent reviewer, six passes** (findings file `A7-REVIEW.md`; the reviewer states it wrote none of the fixes):
  - Round 1, on `89b293a`: read every claim from A1–A9 and R3, checked each against the code, and wrote 6 exploit-test files (140 tests, 9 `it.fails` documenting confirmed gaps N1–N7).
  - Round 4, on `403f950`: re-reviewed the fixes, mutation-checked the tests written after the fix, and found 2 regressions introduced by the fixes (R4a, R4b).
  - Round 5, on `a7a9267`: final verdicts, plus 2 more exploit-test files.
  - Round 6 check, on `fa7fc4a`: workstream D still PARTIALLY FIXED; found R6a (provider write APIs, MEDIUM) and R6b (flow GET steps, LOW), documented by 9 `it.fails`.
  - Final check (round 7 + V-060), on `3f24396`: workstream D **FIXED** (every outbound provider host inventoried and covered; R6a and R6b closed; production unchanged). V-060 FIXED for the at-rest exposure, with 3 LOW robustness gaps (V060-a/b/c) that were fixed in `75d27a3`; the reviewer's 3 `it.fails` were flipped and seen red → green.
  - Final check (lead fixes): confirmed V060-a/b/c fixed and the lead's dev-guard log redaction (V-119) FIXED; grep of every log line found no credential or full provider URL logged; one INFO PII log line remains (`flows/meta-send.ts:542`, merged into V-057).
- **Playwright end-to-end tests** on a throwaway local PostgreSQL 16 with fake data: 2 businesses, every role. The original code was run on its dev server; the fixed code as a production build.
- **Whole-tree checks:** `npm audit`, ESLint, `tsc --noEmit`, the full vitest suite, `next build`, gitleaks plus a regex secret sweep (A5), raw-SQL census (A4: 44 `Unsafe`/`Prisma.raw` sites and 125 tagged sites), and scans of all 313 mutating handlers for missing role checks (reviewer).
- **Not done:** no OWASP ZAP or other DAST, no calls to real Meta/WhatsApp/Instagram/Razorpay/Google services, and no server access. See [SECURITY_TEST_RESULTS.md §8](SECURITY_TEST_RESULTS.md#8-what-was-not-tested-and-why).

### Commits (`git log --oneline pre-security-audit..HEAD`)

| Commit | Content | Files |
|---|---|---|
| `f6dc659` | security(deps): patch critical/high advisories in next, dompurify, undici, axios and others | 2 |
| `89b293a` | security: multi-agent audit remediation (pre-review checkpoint) | 288 |
| `403f950` | security: close holes found by independent review (round 4) | 38 |
| `a7a9267` | security: fix regressions found in round-4 review (round 5) | 21 |
| `fa7fc4a` | security: dev/preview servers make no outbound side effects (round 6) | 13 |
| `3f24396` | security: no provider writes from non-production; integration secrets at rest (round 7) | 14 |
| `75d27a3` | security: harden integration secret storage (review of round 7) | 4 |
| `f9b10c4` | security: stopped sends log provider and host only | 3 |

---

## 4. Vulnerability counts

### How duplicates were removed

The agents and the reviewer reported **155 finding IDs** (A1 17, A2 22, A3 27, A4 12, A5 10, A6 12, A7 7, A8 20, A9 11; reviewer N1–N8, R4a, R4b, R6a, R6b, V060-a/b/c and one INFO log note; one from the lead's final diff review). Agents deliberately cross-reported problems in each other's files, so many IDs describe the same bug. IDs were merged when they share **the same root cause in the same code path**. Examples: A4-05 = A3-07 (pipeline stage IDOR); A6-01 = A1-15 (weak secrets accepted at start-up); A6-02 = A1-14 (dev mode when NODE_ENV is unset); A3-05 + A3-22 + A8-04 + N5 (send paths reading other tenants' files); A3-23 + N4 + R4a + R4b (legacy files). The umbrella A2-09 ("viewer writes on many routes") was split into its concrete rows. All 24 dependency advisories count as one CRITICAL row. Each merged row takes the **highest** severity any reporter gave it. The result is **119 unique findings**. The full mapping is in the *Source IDs* column of [VULNERABILITY_REGISTER.md](VULNERABILITY_REGISTER.md).

### By severity and status

| Severity | Unique | FIXED | PARTIALLY FIXED | UNRESOLVED | NOT APPLICABLE |
|---|---|---|---|---|---|
| CRITICAL | 1 | 1 | 0 | 0 | 0 |
| HIGH | 18 | 18 | 0 | 0 | 0 |
| MEDIUM | 37 | 31 | 6 | 0 | 0 |
| LOW | 46 | 26 | 7 | 13 | 0 |
| INFO | 17 | 5 | 2 | 8 | 2 |
| **Total** | **119** | **81** | **15** | **21** | **2** |

### Confirmed vs potential vs hardening

| Severity | CONFIRMED | POTENTIAL | HARDENING |
|---|---|---|---|
| CRITICAL | 1 | 0 | 0 |
| HIGH | 18 | 0 | 0 |
| MEDIUM | 30 | 5 | 2 |
| LOW | 21 | 1 | 24 |
| INFO | 3 | 1 | 13 |
| **Total** | **73** | **7** | **39** |

"FIXED" is used only when the fix was independently verified. **Of the 81 FIXED rows, 42 are V2**: named in the reviewer's verdict tables, or covered by a reviewer exploit test. **The other 39 are V1**: verified by the reviewer's round-1 code read of every claim plus the implementer's red→green regression test, without a dedicated reviewer test. The register shows which is which.

---

## 5. Workstreams A–F

These are the six remediation workstreams the lead set, with the reviewer's final verdicts (round 5; workstream D and V-060 from the final check after round 7):

| WS | Scope | Status | Evidence / remaining |
|---|---|---|---|
| **A** | Vulnerable dependencies and Next.js exposure | **FIXED** | 24 advisories → 3 low (deepmerge through the `shadcn` CLI; no upstream fix). `next/og`, `"use cache"`, server actions and the image optimiser are **NOT APPLICABLE**: not used, and images are `unoptimized`. |
| **B** | Invitation and sign-up: owner creation, invitation reuse and races, closed sign-up, email binding | **FIXED** | Email binding is weak by design, because sign-up does not verify the email (V-118, UNRESOLVED). |
| **C** | API keys: who may mint them, creator binding, expiry, revocation, legacy keys, attribution | **FIXED** | Migrations 152 and 154 were run twice on a throwaway database. The **dry-run on `crm_prod_copy` is still pending**. Owners must re-mint keys. |
| **D** | Non-production servers sending to real customers or causing third-party side effects | **FIXED** | Reviewer final check (round 7). Blocked on development/preview/staging: customer messages on every channel (including Instagram DMs, Twilio, web-push and FCM), tenant webhooks, automation webhooks, flow/chatbot HTTP steps (every verb), call-forward, all Meta Graph writes, and every other provider's write API (Telegram by method name, Microsoft Graph, TextBee/MSG91/Twilio/SendGrid, Google writes and token revoke, Razorpay orders/links/refunds, PhonePe). OAuth/token reads stay open. `DEV_ALLOWED_HOSTS` is an exact-match opt-in that never unlocks messages. Production behaviour is unchanged (tested). |
| **E** | SSRF: central `safeFetch` and every user-URL call site | **FIXED** | 84 reviewer bypass tests, plus the round-5 redirect and upgrade tests. |
| **F** | Files (`/api/files` traversal, send paths, legacy files, uploads) and role checks on mutating routes | **FIXED** | Legacy files follow the owner's single-business rule. N1 (channel credentials) and N6 (ai-suggest) are fixed. |

Cross-cutting checks the reviewer marked FIXED or found no issue in: tenant isolation (sampled), the proxy public-path and Bearer bypass, sessions (revocation, idle, absolute cap), sealed FB/IG tokens. The start-up secret check is "not a vulnerability: deploy note". The unenforced `restrict_to_assigned` setting is "NOT APPLICABLE: product question, fails safe".

---

## 6. Files modified

`git diff --stat pre-security-audit..HEAD`: **327 files changed, 15,297 insertions, 2,934 deletions.**

| Change type | Count | Detail |
|---|---|---|
| Added | 138 | 107 test files + 1 test helper; 21 new source modules; 3 migrations (152, 153, 154); 1 script (`scripts/backfill-legacy-file-owner.ts`); 3 deploy docs; CI workflow and Dependabot config at the repo root |
| Modified | 178 | 110 API route handlers, 42 `src/lib` files, 12 components, 5 other `src` files (`auth.ts`, `proxy.ts`, signup and forgot-password pages, `use-auth.tsx`), `server.ts`, `next.config.ts`, `prisma/schema.prisma`, `scripts/backup-db.sh`, `scripts/pg-env.sh`, `.env.local.example`, `.npmrc`, `package.json`, `package-lock.json` |
| Renamed | 9 | `Whatsapp-CRM/.github/*` → `.github/*` (CODEOWNERS, SECURITY.md, templates and others) |
| Deleted | 2 | the nested `Whatsapp-CRM/.github/workflows/ci.yml` and `dependabot.yml` (rewritten at the repo root) |

All reviewer test files are committed by `f9b10c4`. Round 6 added `jsdom` 29.1.1 as an explicit devDependency (see [SECURITY_TEST_RESULTS.md](SECURITY_TEST_RESULTS.md)).

**Key new security modules**

| File | Purpose |
|---|---|
| `src/lib/net/safe-fetch.ts` | Central SSRF-safe HTTP client: connect-time DNS check, redirect re-checks, size and time caps |
| `src/lib/security/startup-check.ts` | Refuses to start in production with weak secrets; decides when dev mode runs |
| `src/lib/security/session-revoked.ts`, `src/lib/auth/session-guard.ts` | Session revocation and the absolute cap, judged from sign-in time |
| `src/lib/auth/claim-invitation.ts`, `src/lib/auth/device-session.ts` | Atomic invitation claim; device sessions are never revived |
| `src/lib/realtime-server.ts` | Socket lifetime and cut-off on sign-out |
| `src/lib/integration-secrets.ts` | Seals and opens `integrations.auth_config` (V-060) |
| `src/lib/files/legacy-access.ts`, `src/lib/files/business-filter.ts` | Legacy-file rule |
| `src/lib/flows/{route-guard,http-request-node,flow-signature}.ts` | Flows role guard, SSRF-safe HTTP step, Meta signature check |
| `src/lib/data-store/access.ts`, `src/lib/automations/{access,send-webhook}.ts` | Role guards and the safe automation webhook |
| `src/lib/broadcasts/header-media.ts`, `src/lib/jobs/public-error.ts` | Broadcast media check; user-safe error messages |
| `src/components/data/html-block.ts`, `src/components/settings/facebook-origin.ts`, `src/hooks/local-drafts.ts` | Frontend fixes |

**Heavily changed existing files:** `src/proxy.ts`, `src/auth.ts`, `server.ts`, `next.config.ts`, `src/lib/auth/{api-key,account,roles,deactivate-member,mfa}.ts`, `src/lib/whatsapp/{media-ref,encryption,meta-api}.ts`, `src/lib/dev/send-guard.ts`, `src/lib/social/webhook-secrets.ts`, `src/lib/webhooks/deliver.ts`, `src/lib/flows/{engine,webhook-handler,meta-send}.ts`, `src/app/api/files/[...path]/route.ts`.

---

## 7. Dependencies upgraded

| Package | Before → after |
|---|---|
| next | 16.3.4 → 16.4.3 |
| dompurify (override) | 3.4.13 → 3.4.17 (isomorphic-dompurify kept at 3.18.0, now pinned exactly) |
| undici (override `undici@7`) | 7.29.0 → 7.30.1 |
| axios (override) | 1.18.1 → 1.21.0 |
| sharp | 0.35.4 → 0.35.5 |
| socket.io / engine.io | 4.8.3 / 6.6.9 → 4.8.4 / 6.6.11 |
| shadcn | 4.10.0 → 4.23.0. This removed `@modelcontextprotocol/sdk`, express, body-parser, proxy-addr, hono and fast-uri from the tree. |
| others | follow-redirects, brace-expansion, source-map-js, vite, zod, ip-address, qs, postcss-selector-parser, vitest (dev) |

`engines.node` changed from `>=20.0.0` to `>=22`. `npm audit`: 24 advisories (3 critical, 12 high, 8 moderate, 1 low) → 3 low. `npm audit --omit=dev --audit-level=high` exits 0. Advisory IDs, method and recommendations are in [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md).

---

## 8. Tests performed and results

| Check | Before | After |
|---|---|---|
| `npm audit` | 24 advisories (3 critical, 12 high, 8 moderate, 1 low) | 3 low (deepmerge via shadcn CLI) |
| `npm audit --omit=dev --audit-level=high` | — | exit 0 |
| ESLint | 1 error / 66 warnings | 0 errors / 62 warnings |
| TypeScript `tsc --noEmit` | clean | clean (`f9b10c4`) |
| `npm test` (vitest) | 213 files / 1,980 tests pass | **320 files / 2,985 tests pass** at `f9b10c4`, exit 0, 0 `it.fails` remaining |
| `npm run build` | — | **passes** on the final commit `f9b10c4` (re-run; 2 informational Turbopack warnings) |
| Migrations 152/153/154 | — | Each run twice on a throwaway PostgreSQL 16 (idempotent, exit 0). Migration 154's rollback was run inside BEGIN…ROLLBACK and restored exactly the 2 keys it had revoked. **Not dry-run on `crm_prod_copy`.** |
| Playwright E2E (2 businesses × roles) | 50/54 | 54/54 (production build of `fa7fc4a`; the later commits change only the send guard and integration-secret storage) |

Details, the list of 107 new regression test files and what was **not** tested: [SECURITY_TEST_RESULTS.md](SECURITY_TEST_RESULTS.md).

---

## 9. Remaining risks

The open HIGH and MEDIUM items (see the register for all 38 items that are not FIXED; no critical or high item is open):

| ID | Risk | Status | Why it matters |
|---|---|---|---|
| V-036 | Rate limits trust `X-Real-IP`. In code, production binds Node to 127.0.0.1 by default; the rest is server configuration | PARTIALLY FIXED (manual) | If port 3000 is exposed, or Nginx does not set `X-Real-IP`, every per-IP limit can be bypassed |
| V-071 / V-072 | CI and Dependabot are configured but have never run; servers' Node version unknown | PARTIALLY FIXED | Future advisories go unnoticed until the config is pushed and the settings are enabled |
| V-046 | Whole-database backup download has no step-up re-authentication | PARTIALLY FIXED | Platform owner only, but it is the most sensitive download |
| V-025 | Flow and voice token keys derived from `NEXTAUTH_SECRET` without per-purpose derivation | PARTIALLY FIXED | Hardening |
| V-013 | Flows key setup route is still a GET (CSRF-able for an owner) | PARTIALLY FIXED | Owner-only now |

Other residual risks:
- **Public repository.** The source and an old vulnerable snapshot (`wacrm-main.zip`, still tracked, V-075) are publicly readable. Attackers can diff the fixes.
- **The enforced CSP still allows inline scripts** (V-032). Any future HTML-injection bug would therefore be full XSS.
- **Logging of personal data is only partly reduced** (V-057; includes `flows/meta-send.ts:542`, which logs a customer's Instagram ID and the start of a media URL; masking recommended). No per-contact AI cost limit (V-113). Credential-free email binding on invitations (V-118).
- **Browser flows not clicked through after the COOP change:** Embedded Signup, Razorpay and Google connect.
- **Integration secrets (V-060):** two non-security leftovers. A partial `auth_config` without `has_secret` replaces the whole config, and `auth_config: null` may return 500 (pre-existing Prisma JsonNull behaviour). Unsealed old rows stay plaintext until they are next saved.
- **Staging still runs background jobs** (only `APP_ENV=development` stops them). Their outbound effects are now blocked by the guard, but the reviewer suggested switching jobs off on preview/staging by default.

---

## 10. Manual actions (no code can do these)

1. Make the GitHub repository private. Then decide on `git rm --cached wacrm-main.zip` and a history purge (V-075).
2. After approval, push the branch. Root `.github/` makes CI and Dependabot run for the first time. Enable Dependabot alerts, security updates and private vulnerability reporting in the repository settings.
3. Dry-run migrations 152, 153 and 154 inside `BEGIN … ROLLBACK` on `crm_prod_copy`. Check 153's duplicate pre-check queries.
4. On every VPS: Node 22 LTS at the latest patch (≥ 22.22.2) or Node 24 LTS; secrets check (§0 of HARDENING.md); `NODE_ENV=production` in PM2; `APP_ENV` unset; Nginx, UFW, SSH, PostgreSQL role, backups, monitoring and log retention per [INFRASTRUCTURE_SECURITY.md](INFRASTRUCTURE_SECURITY.md).
5. Tell owners that API keys must be re-minted and that viewers have lost write access (see [SECURITY_FIXES.md §2](SECURITY_FIXES.md#2-behaviour-changes-users-will-notice)).
6. On staging, click through Embedded Signup, Google connect, a Razorpay payment link and the webchat widget on a customer site.
7. Optional: run the legacy-file backfill script on single-business servers.

Step-by-step order: [PRODUCTION_SECURITY_CHECKLIST.md](PRODUCTION_SECURITY_CHECKLIST.md).

## 11. Production deployment recommendations

- Deploy only after the `crm_prod_copy` dry-runs pass and the owner approves.
- Roll out per VPS, starting with one low-traffic customer. Take a database and `uploads/` backup immediately before each one.
- Set `META_SOCIAL_SIGNATURE` and `META_FLOWS_SIGNATURE` to `observe` only briefly, if live Flows or social webhooks start failing, and then remove them. The start-up check warns while they are set.
- Keep one PM2 process in fork mode. Rate limits, socket rooms and the cache invalidation of the legacy-file rule are per process.
- Watch logs for `[startup]` refusals, `[DEV]` guard lines, HTTP 432 (Flows signature) and 403 spikes in the first days.
- Rollback: the git tag `pre-security-audit`, the rollback blocks in migrations 152/153/154, and restore order database → uploads → code (checklist §4).

## 12. Before-and-after security status

| Control | Before | After |
|---|---|---|
| Who can mint API keys | Any member, including viewers (HTTP 201 in Playwright) | Owner only (403 for others) |
| API key lifetime and binding | No creator, expiry or revocation; legacy keys honoured forever | Bound to the creator; expiry ≤ 365 days; soft revoke; creator-less keys refused (migration 154 revokes them) |
| Invitation links | Created a new owner workspace; reusable; racy | Join the inviting account with the invited role; single use; atomic; optional email binding |
| Viewer write access | Data Store, automations, flows/chatbots, webhooks, WhatsApp/email/SMS/RCS config, WA profile, message delete, new chat | Read-only; writes need agent/supervisor/admin/owner as listed in [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md) |
| Platform Meta App | Any tenant owner | Platform owner only |
| Sessions | Idle timeout bypassable; heartbeat revived dead sessions; 8 h cap never reached; sockets lived on | Idle, revocation and the 8 h cap enforced from sign-in time; sockets expire ≤ 15 min and are cut on sign-out or removal |
| SSRF | Plain `fetch` on integration, flow, knowledge, AI base URL, webhook, call-forward and token_uri URLs | Every user-URL fetch goes through `safeFetch`; 84 bypass tests pass |
| Files | `../` traversal across tenants; send paths read any tenant's file; legacy files open to all | Per-account folders enforced on read and send; legacy files only on single-business, closed-sign-up servers |
| Webhook authenticity | One tenant's FB secret could sign for all; Flows unsigned | Per-tenant scope; Flows signature verified |
| Secrets at rest | FB/IG tokens, FB app secret, webhook signing secrets and integration credentials (`auth_config`) in plaintext | AES-256-GCM sealed; old rows sealed on their next save |
| Production start-up | Placeholder or short secrets accepted; NODE_ENV unset → dev mode | Refuses weak secrets; production mode unless explicitly development |
| Non-production sending | Staging/preview could message real customers and cause real third-party side effects | Messages, webhooks, flow HTTP steps, Meta writes and every provider write API blocked; production unchanged |
| Dependencies | 24 advisories (3 critical) | 3 low (dev CLI) |
| CI / Dependabot | Never ran | Configured at the repo root, hardened (runs once pushed) |
| Infra guidance | None in the repo | Nginx/PM2 examples + HARDENING.md (manual) |
| Tests | 1,980 | 2,985 (+107 regression and exploit test files) |
