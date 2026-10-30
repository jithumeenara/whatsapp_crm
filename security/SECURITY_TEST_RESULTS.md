# Security test results

Part of the 2026-10 security audit. Index: [README.md](README.md). This file records only checks that were actually run, with the numbers that were reported. Anything not run is listed in [§8](#8-what-was-not-tested-and-why).

Final code state: commit `f9b10c4`. Baseline: tag `pre-security-audit`.

## 1. Summary of checks

| Check | Command | Before (`pre-security-audit`) | After (final) |
|---|---|---|---|
| Dependency advisories | `npm audit` | 24 (3 critical, 12 high, 8 moderate, 1 low) | **3 low** (deepmerge via the `shadcn` CLI; no upstream fix) |
| Production dependencies, high+ | `npm audit --omit=dev --audit-level=high` | — | **exit 0** |
| Lint | `npx eslint .` | 1 error / 66 warnings | **0 errors / 62 warnings** (all remaining warnings pre-existing; changed files clean) |
| Types | `npx tsc --noEmit` | clean | **clean** (`f9b10c4`) |
| Unit / integration tests | `npm test` (vitest) | 213 files / 1,980 tests pass | **320 files / 2,985 tests pass**, exit 0, **0 `it.fails` remaining** (`f9b10c4`) |
| Production build | `npm run build` | — | **passes** on the final commit `f9b10c4` (re-run; 2 informational Turbopack warnings) |
| End-to-end (Playwright) | local throwaway PostgreSQL 16, fake data | **50/54** (original code) | **54/54** (production build of `fa7fc4a`; later commits change only the send guard and integration-secret storage, which are covered by unit tests) |
| Migrations 152/153/154 | run twice on a throwaway PostgreSQL 16; 154's rollback inside BEGIN…ROLLBACK | — | idempotent, exit 0; rollback restored exactly the 2 keys it revoked. **Not run on `crm_prod_copy`.** |
| Secret scanning | gitleaks 8.21.2 + regex sweep (A5) | — | 3 hits, all false positives; no real credentials (shallow history: 2 commits) |
| CI workflow | — | never ran | **not run yet** (config moved to the repo root; nothing pushed) |

## 2. Test-suite history

Each agent ran the full suite as it worked. These counts show how the suite grew (as reported in the findings):

| Point | Files / tests | Notes |
|---|---|---|
| Baseline (before the agents) | 213 / 1,980 pass | from the audit brief |
| After the round-1 agents (A2 round 2, A1 round 2) | 290–291 / 2,456–2,461 pass | |
| R3 integration fixer | 294 / 2,471 pass | |
| Reviewer round 1 (`89b293a`) | 300 / 2,602 pass + 9 expected fail | 9 `it.fails` = confirmed gaps N1–N7 |
| R4 (`403f950`) | 308 / 2,696 pass, 0 `it.fails` | |
| Reviewer round 4 | 308 / 2,699 pass + 1 expected fail | R4a cache window |
| R5 (`a7a9267`) | 308 / 2,728 pass | |
| Reviewer round 5 | 310 / 2,745 pass, 0 failed, 0 `it.fails` | lead's verified number at `a7a9267`: 309 / 2,738 before the reviewer's 2 files |
| R6 (`fa7fc4a`, fixer's run) | 311 / 2,782 pass; 2 jsdom files could not start (see §7) | |
| Lead-verified (`fa7fc4a`) | 313 / 2,793 pass, exit 0 | jsdom declared; both files run |
| Reviewer round 6 | 314 / 2,822 pass + 9 expected fail | `outbound-side-effects.test.ts`: R6a/R6b |
| R7 (`3f24396`, fixer's run) | 315 / 2,907 pass, 0 `it.fails` | R6a/R6b closed |
| Reviewer final check (round 7 + V-060, `3f24396`) | 318 / 2,976 pass + 3 expected fail | 3 `it.fails` = V060-a/b/c |
| Lead-verified (`75d27a3`) | 318 / 2,979 pass, exit 0, 0 `it.fails` | V060-a/b/c fixed; the reviewer's `it.fails` flipped red → green |
| Reviewer final check (lead fixes) | 320 / 2,985 pass, 0 `it.fails` | `lead-fixes.test.ts` |
| **Final, lead-verified (`f9b10c4`)** | **320 / 2,985 pass**, exit 0, 0 `it.fails`; tsc clean; eslint 0 errors | V-119 log redaction |

## 3. Test-first evidence

The repository rule (AGENTS.md) is that "fixed" means a test went red → green. For each CONFIRMED finding, the implementing agent ran the new test against the unchanged code and recorded a failure *for the bug's reason* (for example `expected 201 to be 403`, `expected [201,201] to equal [201,403]`, `expected 200 to be 404`, or "fetch spy called") before writing the fix. Some examples:

| Fix | Red before (recorded) | After |
|---|---|---|
| API keys, owner only | 4 failed: `expected 201 to be 403` | 5/5 |
| Invitation sign-up | 5 failed, including the race `[201,201]` vs `[201,403]` | 9/9 |
| Proxy idle bypass | 9 failed / 12 passed | 23/23 |
| Heartbeat revival | 5 failed / 1 passed | 6/6 |
| Socket lifetime | 4 failed / 2 passed | 6/6 |
| Flows/chatbot role guard | 16 failed | 26/26 |
| SSRF client | the suite failed (module absent); a mutation removing the `lookup` guard fails 3 tests | 104/104 |
| Send guard coverage | 16 failed | 18/18 |
| Round-6 side effects | 18 failed (DNS asked or fetch spy called) | 37/37 |
| Round-7 provider writes | 45 failed | 76/76 |
| V-060 integration secrets at rest | 3 failed | 4/4 |
| V-119 dev-guard log redaction | 2 failed | 2/2 |

Tests written **after** the fix (so not shown red first) are marked in the findings. Examples are `webhook-scope.test.ts`, `facebook/config` "refuses a Page…", `sms/config/config-secrets.test.ts`, `send-guard-hosts.test.ts`, `legacy-access.test.ts` and `safe-fetch-redirects.test.ts`. The reviewer mutation-checked the last four against the old code: 17 assertions failed, so they can fail.

Where an existing test was changed, the reviewer judged each change legitimate: two of A2's API-key tests after the owner's policy change (stricter), the round-4 redirect tests replaced in round 5 (stricter per case), and the round-6 test that asserted the R6b hole ("a flow HTTP GET still goes out"), replaced in round 7 by a stricter one.

## 4. Independent exploit suite — `src/security-review/`

Written by the independent reviewer, who wrote none of the fixes. An `it.fails` documents a confirmed gap: it is flipped to a plain `it` and run to prove it fails for the stated reason, and turned into a plain `it` once the gap is fixed.

| File | Round | What it attacks | State at `f9b10c4` |
|---|---|---|---|
| `api-key-legacy.test.ts` | 1 | creator-less keys (N2); revoked, expired, removed and demoted creators; no cache | pass |
| `channel-config-rbac.test.ts` | 1 | viewer replacing email/SMS/RCS credentials (N1) | pass |
| `file-paths.test.ts` | 1 (rewritten in 4) | traversal spellings, other-account folders, legacy files (N4), optional `accountId` (N5), cache window (R4a) | pass |
| `invitation-claim.test.ts` | 1 | owner creation, concurrent claim, reuse, expiry, email-binding lookalikes | pass |
| `safe-fetch-bypass.test.ts` | 1 | **84 SSRF bypass tests** (every IPv4 spelling; mapped, NAT64, 6to4 and Teredo IPv6; metadata; rebinding; mixed DNS; redirects; size, gzip and time caps) + N7 headers | pass |
| `send-guard-bypass.test.ts` | 1 | Instagram DMs (N3) and other send paths | pass |
| `upgrade-redirect-bypass.test.ts` | 5 | 10 tests on the http→https upgrade exemption, using a real `lookup` | pass |
| `legacy-business-count.test.ts` | 5 | 7 tests: what counts as a business | pass |
| `outbound-side-effects.test.ts` | 6 | 38 tests: tenant webhooks, flow HTTP steps (every verb), Meta writes, R6a provider writes, R6b flow GET, `DEV_ALLOWED_HOSTS` exactness, production untouched | pass (its 9 `it.fails` flipped red → green in round 7) |
| `provider-writes.test.ts` | 7 (final check) | 59 tests: every provider host (Telegram method forms, Google token/revoke, MS Graph, SMS gateways, Razorpay, PhonePe) and bypass spellings | pass |
| `integration-secrets-at-rest.test.ts` | 7 (final check) | V-060: sealing, every reader, V060-a/b/c | pass (3 `it.fails` flipped red → green in `75d27a3`) |
| `lead-fixes.test.ts` | final (lead fixes) | V060-a/b/c behaviour; the dev-guard log line never contains a token, authkey, phone numbers or the path (V-119) | pass (4 tests) |

Round 1 created 6 files with 140 tests (131 pass + 9 `it.fails`). All 9 were closed by rounds 4 and 5. Every later `it.fails` (9 in round 6, 3 in the final check after round 7) has also been closed; **none remain**.

## 5. Regression test files added (107 committed)

`git diff --name-only --diff-filter=A pre-security-audit..HEAD | grep test` at `f9b10c4` lists 107 test files plus 1 test helper. All of them are committed. The register IDs come from [VULNERABILITY_REGISTER.md](VULNERABILITY_REGISTER.md).

| Test file (relative to `Whatsapp-CRM/`) | Register IDs | Note |
|---|---|---|
| `src/app/api/account/invitations/route.test.ts` | V-014 |  |
| `src/app/api/account/members/[userId]/admin-policy.test.ts` | V-021 |  |
| `src/app/api/account/mfa/enroll/route.test.ts` | V-012 |  |
| `src/app/api/account/sessions/[id]/route.test.ts` | V-011 |  |
| `src/app/api/account/transfer-ownership/route.test.ts` | V-018 |  |
| `src/app/api/admin/setup-flows-key/route.test.ts` | V-013 |  |
| `src/app/api/api-keys/creator-expiry.test.ts` | V-005 |  |
| `src/app/api/api-keys/legacy-notice.test.ts` | V-005 |  |
| `src/app/api/api-keys/route.test.ts` | V-002 |  |
| `src/app/api/auth/password/route.test.ts` | V-017 |  |
| `src/app/api/auth/register/invite-email.test.ts` | V-014 |  |
| `src/app/api/auth/register/route.test.ts` | V-003, V-019 |  |
| `src/app/api/automations/automations-rbac.test.ts` | V-041 |  |
| `src/app/api/broadcasts/broadcasts-access.test.ts` | V-043 |  |
| `src/app/api/call-config/route.test.ts` | V-093 |  |
| `src/app/api/conversations/[id]/assignment.test.ts` | V-049 |  |
| `src/app/api/conversations/new-chat/route.test.ts` | V-050 |  |
| `src/app/api/data-tables/data-tables-rbac.test.ts` | V-038 |  |
| `src/app/api/database/backup/route.test.ts` | V-046, V-064 |  |
| `src/app/api/deals/deals-refs.test.ts` | V-048 |  |
| `src/app/api/facebook/config/route.test.ts` | V-065, V-094 |  |
| `src/app/api/facebook/webhook/verify.test.ts` | V-081 |  |
| `src/app/api/files/[...path]/route.test.ts` | V-042 |  |
| `src/app/api/flows/[id]/upload/file-tenancy.test.ts` | V-043 |  |
| `src/app/api/flows/data-exchange/[flowId]/[screenId]/signature.test.ts` | V-112 |  |
| `src/app/api/heartbeat/route.test.ts` | V-008 |  |
| `src/app/api/integrations/integrations-at-rest.test.ts` | V-060 |  |
| `src/app/api/integrations/integrations-secrets.test.ts` | V-040 |  |
| `src/app/api/invitations/[token]/redeem/route.test.ts` | V-006 |  |
| `src/app/api/leads/[id]/patch-ownership.test.ts` | V-047 |  |
| `src/app/api/messages/[id]/route.test.ts` | V-050 |  |
| `src/app/api/messages/[id]/sealed-token.test.ts` | V-065 |  |
| `src/app/api/messages/ai-suggest/route.test.ts` | V-116 |  |
| `src/app/api/meta/embedded-signup/route.test.ts` | V-096 |  |
| `src/app/api/pipelines/[id]/stages/[stageId]/route.test.ts` | V-045 |  |
| `src/app/api/platform/meta-config/route.test.ts` | V-004 |  |
| `src/app/api/presence/leave/route.test.ts` | V-008 |  |
| `src/app/api/rcs/webhook/route.test.ts` | V-095 |  |
| `src/app/api/sms/config/config-secrets.test.ts` | V-104 |  |
| `src/app/api/sms/config/test-message/route.test.ts` | V-099 |  |
| `src/app/api/upload/route.test.ts` | V-053 |  |
| `src/app/api/webhooks/rbac.test.ts` | V-091 |  |
| `src/app/api/webhooks/secret-storage.test.ts` | V-065 |  |
| `src/app/api/whatsapp/broadcast/header-file-tenancy.test.ts` | V-043 |  |
| `src/app/api/whatsapp/config/route.test.ts` | V-090 |  |
| `src/app/api/whatsapp/profile/route.test.ts` | V-098 |  |
| `src/app/api/whatsapp/send/api-key-sender.test.ts` | V-020 |  |
| `src/components/data/html-block.test.ts` | V-084 |  |
| `src/components/settings/facebook-origin.test.ts` | V-083 |  |
| `src/hooks/local-drafts.test.ts` | V-086 |  |
| `src/lib/ai/google-auth.test.ts` | V-107, V-108 |  |
| `src/lib/ai/providers/openai-compatible.test.ts` | V-106 |  |
| `src/lib/ai/providers/ssrf-guard.test.ts` | V-106 |  |
| `src/lib/ai/web-extract.test.ts` | V-106 |  |
| `src/lib/auth/account-api-key.test.ts` | V-020 |  |
| `src/lib/auth/api-key.test.ts` | V-005 |  |
| `src/lib/auth/deactivate-member.test.ts` | V-018 |  |
| `src/lib/auth/device-session.test.ts` | V-007 |  |
| `src/lib/auth/invite-fake-db.test-helper.ts` | — | test helper |
| `src/lib/auth/mfa.test.ts` | V-015, V-016 |  |
| `src/lib/auth/roles-act-on.test.ts` | V-021 |  |
| `src/lib/auth/session-guard.test.ts` | V-008, V-010 |  |
| `src/lib/auth/session-invalidation.test.ts` | V-011 |  |
| `src/lib/automations/send-webhook.test.ts` | V-041 |  |
| `src/lib/data-store/record-data-media.test.ts` | V-054 |  |
| `src/lib/db/db-scripts.test.ts` | V-063, V-064, V-070 |  |
| `src/lib/dev/send-guard-coverage.test.ts` | V-092 |  |
| `src/lib/dev/send-guard-hosts.test.ts` | V-092 |  |
| `src/lib/dev/send-guard-log.test.ts` | V-119 |  |
| `src/lib/dev/send-guard-providers.test.ts` | V-092 |  |
| `src/lib/dev/send-guard-side-effects.test.ts` | V-092 |  |
| `src/lib/files/legacy-access.test.ts` | V-044 |  |
| `src/lib/flows/http-request-node.test.ts` | V-105 |  |
| `src/lib/flows/meta-send-tenancy.test.ts` | V-043 |  |
| `src/lib/flows/route-guard.test.ts` | V-110 |  |
| `src/lib/flows/webhook-tenant.test.ts` | V-109, V-111 |  |
| `src/lib/integration-fetch.test.ts` | V-039, V-040 |  |
| `src/lib/jobs/public-error.test.ts` | V-056 |  |
| `src/lib/messaging/channels/rcs-send-guard.test.ts` | V-092 |  |
| `src/lib/net/safe-fetch-redirects.test.ts` | V-117 |  |
| `src/lib/net/safe-fetch.test.ts` | V-039, V-093, V-105, V-106 (central client used by all SSRF fixes) | 104 tests |
| `src/lib/push.test.ts` | V-092 |  |
| `src/lib/rate-limit-cap.test.ts` | V-058 |  |
| `src/lib/realtime-server.test.ts` | V-011, V-031 |  |
| `src/lib/security/next-config.test.ts` | V-030, V-032 |  |
| `src/lib/security/startup-check-messages.test.ts` | V-028 |  |
| `src/lib/security/startup-check.test.ts` | V-026, V-027, V-028, V-068 |  |
| `src/lib/social/webhook-scope.test.ts` | V-089 |  |
| `src/lib/utils.test.ts` | V-054 |  |
| `src/lib/webchat/tokens-ip.test.ts` | V-025 |  |
| `src/lib/webhooks/deliver.test.ts` | V-093 |  |
| `src/lib/whatsapp/encryption-stored.test.ts` | V-065 |  |
| `src/lib/whatsapp/media-download.test.ts` | V-097 |  |
| `src/lib/whatsapp/media-ref.test.ts` | V-043 |  |
| `src/lib/whatsapp/payment-gateways/razorpay.test.ts` | V-100 |  |
| `src/proxy.test.ts` | V-008, V-009, V-010, V-029 |  |
| `src/security-review/api-key-legacy.test.ts` | V-005 |  |
| `src/security-review/channel-config-rbac.test.ts` | V-104 |  |
| `src/security-review/file-paths.test.ts` | V-042, V-043, V-044 |  |
| `src/security-review/integration-secrets-at-rest.test.ts` | V-060 |  |
| `src/security-review/invitation-claim.test.ts` | V-003, V-006, V-014 |  |
| `src/security-review/lead-fixes.test.ts` | V-119 |  |
| `src/security-review/legacy-business-count.test.ts` | V-044 |  |
| `src/security-review/outbound-side-effects.test.ts` | V-092 |  |
| `src/security-review/provider-writes.test.ts` | V-092 |  |
| `src/security-review/safe-fetch-bypass.test.ts` | V-039, V-117 |  |
| `src/security-review/send-guard-bypass.test.ts` | V-092 |  |
| `src/security-review/upgrade-redirect-bypass.test.ts` | V-117 |  |

## 6. Playwright end-to-end: original vs fixed

Setup: a local throwaway PostgreSQL 16 with fake seed data (2 businesses; owner, admin, supervisor, agent and viewer roles). The original code (`f6dc659`) ran on its dev server. The fixed code ran as a production build (`NODE_ENV=production`, `APP_ENV=development`, so no message could leave). The table below is the recorded comparison (fixed column from the `403f950` build). The lead then re-ran the same 54 checks on the **`fa7fc4a` production build: 54/54 passed** (final Playwright run). `3f24396`, `75d27a3` and `f9b10c4` change only the non-production send guard, its log line and integration-secret storage, and were not re-run in the browser.

**Original 50/54 → fixed 54/54.** Three of the four original failures are real security defects: a viewer could create API keys (HTTP 201), an agent could create API keys (201), and a viewer passed the role check when creating an outgoing webhook (the 400 came from validation, not from a role refusal). The fourth, "admin can sign in", was a test-harness timing issue that was fixed in the harness, not a product defect.

| Area | Check | Original code | Fixed code |
|---|---|---|---|
| auth | anonymous /dashboard redirects to /login | PASS (status 307) | PASS (status 307) |
| auth | anonymous GET /api/contacts rejected | PASS (status 401) | PASS (status 401) |
| headers | CSP present | PASS (default-src 'self'; script-src 'self' 'u) | PASS (default-src 'self'; script-src 'self' 'u) |
| headers | HSTS present | PASS (max-age=63072000; includeSubDomains; pre) | PASS (max-age=63072000; includeSubDomains; pre) |
| headers | X-Frame-Options DENY | PASS () | PASS () |
| headers | X-Content-Type-Options nosniff | PASS () | PASS () |
| headers | No X-Powered-By | PASS () | PASS () |
| next | image optimizer does not render SVG inline | PASS (status 400 ) | PASS (status 404 text/html; charset=utf-8) |
| login | wrong password stays on /login | PASS (http://localhost:3100/login) | PASS (http://localhost:3100/login) |
| login | owner can sign in | PASS (http://localhost:3100/dashboard) | PASS (http://localhost:3100/dashboard) |
| login | admin can sign in | FAIL (http://localhost:3100/login) | PASS (http://localhost:3100/dashboard) |
| login | supervisor can sign in | PASS (http://localhost:3100/dashboard) | PASS (http://localhost:3100/dashboard) |
| login | agent can sign in | PASS (http://localhost:3100/dashboard) | PASS (http://localhost:3100/dashboard) |
| login | viewer can sign in | PASS (http://localhost:3100/dashboard) | PASS (http://localhost:3100/dashboard) |
| session | session cookie is HttpOnly | PASS (authjs.session-token) | PASS (__Secure-authjs.session-token) |
| session | session cookie SameSite Lax/Strict | PASS (Lax) | PASS (Lax) |
| pages | owner /dashboard renders | PASS (status 200 landed /dashboard) | PASS (status 200 landed /dashboard) |
| pages | owner /inbox renders | PASS (status 200 landed /inbox) | PASS (status 200 landed /inbox) |
| pages | owner /contacts renders | PASS (status 200 landed /contacts) | PASS (status 200 landed /contacts) |
| pages | owner /leads renders | PASS (status 200 landed /leads) | PASS (status 200 landed /leads) |
| pages | owner /pipelines renders | PASS (status 200 landed /pipelines) | PASS (status 200 landed /pipelines) |
| pages | owner /broadcasts renders | PASS (status 200 landed /broadcasts) | PASS (status 200 landed /broadcasts) |
| pages | owner /templates renders | PASS (status 200 landed /templates) | PASS (status 200 landed /templates) |
| pages | owner /automations renders | PASS (status 200 landed /automations) | PASS (status 200 landed /automations) |
| pages | owner /chatbot renders | PASS (status 200 landed /chatbot) | PASS (status 200 landed /chatbot) |
| pages | owner /flows renders | PASS (status 200 landed /flows) | PASS (status 200 landed /flows) |
| pages | owner /follow-ups renders | PASS (status 200 landed /follow-ups) | PASS (status 200 landed /follow-ups) |
| pages | owner /tasks renders | PASS (status 200 landed /tasks) | PASS (status 200 landed /tasks) |
| pages | owner /segments renders | PASS (status 200 landed /segments) | PASS (status 200 landed /segments) |
| pages | owner /files renders | PASS (status 200 landed /files) | PASS (status 200 landed /files) |
| pages | owner /data renders | PASS (status 200 landed /data) | PASS (status 200 landed /data) |
| pages | owner /catalog renders | PASS (status 200 landed /catalog) | PASS (status 200 landed /catalog) |
| pages | owner /calls renders | PASS (status 200 landed /calls) | PASS (status 200 landed /calls) |
| pages | owner /social renders | PASS (status 200 landed /social) | PASS (status 200 landed /social) |
| pages | owner /ads renders | PASS (status 200 landed /ads) | PASS (status 200 landed /ads) |
| pages | owner /integrations renders | PASS (status 200 landed /integrations) | PASS (status 200 landed /integrations) |
| pages | owner /reports renders | PASS (status 200 landed /reports) | PASS (status 200 landed /reports) |
| pages | owner /ai-quality renders | PASS (status 200 landed /ai-quality) | PASS (status 200 landed /ai-quality) |
| pages | owner /settings renders | PASS (status 200 landed /settings) | PASS (status 200 landed /settings) |
| tenant | Acme owner cannot read Other business contact by id | PASS (status 404) | PASS (status 404) |
| tenant | Acme owner can read own contact (control) | PASS (status 200) | PASS (status 200) |
| tenant | contact list excludes other business | PASS (status 200) | PASS (status 200) |
| tenant | Acme owner cannot delete Other business contact | PASS (status 404) | PASS (status 404) |
| tenant | Acme owner cannot edit Other business contact | PASS (status 404) | PASS (status 404) |
| rbac | viewer cannot delete a contact | PASS (status 403) | PASS (status 403) |
| rbac | viewer cannot edit a contact | PASS (status 403) | PASS (status 403) |
| rbac | viewer cannot create outgoing webhook | FAIL (status 400) | PASS (status 403) |
| rbac | viewer cannot create API key | FAIL (status 201) | PASS (status 403) |
| rbac | agent cannot create API key | FAIL (status 201) | PASS (status 403) |
| rbac | agent cannot open reports API | PASS (status 403) | PASS (status 403) |
| rbac | viewer sees reports lock screen | PASS (http://localhost:3100/dashboard) | PASS (http://localhost:3100/dashboard) |
| rbac | viewer /api/me works (control) | PASS (status 200) | PASS (status 200) |
| auth | public signup without invitation refused | PASS (status 400) | PASS (status 400) |
| session | after sign-out the API rejects the session | PASS (status 401) | PASS (status 401) |

Note: the session cookie name changes from `authjs.session-token` (dev server) to `__Secure-authjs.session-token` (production build). That is the expected production behaviour.

## 7. Honest notes

- **Two jsdom-based test files did not run for part of the audit.** From checkpoint `89b293a` until the round-6 commit `fa7fc4a`, `src/hooks/use-realtime.test.tsx` and `src/lib/email/editor-dom.test.ts` could not start. The lockfile re-resolution had nested `jsdom` under `isomorphic-dompurify`, so the jsdom test environment could not find it. Suite counts reported in that window therefore exclude these two files. In `fa7fc4a`, `jsdom` 29.1.1 is declared as an explicit devDependency, and both files now run and pass (included in 313 / 2,793).
- Several agents' full-suite runs showed transient failures in other agents' files while those files were being edited concurrently (`realtime-server.test.ts`, `broadcasts-access.test.ts`, `safe-fetch.test.ts`, `secret-storage.test.ts`). Each passed when run alone. The realtime test was later de-flaked (no fixed sleeps; 3 isolated and 3 full-suite runs green). The final runs above have no failures.
- `npm audit signatures` (a new CI step) could not run in the sandbox, because the proxy blocks the sigstore TUF CDN. actionlint could not be downloaded. Both workflow files were only parsed as YAML.
- `nginx.conf.example` was not syntax-checked (nginx is not installed here). `ecosystem.config.example.cjs` loads with `node -e require(...)`.

## 8. What was NOT tested, and why

| Not tested | Why | Mitigation / next step |
|---|---|---|
| Real Meta / WhatsApp / Instagram / Facebook calls (webhooks, Embedded Signup, Flows signature, media, sends) | No real credentials or test accounts; the send guard is on in every test run | Provider shapes are mocked in unit tests. Watch logs for 432/401 after deploy; `META_FLOWS_SIGNATURE=observe` exists briefly for rollout |
| Real Razorpay, PhonePe, Google (OAuth, Sheets, Calendar, TTS), Microsoft Graph, SendGrid, MSG91, TextBee, Twilio, Telegram calls | Same | Unit tests with mocks only |
| **Click-through of Embedded Signup, Razorpay checkout and Google connect popups after the COOP change** (`same-origin-allow-popups`) | No browser session against the real providers | **Manual** staging click-through (checklist) |
| Webchat widget embedded on a real customer website (CORP/COOP, frame-ancestors) | No external site | Manual staging check |
| MFA SMS / OTP delivery | No SMS provider; sending is blocked in tests | MFA logic is unit-tested (attempt race, TOTP replay, enrol lock) |
| OWASP ZAP or any other DAST / fuzzing scan | Not run in this audit | Recommended against staging |
| Migration dry-run on `crm_prod_copy` (real data shape, duplicate Pages for 153, legacy keys for 154) | No access to production data | **Manual**, before deploy |
| Any server: Nginx, TLS, UFW, SSH, PostgreSQL roles, PM2, backups, Node version | No server access | All are manual actions ([INFRASTRUCTURE_SECURITY.md](INFRASTRUCTURE_SECURITY.md)) |
| CI on GitHub | Not pushed | Runs on the first push after approval |
| Multi-process (PM2 cluster) behaviour | The deployment is one process by design | Keep fork mode with 1 instance |
| Load / denial-of-service testing | Out of scope | Nginx `limit_req` examples are provided |
| Legacy-file backfill script against real `uploads/` | No real data | Dry-run mode prints counts first |
| Git history before the shallow clone (secret scan) | Shallow clone: 2 commits | Re-run gitleaks on a full clone; consider history purge with the repo going private |
| Playwright on `3f24396`/`75d27a3`/`f9b10c4` | The last browser run was on `fa7fc4a` | Those commits change only the dev send guard, its log line and integration-secret storage, which unit tests cover; build passes on `3f24396` |
| Integration secrets on a real database with old plaintext rows | No production data | Readers accept both forms; rows seal on their next save |
