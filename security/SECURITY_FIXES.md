# Security fixes

Part of the 2026-10 security audit. Index: [README.md](README.md). Each fix is listed with its register IDs ([VULNERABILITY_REGISTER.md](VULNERABILITY_REGISTER.md)). The full list of test files is in [SECURITY_TEST_RESULTS.md](SECURITY_TEST_RESULTS.md). Paths are relative to `Whatsapp-CRM/`.

"Review" gives the independent reviewer's result (`A7-REVIEW.md`). **V2** means the item is named in a verdict table or covered by a reviewer exploit test. **V1** means it was covered by the reviewer's round-1 read-through of every claim, without a dedicated reviewer test.

---

## 1. Summary of fixes

| # | Fix | Register IDs | Severity (highest) | Review |
|---|---|---|---|---|
| F-01 | Dependency upgrades | V-001 | CRITICAL | FIXED (V2) |
| F-02 | API keys: owner-only, creator-bound, expiring, legacy keys refused | V-002, V-005, V-020 | HIGH | FIXED (V2) |
| F-03 | Atomic, single-use invitation claim; no owner via invitation; optional email binding | V-003, V-006, V-014, V-019 | HIGH | FIXED (V2) |
| F-04 | Platform Meta App restricted to the platform owner | V-004 | HIGH | FIXED (V1) |
| F-05 | Session lifetime judged from sign-in time; idle and revocation enforced everywhere | V-007, V-008, V-009, V-010, V-017, V-018 | MEDIUM | FIXED (V2) |
| F-06 | Socket.io connections expire and are cut on sign-out or removal | V-011, V-031 | MEDIUM | FIXED (V1) |
| F-07 | MFA hardening (enrol lock, attempt race, TOTP replay) | V-012, V-015, V-016 | MEDIUM | FIXED (V1) |
| F-08 | Admin-over-admin policy (`canActOnMember`) | V-021 | LOW | FIXED (V1) |
| F-09 | Role floors on mutating routes (Data Store, automations, flows/chatbot, webhooks, WhatsApp/email/SMS/RCS config, WA profile, messages, new chat, ai-suggest, SMS test, template sync, Flows key setup) | V-013, V-038, V-041, V-050, V-090, V-091, V-098, V-099, V-104, V-110, V-116 | HIGH | FIXED (V2); V-013 PARTIALLY FIXED |
| F-10 | Ownership of related records (leads, deals, tasks, activities, assignment, pipeline stages) | V-045, V-047, V-048, V-049 | MEDIUM | FIXED (V1/V2) |
| F-11 | Central SSRF-safe client `safeFetch` and its adoption at every user-URL call site | V-039, V-041, V-093, V-097, V-105, V-106, V-107, V-117 | HIGH | FIXED (V2) |
| F-12 | `/api/files` traversal, safe download headers, random upload names | V-042, V-053 | HIGH | FIXED (V2) |
| F-13 | Send paths read only the caller's own files (`accountId` required) | V-043 | HIGH | FIXED (V2) |
| F-14 | Legacy root-level files: single-business rule plus backfill script | V-044 | MEDIUM | FIXED (V2) |
| F-15 | Secrets sealed at rest (FB/IG tokens, FB app secret, webhook signing secret) | V-065 | MEDIUM | FIXED (V2) |
| F-16 | Integration credentials redacted in API responses and sealed at rest | V-040, V-060 | HIGH | FIXED (V-040 V1; V-060 V2) |
| F-17 | Cross-tenant webhook forgery and claim squatting (FB/IG scope, Page uniqueness, RCS resolution, Quick Connect asset check) | V-089, V-094, V-095, V-096 | HIGH | FIXED (V1) |
| F-18 | Flows endpoint: Meta signature, tenant-scoped data-exchange, generic decryption error | V-109, V-111, V-112 | MEDIUM | FIXED (V1) |
| F-19 | Google token cache keyed per credential | V-108 | MEDIUM | FIXED (V1) |
| F-20 | Non-production send guard (messages and every outbound side effect) | V-092 | HIGH | FIXED (V2, reviewer final check after round 7) |
| F-21 | Production start-up check and dev-mode decision | V-026, V-027, V-028, V-068 (part) | MEDIUM | FIXED (V2) |
| F-22 | Proxy public-prefix boundary, image optimiser off, security headers (COOP/CORP, `object-src`) | V-029, V-030, V-032 | LOW | FIXED / V-032 PARTIALLY FIXED |
| F-23 | Database scripts and backup route | V-046, V-063, V-064, V-070 | MEDIUM | FIXED (V1); V-046 PARTIALLY FIXED |
| F-24 | Errors and logs: user-safe messages, masked phone numbers, token length only | V-056, V-057, V-081 | LOW | PARTIALLY FIXED / FIXED |
| F-25 | Webchat IP-hash key, Razorpay empty secret, cron compare | V-025 (part), V-052, V-100 | LOW | FIXED (V1); V-025 PARTIALLY FIXED |
| F-26 | Frontend: postMessage origin, HTML-block sanitiser, blob re-typing, URL scheme allow-list, drafts cleared at sign-out | V-054, V-083, V-084, V-085, V-086 | LOW | FIXED (V1) |
| F-27 | Smaller API hardening: broadcast rate limit, export formula guard, rate-limiter cap, report bucket, voice `end_reason`, forgot-password page | V-022, V-051, V-055, V-058, V-059, V-114 | LOW | FIXED (V1) |
| F-28 | Supply chain: CI at the repo root, pinned and least-privilege; Dependabot with cooldown; `.npmrc` | V-071, V-072, V-073, V-076, V-080 | MEDIUM | PARTIALLY FIXED (not run yet) / V-080 FIXED |
| F-29 | Deployment documentation (Nginx, PM2, HARDENING.md) | V-082 | INFO | PARTIALLY FIXED (manual application) |
| F-30 | Dev-guard log redaction: stopped sends log provider and host only | V-119 | LOW | FIXED (V2) |

---

## 2. Behaviour changes users will notice

| Who | Change | Why | Linked fix |
|---|---|---|---|
| **Account owners with integrations** | API keys created before this release stop working. Migration 154 revokes them; until it runs, they are already refused in code. Settings → API keys shows: "Older API keys were turned off for security. Create a new key and update your integrations." | Old keys have no recorded creator and may have been minted by a viewer | F-02 |
| Owners | Only the owner can create, list and revoke API keys. Keys may get an expiry of at most 365 days. A key stops working if its creator is removed or demoted below supervisor. | Keys outranked or outlived their creators | F-02 |
| **Viewers** | Viewers lose write access. They can no longer create or edit Data Store tables, columns or rows, automations, flows or chatbots, outgoing webhooks, or channel connections; they cannot delete messages, start new chats or request AI drafts. Reading is unchanged. | Viewer is read-only by definition | F-09 |
| Agents | Agents can no longer take or reassign a colleague's lead or chat. They can take an unassigned chat or give back their own. AI drafts work only on chats assigned to them, so an unassigned chat now returns 404. Data Store columns and table settings need supervisor. Writing to flows and chatbots needs page access to `/flows` or `/chatbot`. | Agent scope | F-09, F-10 |
| Admins | Admins can no longer demote, edit, remove or reset the password of another admin, and cannot act on the owner. Outgoing webhooks need admin. | Peer-admin takeover | F-08 |
| Owners only | Connecting or replacing WhatsApp, email (SendGrid), SMS or RCS credentials is owner-only. The email `inbound_secret` and SMS `webhook_secret` are shown only to the owner, so other roles do not see the webhook URL. | N1 | F-09 |
| Everyone on an upgraded server | If `NEXTAUTH_SECRET` or `AUTH_SECRET` is under 32 characters, a placeholder, or low-entropy, the server **refuses to start**. Replacing the secret **signs everyone out once**. `ENCRYPTION_KEY` must be 64 hex characters and **must not be changed** on a server with data, or every stored token becomes unreadable. | Forgeable sessions | F-21 |
| Operators | A PM2 entry without `NODE_ENV` now runs production, not dev mode. `npm run dev` still runs dev mode. | Dev mode in production | F-21 |
| All users | Sessions end 8 hours after **sign-in** even if active. Before, the cap moved forward with every refresh. An idle tab cannot be revived. Changing your password signs out your other devices. Live updates reconnect every ~15 minutes, invisibly. | Session control | F-05, F-06 |
| Users with MFA | You must disable MFA (with your password) before enrolling a new method. | Silent MFA replacement | F-07 |
| New sign-ups | Passwords need at least 8 characters. `@agent.local` addresses are refused. Invitation links work once only, join the inviting business with the invited role, and are refused when bound to a different email. | Owner creation through links | F-03 |
| Forgot password | The page now says "Ask your administrator to reset your password". The old page called a route that did not exist. | Dead flow | F-27 |
| Tenants with automation webhooks, Flows HTTP steps or integrations | A cross-site redirect that carries a request body is refused with "This address redirects to another site, so the request was not sent there. Update the saved URL to the address it redirects to." Custom headers such as `X-API-Key` are dropped on a cross-site redirect. An http→https upgrade on the same host and default ports still works. Private, loopback and metadata addresses are refused. | SSRF and credential leakage | F-11 |
| Servers with old uploads | Files stored directly in `uploads/` (before per-account folders) and not recorded in `file_uploads` are served and sendable **only** while the server has exactly one business and public sign-up is closed. Otherwise they return 404 and cannot be sent. The optional backfill script records them permanently. | Cross-tenant file reads | F-14 |
| Instagram/Facebook connections | Saving a Page or IG account that another workspace already connected returns 409. Migration 153 adds unique indexes. | Claim squatting | F-17 |
| WhatsApp Flows | Requests without a valid `X-Hub-Signature-256` get HTTP 432. `META_FLOWS_SIGNATURE=observe` lets them through briefly during rollout. With no Meta app secret configured, Flows fail closed. | Forged Flow requests | F-18 |
| Browser popups | `Cross-Origin-Opener-Policy: same-origin-allow-popups` on pages (not on `/google-done`). Embedded Signup, Razorpay and Google connect are expected to keep working, but **this has not been click-tested**. | Cross-origin isolation | F-22 |
| Dev/staging/preview servers (developers) | No message reaches a real customer on any channel (including Instagram DMs, Twilio, web-push and FCM); mock replies are returned instead. Since rounds 6–7, tenant webhooks, automation webhooks and flow/automation HTTP steps are blocked for **every method** unless the host is in `DEV_ALLOWED_HOSTS`. Call-forward, Meta Graph writes and other providers' write APIs (Telegram, Microsoft Graph, TextBee, MSG91, Twilio, SendGrid, Google writes/revoke, Razorpay, PhonePe) are blocked too, with believable stand-in replies. Consequences: Meta template creation and the WhatsApp connect steps report success without reaching Meta unless `DEV_ALLOWED_HOSTS=graph.facebook.com`; Razorpay checkout gets a fake order id unless `DEV_ALLOWED_HOSTS=api.razorpay.com` (use test keys). `DEV_ALLOWED_HOSTS` is an exact host match and never unlocks customer messages. Production is unaffected. | Data protection | F-20 |
| Signing out | Unsent email drafts are cleared from the browser on explicit sign-out. An idle sign-out keeps them. | Shared computers | F-26 |
| Data Store HTML blocks | Forms, inputs, buttons and `<style>` are stripped from HTML-block fields. | Credential phishing inside the CRM | F-26 |

---

## 3. Fix details

### F-01 Dependency upgrades — V-001 (CRITICAL)
- **Original vulnerability:** 24 npm advisories (3 critical, 12 high, 8 moderate, 1 low), including critical Next.js advisories (GHSA-vcvr-r3jv-pc5j, GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr), a critical DOMPurify advisory (GHSA-cg2g-xh64-v4q7) and a critical proxy-addr advisory (GHSA-jqcg-44mw-7w3h).
- **Root cause:** an outdated lockfile. CI and Dependabot never ran (F-28).
- **Files:** `package.json`, `package-lock.json` (commit `f6dc659`).
- **Fix:** in-major upgrades and overrides, with no `--force`. See [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md).
- **Test:** `npm audit` 24 → 3 low; full suite, typecheck and build pass.
- **Review:** WS A FIXED. Residual 3 low advisories through the `shadcn` CLI (INFO).
- **Regressions:** `engines.node` is now `>=22`; unpdf already needed it. isomorphic-dompurify stays at 3.18.0, with dompurify forced to 3.4.17, so the Node floor does not rise further.

### F-02 API keys — V-002, V-005, V-020 (HIGH)
- **Original vulnerability:** any member could mint a supervisor-rank key (CVSS 8.7). Keys had no creator, expiry or revocation. Creator-less keys were treated as the owner's forever. Sends were attributed to the earliest profile.
- **Root cause:** the guard checked only "signed in"; the schema had no binding.
- **Files:** `src/app/api/api-keys/route.ts`, `src/app/api/api-keys/[id]/route.ts`, `src/lib/auth/{api-key,account,deactivate-member}.ts`, `src/app/api/whatsapp/send/route.ts`, `prisma/schema.prisma`, `supabase/migrations/152_api_key_owner_expiry_invite_email.sql`, `supabase/migrations/154_revoke_creatorless_api_keys.sql`, `src/components/settings/api-keys-panel.tsx`.
- **Fix:**
  - `requireRole('owner')` on mint, list and revoke.
  - Migration 152 adds `created_by_user_id` (FK ON DELETE RESTRICT), `expires_at` and `revoked_at`.
  - `verifyApiKey` checks every request, with no cache. It refuses revoked, expired and creator-less keys, and keys whose creator is no longer a supervisor or above in the key's account.
  - Requests act as the creator.
  - `deactivateMember` soft-revokes the removed member's keys.
  - Migration 154 records and soft-revokes creator-less active keys. It is idempotent and has a commented rollback that restores only the rows it changed.
  - `GET /api/api-keys` returns `legacy_keys_off`, which drives the UI notice.
- **Tests:** `src/app/api/api-keys/route.test.ts`, `creator-expiry.test.ts`, `legacy-notice.test.ts`, `src/lib/auth/api-key.test.ts`, `src/lib/auth/account-api-key.test.ts`, `src/app/api/whatsapp/send/api-key-sender.test.ts`, `src/security-review/api-key-legacy.test.ts`. Playwright: viewer and agent key creation 201 → 403.
- **Review:** FIXED (V2). The test edits for the policy change were judged legitimate and stricter.
- **Regressions:** owners must re-mint keys. After an ownership transfer, the old owner (now admin) keeps working keys. A key never outranks supervisor.

### F-03 Invitations and sign-up — V-003, V-006, V-014, V-019 (HIGH)
- **Original vulnerability:** an invitation link created a new **owner** workspace and was never used up (CVSS 7.7). Concurrent redeems both succeeded. Links were not bound to an email. `@agent.local` could be squatted, and the password minimum was 6 characters.
- **Root cause:** the invitation only opened the sign-up gate, and claiming was check-then-update.
- **Files:** `src/app/api/auth/register/route.ts`, `src/lib/auth/claim-invitation.ts` (new), `src/app/api/invitations/[token]/redeem/route.ts`, `src/app/api/account/invitations/route.ts`, `src/app/(auth)/signup/page.tsx`, `src/components/settings/invite-member-dialog.tsx`, `members-tab.tsx`, migration 152 (`account_invitations.email`).
- **Fix:**
  - `claimInvitation()` is one conditional `updateMany` (unaccepted, unexpired, email null or matching) inside the user-creating transaction.
  - Account and role come from the invitation row; owner is never granted.
  - Redeem refuses with 409 when the caller owns a workspace that has other members.
  - Duplicate email gives 409.
  - The invite dialog has an optional email field.
- **Tests:** `src/app/api/auth/register/route.test.ts`, `invite-email.test.ts`, `src/app/api/invitations/[token]/redeem/route.test.ts`, `src/app/api/account/invitations/route.test.ts`, `src/security-review/invitation-claim.test.ts`.
- **Review:** FIXED. The email binding is "weak by design": sign-up does not verify the email (V-118).
- **Regressions:** each link works once. A legacy unbound link logs a warning when it is used.

### F-04 Platform Meta App — V-004 (HIGH)
- **Original vulnerability:** any workspace owner could PATCH the server-wide Embedded Signup app (CVSS 8.6) and so harvest other tenants' WABA tokens.
- **Fix:** `src/app/api/platform/meta-config/route.ts` also requires `isPlatformOwner()`.
- **Test:** `src/app/api/platform/meta-config/route.test.ts` (200 → 403).
- **Review:** V1.
- **Regressions:** tenant owners can no longer see or edit this setting.

### F-05 Session lifetime, idle and revocation — V-007, V-008, V-009, V-010, V-017, V-018 (MEDIUM)
- **Original vulnerability:**
  - A fake `Authorization: Bearer wcrm_…` header skipped the idle check.
  - `POST /api/auth/session` and `/api/heartbeat` revived idle or revoked sessions.
  - The 8 h cap and "sign out everywhere" were judged from `iat`, which every refresh re-stamps.
  - A re-login revived a revoked device row.
  - A password change kept other devices signed in.
  - The role cache lasted 60 s after a change.
- **Files:** `src/proxy.ts`, `src/auth.ts`, `src/lib/auth/{session-guard,device-session,session-invalidation}.ts`, `src/lib/security/session-revoked.ts`, `src/app/api/heartbeat/route.ts`, `src/app/api/presence/leave/route.ts`, `src/app/api/auth/password/route.ts`, transfer-ownership and redeem routes, `deactivate-member.ts`.
- **Fix:**
  - A new `authTime` claim is set once at sign-in. The jwt callback, proxy, heartbeat and presence refuse tokens that are idle, older than `session_invalidated_at`, older than 8 h or tied to a revoked device row.
  - The header bypass applies only to `/api/` and still runs the idle check.
  - Revoked device rows are never reused.
  - A password change revokes other sessions.
  - `forgetCachedProfile()` runs on every role or account change.
- **Tests:** `src/proxy.test.ts`, `src/app/api/heartbeat/route.test.ts`, `src/app/api/presence/leave/route.test.ts`, `src/lib/auth/{session-guard,device-session}.test.ts`, `src/app/api/auth/password/route.test.ts`, `src/app/api/account/transfer-ownership/route.test.ts`, `src/lib/auth/deactivate-member.test.ts`.
- **Review:** "Sessions: FIXED". Tokens issued before the deploy fall back to `iat` until they expire (LOW, transitional).
- **Regressions:** a hard 8 h session limit from sign-in.

### F-06 Socket lifetime — V-011, V-031 (MEDIUM)
- **Fix:**
  - `src/lib/realtime-server.ts` gives each connection a jittered 15-minute maximum lifetime; the client reconnects with a fresh ticket.
  - `disconnectUserSockets()` is called from sign-out-everywhere, deactivation, the admin password reset and device revoke.
  - Socket.io CORS falls back to `false`, not `*`.
- **Tests:** `src/lib/realtime-server.test.ts`, `src/lib/auth/session-invalidation.test.ts`, `src/app/api/account/sessions/[id]/route.test.ts`.
- **Review:** V1.
- **Regressions:** a brief reconnect every ~15 minutes. `NEXT_PUBLIC_SITE_URL` must be set for cross-origin socket use (same-origin is unaffected).

### F-07 MFA — V-012, V-015, V-016
- **Fix:**
  - Enrol start/confirm returns 409 while MFA is on.
  - An attempt is reserved with a conditional increment before the code is compared.
  - TOTP steps cannot be reused; they are remembered in memory, so a restart reopens a window of at most 90 s.
- **Tests:** `src/app/api/account/mfa/enroll/route.test.ts`, `src/lib/auth/mfa.test.ts`.
- **Review:** V1.

### F-08 Admin-over-admin policy — V-021
- **Fix:** `canActOnMember(actor, target)` in `src/lib/auth/roles.ts` is enforced on member PATCH (every field), DELETE and password reset. The owner can act on anyone except the owner; an admin can act only on supervisor, agent and viewer.
- **Tests:** `src/app/api/account/members/[userId]/admin-policy.test.ts`, `src/lib/auth/roles-act-on.test.ts`.
- **Review:** V1.

### F-09 Role floors on mutating routes — V-013, V-038, V-041, V-050, V-090, V-091, V-098, V-099, V-104, V-110, V-116 (HIGH)
- **Original vulnerability:** many write handlers called `auth()` plus a profile lookup and never checked a role. Records were scoped to the account, so this was vertical escalation inside a business.
- **Fix (new floor):**

| Route group | New floor |
|---|---|
| Data Store rows | agent |
| Data Store schema and table settings | supervisor |
| Data Store table delete | admin |
| Automations writes | agent + `/automations` page access |
| Flows and chatbot writes | agent + page access |
| Flows keys | admin |
| `flows/sync` | agent |
| Outgoing webhooks | admin |
| `whatsapp/config` POST | owner |
| WhatsApp profile | admin |
| Template sync | supervisor |
| SMS test message | admin |
| email/sms/rcs config POST | owner; secrets shown to owner only |
| `messages/[id]` DELETE | agent, own chat for agents |
| `conversations/new-chat` | agent |
| `messages/ai-suggest` | agent, own chat for agents |
| `admin/setup-flows-key` | owner |

  Helpers: `src/lib/data-store/access.ts`, `src/lib/automations/access.ts`, `src/lib/flows/route-guard.ts`.
- **Tests:**
  - `src/app/api/data-tables/data-tables-rbac.test.ts`
  - `src/app/api/automations/automations-rbac.test.ts`
  - `src/lib/flows/route-guard.test.ts` (26 tests)
  - `src/app/api/webhooks/rbac.test.ts`
  - `src/app/api/whatsapp/{config,profile}/route.test.ts`
  - `src/app/api/sms/config/{test-message/route,config-secrets}.test.ts`
  - `src/app/api/messages/[id]/route.test.ts`, `src/app/api/conversations/new-chat/route.test.ts`, `src/app/api/messages/ai-suggest/route.test.ts`
  - `src/app/api/admin/setup-flows-key/route.test.ts`
  - `src/security-review/channel-config-rbac.test.ts`
  - Playwright: viewer webhook creation 400 → 403. The 400 before the fix means the role check had passed and only validation stopped the request.
- **Review:** FIXED (V2). V-013 is PARTIALLY FIXED because the route is still a GET.
- **Regressions:** see §2 (viewers, agents, admins). The webhooks panel hides its buttons below admin.

### F-10 Related-record ownership — V-045, V-047, V-048, V-049
- **Fix:**
  - Pipeline stage PATCH uses `updateMany({id, pipeline_id})`.
  - Leads: agents may edit only their own or pool leads and assign only to themselves.
  - `checkOwnedRefs` (`src/lib/leads/owned-refs.ts`) validates contact, lead, conversation and user ids on deals, tasks, lead activities and leads.
  - A deal's stage must belong to its pipeline.
  - Conversation assignment is atomic (409 on a race) and the assignee must be a member.
- **Tests:** `src/app/api/pipelines/[id]/stages/[stageId]/route.test.ts`, `src/app/api/leads/[id]/patch-ownership.test.ts`, `src/app/api/deals/deals-refs.test.ts`, `src/app/api/conversations/[id]/assignment.test.ts`.
- **Review:** assignment V2, others V1.

### F-11 SSRF — V-039, V-041, V-093, V-097, V-105, V-106, V-107, V-117 (HIGH)
- **Original vulnerability:** plain `fetch` on user-chosen URLs returned cloud metadata or loopback responses (CVSS up to 8.6) in five places: integration base URL, flow HTTP step, knowledge website import, custom AI base URL and the automation webhook. Outgoing webhooks and the call-forward URL had regex or no checks. The Google `token_uri` was trusted. The media download sent the Meta token to any host.
- **Fix:**
  - `src/lib/net/safe-fetch.ts` is built on node http/https with a custom `lookup`, so the socket connects to the checked address, which defeats DNS rebinding.
  - It blocks every private, loopback, link-local, metadata, CGNAT and special range in all IPv4/IPv6 spellings.
  - Redirects are manual and every hop is re-checked.
  - It enforces size caps after decompression, timeouts covering the body, and ports 80/443 unless a caller allows more.
  - It respects the dev send guard.
  - Round 4/5 additions:
    - On a cross-site hop only accept, accept-language, accept-encoding and user-agent headers are kept.
    - A cross-site redirect that carries a body is refused.
    - Fetch-spec method rewriting: 303 → GET; 301/302 → GET only after POST.
    - A same-host http→https upgrade on default ports keeps headers and body.
  - Call sites: `integration-fetch.ts`, `automations/send-webhook.ts`, `flows/http-request-node.ts`, `ai/web-extract.ts`, `ai/providers/openai-compatible.ts` (`redirect:'error'`), `webhooks/deliver.ts` (`redirect:'error'`, `assertPublicUrl` on save), `call-config` + `call-handler.ts`, `ai/google-auth.ts` (`trustedTokenUri`), `whatsapp/meta-api.ts` (`isMediaId`, `isMetaMediaHost`).
- **Tests:**
  - `src/lib/net/safe-fetch.test.ts` (104), `src/lib/net/safe-fetch-redirects.test.ts`
  - `src/lib/integration-fetch.test.ts`, `src/lib/automations/send-webhook.test.ts`, `src/lib/flows/http-request-node.test.ts`
  - `src/lib/ai/{web-extract,google-auth}.test.ts`, `src/lib/ai/providers/{ssrf-guard,openai-compatible}.test.ts`
  - `src/lib/webhooks/deliver.test.ts`, `src/app/api/call-config/route.test.ts`, `src/lib/whatsapp/media-download.test.ts`
  - `src/security-review/safe-fetch-bypass.test.ts` (84 bypass tests), `src/security-review/upgrade-redirect-bypass.test.ts`
- **Review:** WS E FIXED. The round-4 redirect regressions are FIXED in round 5.
- **Regressions:** see §2. URLs that redirect cross-site with a body must be updated to their final address. Self-hosted integrations on unusual ports must be on 80, 443, 8080 or 8443.

### F-12 File route — V-042, V-053 (HIGH)
- **Original vulnerability:** `GET /api/files/account-<mine>/%2e%2e/account-<theirs>/<file>` read another tenant's file (CVSS 7.1). The filename header was unescaped. Upload names were guessable.
- **Fix:**
  - Segments `..`, `.`, empty, backslash and NUL are refused.
  - Ownership comes from the first component of the resolved path.
  - `attachmentHeaders()` sets an encoded name, `nosniff` and `CSP: sandbox`; only raster/audio/video/PDF are shown inline, and HTML/SVG always download.
  - Uploads are stored as `randomUUID()-name`.
- **Tests:** `src/app/api/files/[...path]/route.test.ts`, `src/app/api/upload/route.test.ts`, `src/security-review/file-paths.test.ts`.
- **Review:** FIXED (V2).

### F-13 Send paths — V-043 (HIGH)
- **Original vulnerability:** an agent could send `media_url=/api/files/account-<other>/<file>` to their own WhatsApp and receive another business's file. The same applied to broadcast headers, template headers, Telegram and Flows media. `flows/[id]/upload?preview=1` could return the base64 of `../.env`.
- **Fix:**
  - `uploadPathFor()` and `resolveUploadPath()` in `src/lib/whatsapp/media-ref.ts` take a **required** `accountId`; an empty or non-string id is refused at runtime.
  - The resolved top folder must be `account-<id>`.
  - `sendTemplateMessage` requires `accountId`, and every caller passes it.
  - `checkHeaderMediaUrl` runs on broadcast create, draft and run.
- **Tests:** `src/lib/whatsapp/media-ref.test.ts`, `src/lib/flows/meta-send-tenancy.test.ts`, `src/app/api/flows/[id]/upload/file-tenancy.test.ts`, `src/app/api/whatsapp/broadcast/header-file-tenancy.test.ts`, `src/app/api/broadcasts/broadcasts-access.test.ts`, `src/security-review/file-paths.test.ts`.
- **Review:** FIXED (V2).

### F-14 Legacy files — V-044 (MEDIUM)
- **Original vulnerability:** files directly under `uploads/` with no `file_uploads` row were readable and sendable by any signed-in user of any tenant.
- **Owner's decision:** allow them only on single-business servers. A business is an account with at least one member who can sign in (has a password). Open sign-up means refuse.
- **Fix:**
  - `src/lib/files/legacy-access.ts` and `business-filter.ts`. A recorded file is decided by its account. An unrecorded file is allowed only when public sign-up is closed and exactly one business exists. A DB error refuses.
  - The business count has a 10 s cache, invalidated from register, add-member, redeem, deactivate, revive and transfer-ownership.
  - `scripts/backfill-legacy-file-owner.ts` runs dry by default and needs `--apply` to write. It writes only when exactly one business exists, only adds rows, and prints counts only.
- **Tests:** `src/lib/files/legacy-access.test.ts`, `src/security-review/file-paths.test.ts`, `src/security-review/legacy-business-count.test.ts`; the call-site tests assert the invalidation.
- **Review:** FIXED. Round 4 found an over-strict regression (holding accounts counted as businesses) and a 60 s cache window; both were fixed in round 5.
- **Regressions:** on servers with a second business or open sign-up, old unrecorded files return 404. A server where a member was removed before `deactivateMember` existed may count as two businesses, and the backfill script cannot help there.

### F-15 Secrets at rest — V-065 (MEDIUM)
- **Fix:**
  - `sealSecret`, `openStoredSecret` and `isSealed` in `src/lib/whatsapp/encryption.ts` (AES-256-GCM).
  - Writes are sealed in facebook/instagram config, embedded-signup and webhooks POST.
  - All 14 reader files open both sealed and legacy plain values, so no data migration is needed.
  - Graph calls at the touched sites use `Authorization: Bearer`.
- **Tests:** `src/app/api/facebook/config/route.test.ts`, `src/app/api/webhooks/secret-storage.test.ts`, `src/lib/whatsapp/encryption-stored.test.ts`, `src/app/api/messages/[id]/sealed-token.test.ts`, `src/lib/flows/meta-send-tenancy.test.ts`.
- **Review:** FIXED (V2). R3 caught readers that would have broken IG/FB sends; this is covered by the tests above.
- **Regressions:** existing plaintext rows stay plaintext until they are next saved. `ENCRYPTION_KEY` must never change.

### F-16 Integration secrets redacted and sealed at rest — V-040 (HIGH), V-060 (MEDIUM)
- **Fix:** `redactIntegration()` returns `username`/`header` and `has_secret` only. `integrations/[id]` GET asserts page access.
- **Tests:** `src/app/api/integrations/integrations-secrets.test.ts`.
- **Review:** V1.
- **V-060, at rest** (implemented by the lead in `3f24396`, hardened in `75d27a3`):
  - **Original vulnerability:** `integrations.auth_config` (third-party API keys, bearer tokens, Basic passwords, Razorpay key secrets) was stored in plaintext, so a database or backup leak exposed them.
  - **Fix:** `src/lib/integration-secrets.ts` provides `sealAuthConfig`, `openAuthConfig` and `isRedactedEcho`.
    - It is wired into integrations POST/PATCH, `redactIntegration`, `integration-sync` and the 3 Razorpay routes (create-order, save-payment, verify-payment).
    - Old plain rows are still read and are sealed on their next save, so no data migration is needed.
    - If a client echoes back the redacted copy, the stored credentials are kept rather than overwritten.
    - `75d27a3` closed the reviewer's three LOW gaps:
      - V060-a: a client-sent `{sealed: <plain>}` is now encrypted, not stored in clear.
      - V060-b: a sealed value that is not an object is never returned to clients.
      - V060-c: a corrupted or wrong-key value fails closed instead of throwing; before, it turned the whole list into a 500 and could echo crypto text.
  - **Tests:**
    - `src/app/api/integrations/integrations-at-rest.test.ts`: 3 red → 4 green.
    - `src/security-review/integration-secrets-at-rest.test.ts`: the reviewer's file; its 3 `it.fails` were flipped and seen red → green.
  - **Review:** FIXED (V2).
  - **Non-security leftovers:**
    - A partial `auth_config` without `has_secret` replaces the whole config.
    - `auth_config: null` may return 500, because Prisma expects `JsonNull`. This behaviour predates the fix.
  - `ENCRYPTION_KEY` must not change.

### F-17 Webhook forgery and squatting — V-089, V-094, V-095, V-096 (HIGH)
- **Fix:**
  - `socialWebhookScope()`: platform secrets may sign for all accounts; a tenant's own FB app secret may sign only for that tenant's pages. Other entries are dropped.
  - FB/IG config returns 409 for a page or IG id that another workspace holds; migration 153 adds partial unique indexes.
  - The RCS webhook picks the claimant whose own token validates Twilio's signature.
  - Embedded signup returns 403 unless `phoneNumberId` is listed under `wabaId` for the exchanged token.
  - The Embedded Signup origin check is in F-26.
- **Tests:** `src/lib/social/webhook-scope.test.ts` (written after the fix), `src/app/api/facebook/config/route.test.ts`, `src/app/api/rcs/webhook/route.test.ts`, `src/app/api/meta/embedded-signup/route.test.ts`.
- **Review:** V1.
- **Regressions:** migration 153 fails if duplicates already exist. Run its pre-check queries on `crm_prod_copy`.

### F-18 Flows endpoint — V-109, V-111, V-112 (MEDIUM)
- **Fix:**
  - `src/lib/flows/flow-signature.ts` checks `X-Hub-Signature-256` over the raw body against the WhatsApp webhook secrets and returns 432 on failure. `META_FLOWS_SIGNATURE=observe` only logs.
  - Data-exchange queries are scoped by the Flow's `account_id`.
  - A decryption failure returns a generic 421.
- **Tests:** `src/app/api/flows/data-exchange/[flowId]/[screenId]/signature.test.ts`, `src/lib/flows/webhook-tenant.test.ts`.
- **Review:** V1. The route scan lists the endpoint as "now signature-checked".
- **Regressions:** live Flows fail closed if no Meta app secret is configured, or if Meta signs with a secret the server does not have. Not tested against real Meta traffic.

### F-19 Google token cache — V-108
- **Fix:** the cache key includes a SHA-256 fingerprint of `private_key` and `token_uri`.
- **Test:** `src/lib/ai/google-auth.test.ts`.
- **Review:** V1.

### F-20 Non-production send guard — V-092 (HIGH) — FIXED
- **Original vulnerability:** preview, staging and test servers sent real messages. The guard missed MM API, calls, CAPI, audiences, ads, Twilio (axios), Google RCS, FCM, web-push and Instagram DMs.
- **Fix:**
  - `isSendProtected(env)` covers APP_ENV development/dev/local/test/preview/staging, NODE_ENV=test and VITEST. It reads the server environment only.
  - New provider-host rules, including `graph.(facebook|instagram).com/…/messages`, Twilio, RCS and FCM.
  - `sdkSendBlocked()` for Twilio and web-push.
  - `safeFetch` checks `blockedSend` on every hop.
- **Tests (messages):** `src/lib/dev/send-guard-coverage.test.ts`, `send-guard-hosts.test.ts`, `src/lib/messaging/channels/rcs-send-guard.test.ts`, `src/lib/push.test.ts`, `src/security-review/send-guard-bypass.test.ts`.
- **Review (round 5):** messages FIXED; non-message side effects still open at that point.
- **Round 6 (`fa7fc4a`) — non-message side effects:**
  - Before: on protected environments these still went out for real: tenant webhooks (`deliver.ts`), the automation "send webhook" step, flow/chatbot HTTP POST/PUT/PATCH/DELETE steps, the call-forward hand-off, and Meta Graph writes that are not messages (messenger_profile/ice breakers, whatsapp_business_profile, subscribed_apps, register, media_publish, comments, batch, `?method=delete`).
  - Fix: new `blockedOutbound(url, method, body, env, { purpose })` and `logBlocked` in `src/lib/dev/send-guard.ts`. It returns null immediately unless the environment is protected and `DEV_ALLOW_SENDING` is unset. Exact hostnames in `DEV_ALLOWED_HOSTS` are let through (this never unlocks a message). A non-GET/HEAD request with purpose `'outbound-action'` gets the stand-in `{ok:true, success:true, dev_blocked:true}`. A Meta Graph write gets `{success:true, id:"DEV_BLOCKED_…"}`, except OAuth/token/debug_token paths. The log line is `[DEV] blocked <name> to <host> (<env> environment)`, with no path, body or token.
  - `safeFetch` has a new option `purpose: 'outbound-action'` and calls `blockedOutbound` on each hop after the SSRF checks. `webhooks/deliver.ts`, `automations/send-webhook.ts`, `flows/http-request-node.ts` and `whatsapp/call-handler.ts` pass it. The patched global fetch calls it after `blockedSend`.
  - Test: `src/lib/dev/send-guard-side-effects.test.ts` (37 tests; 18 failed before the fix for the bug's reason). It covers production being untouched (a safeFetch POST arrives byte for byte).
  - Docs: `.env.local.example` (`DEV_ALLOWED_HOSTS`), `docs/deploy/HARDENING.md` §1.
  - Behaviour on dev/preview: connecting WhatsApp (register / subscribed_apps) "succeeds" without reaching Meta unless `DEV_ALLOWED_HOSTS=graph.facebook.com` is set. Message-template creation through the patched fetch is stopped too.
- **Reviewer round-6 check:** production unchanged; Meta writes and tenant-configured POST/PUT/PATCH/DELETE stopped; `DEV_ALLOWED_HOSTS` exact and safe. Two gaps:
  - **R6a (MEDIUM):** other providers' write APIs were not stopped. These were Telegram `setWebhook`/`deleteWebhook`/`deleteMessage` (saving the bot on staging re-pointed the production bot), TextBee webhook registration, Microsoft Graph subscription renewals (run by background jobs), Google Sheets/Calendar writes and Razorpay/PhonePe payment-link creation.
  - **R6b (LOW):** flow/chatbot HTTP GET steps still fired.
- **Round 7 (`3f24396`):**
  - A `PROVIDERS` rule set in `send-guard.ts`: on each known provider host, every non-GET/HEAD request is stopped unless that provider's `open` rule allows it.
  - Telegram is decided by the method name whatever the verb. Only getMe, getFile, getWebhookInfo, getChat and GET `/file/bot…` stay open; getUpdates is blocked because it would consume production's updates.
  - Google: `/token`, `/tokeninfo`, userinfo and `freeBusy` stay open; `/revoke` and writes are blocked.
  - Razorpay orders, links and refunds are blocked (GET of a payment open). PhonePe is blocked except its token endpoint.
  - MS Graph, TextBee, MSG91, Twilio and SendGrid: non-GET blocked.
  - AI hosts and OAuth hosts are left open on purpose.
  - `outbound-action` requests are stopped for every verb, including GET, unless the host is in `DEV_ALLOWED_HOSTS`.
  - Believable stand-in replies (Telegram `message_id`, Graph `expirationDateTime`, Razorpay `short_url`, …).
  - Tests:
    - `src/lib/dev/send-guard-providers.test.ts`: 76 tests; 45 red before.
    - The reviewer's `outbound-side-effects.test.ts`: 9 `it.fails` flipped, seen red → green.
    - The reviewer's `provider-writes.test.ts`: 59 tests.
  - One existing test, which asserted the R6b hole, was replaced with a stricter one; the reviewer judged this legitimate.
- **Reviewer final check:** every `https://` host in `src/lib`, `src/app/api` and `server.ts` was inventoried and is covered. Bypass attempts were all stopped: case, trailing dot, `set%57ebhook`, `getMe/../setWebhook`, `/token/../revoke`, lookalike hosts. Production is unchanged.
- **Status:** **FIXED (V2)**. R6a and R6b are closed.
- **Note:** preview/staging still run background jobs (only `APP_ENV=development` stops them). Their outbound effects are blocked, but switching jobs off there by default was suggested and not done.
- **Regressions:** none in production. APP_ENV unset is unchanged, and this is tested.

### F-21 Start-up check and dev mode — V-026, V-027, V-028 (MEDIUM)
- **Fix:**
  - `src/lib/security/startup-check.ts` runs after `app.prepare()`, once `.env` has loaded.
  - In production the server exits when `NEXTAUTH_SECRET` or `AUTH_SECRET` is missing, under 32 characters, a placeholder or low-entropy, or when `ENCRYPTION_KEY` is not 64 hex characters or is repetitive.
  - It warns on `APP_ENV=development`, `META_SOCIAL_SIGNATURE=observe`, `META_FLOWS_SIGNATURE=observe` and AUTH_SECRET≠NEXTAUTH_SECRET.
  - Messages name the variable and the problem (for example "is 12 characters long"), never the value.
  - `isDevServer()`: dev mode only when NODE_ENV=development, or when it is unset and the npm `dev` script is running.
  - `.env.local.example` leaves secrets blank, so they fail closed.
- **Tests:** `src/lib/security/startup-check.test.ts`, `startup-check-messages.test.ts`.
- **Review:** FIXED. Flagged as a deploy note.
- **Regressions:** existing servers with weak secrets **refuse to start**. See the checklist.

### F-22 Proxy and headers — V-029, V-030, V-032
- **Fix:**
  - `underPrefix()` segment-boundary matching for public paths.
  - `images.unoptimized: true`.
  - `object-src 'none'`.
  - COOP `same-origin-allow-popups` (except `/google-done`).
  - CORP `same-origin` on `/api/*` (except `/api/webchat/*` and `/api/meta-ads/track`).
- **Tests:** `src/proxy.test.ts`, `src/lib/security/next-config.test.ts`. Playwright: image optimiser 404.
- **Review:** V2. **Not browser-tested** for popups.
- **Remaining:** the enforced CSP still allows `'unsafe-inline'` scripts (V-032).

### F-23 Database scripts and backup route — V-046, V-063, V-064, V-070
- **Fix:**
  - `scripts/backup-db.sh` sources `pg-env.sh`, so the password goes through `PGPASSWORD` and not argv; `umask 077`.
  - `PGSSLMODE` comes from `?sslmode=` (allow-listed).
  - `pg-env.sh` handles backslashes and a missing `DATABASE_URL`.
  - The backup route returns 500 when pg_dump fails, errors the stream on a failure mid-dump, passes only PG* and PATH env, honours sslmode and writes audit log lines.
- **Tests:** `src/lib/db/db-scripts.test.ts`, `src/app/api/database/backup/route.test.ts`.
- **Review:** V1.
- **Not done:** step-up re-authentication for the backup download (V-046 PARTIALLY FIXED).

### F-24 Errors and logs — V-056, V-057, V-081
- **Fix:**
  - `publicErrorMessage()` (`src/lib/jobs/public-error.ts`) and fixed sentences at the A3 and A8 catch-alls.
  - `maskForLog()` (last 4 characters) for phone numbers in call-handler, whatsapp/send and the IG postback.
  - Verify-token compare uses `sameToken()` (timing-safe) and logs the length only.
- **Tests:** `src/lib/jobs/public-error.test.ts`, `src/app/api/facebook/webhook/verify.test.ts`.
- **Remaining:** A9-area error sites and the Flows logging of customer form values (V-056/V-057 PARTIALLY FIXED).

### F-25 Small secret handling — V-025 (part), V-052, V-100
- **Fix:**
  - webchat `hashIp` uses `NEXTAUTH_SECRET || AUTH_SECRET || ENCRYPTION_KEY` and stores no IP when none is set.
  - Razorpay verification fails closed on an empty secret or signature.
  - The automations cron uses `timingSafeEqual`.
- **Tests:** `src/lib/webchat/tokens-ip.test.ts`, `src/lib/whatsapp/payment-gateways/razorpay.test.ts`.
- **Review:** V1.

### F-26 Frontend — V-054, V-083, V-084, V-085, V-086
- **Fix:**
  - `isFacebookOrigin()` (https, no port, facebook.com or a subdomain).
  - `sanitizeHtmlBlock()` forbids form, input, button, textarea, select, style, link, meta and base, and the `action` attributes; adds `contain:paint`.
  - `viewableBlob()` re-types media blobs.
  - `safeHref()` in the client and `checkRecordData()` on the server enforce a URL scheme allow-list.
  - `clearEmailDrafts()` runs on sign-out.
- **Tests:** `src/components/settings/facebook-origin.test.ts`, `src/components/data/html-block.test.ts`, `src/lib/utils.test.ts`, `src/lib/data-store/record-data-media.test.ts`, `src/hooks/local-drafts.test.ts`.
- **Review:** V1.

### F-27 Smaller API hardening — V-022, V-051, V-055, V-058, V-059, V-114
- **Fix:**
  - Broadcast create/process/retry/rescue rate limit: 20/min per user.
  - `safeText` on exports.
  - Rate-limiter Map capped at 50,000 buckets.
  - Report `bucket` re-validated at the SQL splice.
  - Voice `end_reason` trimmed to 100 characters.
  - Static forgot-password page.
- **Tests:** `src/lib/rate-limit-cap.test.ts`, plus the full suite.
- **Review:** V1.

### F-28 Supply chain — V-071, V-072, V-073, V-076, V-080
- **Fix:**
  - CI and Dependabot are at the repo root: branches master and main, `working-directory: Whatsapp-CRM`, Node 22.
  - Actions are pinned by SHA; `permissions: contents: read`; `persist-credentials: false`.
  - New CI steps `npm audit signatures` and `npm audit --omit=dev --audit-level=high`.
  - Dependabot cooldown: 5 days, 14 days for majors.
  - `.npmrc`: `registry=` and `save-exact=true`.
- **Review:** not in the reviewer's verdict tables.
- **Status:** PARTIALLY FIXED until pushed and seen running.

### F-29 Deployment documentation — V-082
- **Fix:** `docs/deploy/HARDENING.md` (with §0 "Upgrading an existing server"), `docs/deploy/nginx.conf.example`, `docs/deploy/ecosystem.config.example.cjs`. See [INFRASTRUCTURE_SECURITY.md](INFRASTRUCTURE_SECURITY.md).
- **Status:** applying them is a manual action.

### F-30 Dev-guard log redaction — V-119 (LOW)
- **Original vulnerability:** found in the lead's final diff review. When the development/preview/staging fetch guard stopped a send, it logged the full URL with only `access_token` masked. Telegram bot tokens (in the URL path) and the MSG91 `authkey` plus phone numbers (in the query) were therefore written to non-production logs. This was pre-existing on developer laptops; widening the guard to staging/preview in this remediation widened the exposure.
- **Root cause:** the patched-fetch log line printed the URL.
- **Files:** `src/lib/dev/send-guard.ts` (commit `f9b10c4`).
- **Fix:** the patched fetch logs through `logBlocked(name, hostOf(url))`, so the line contains the provider name and hostname only. The path, query, userinfo, tokens, authkey and phone numbers are never included, for the message, Meta-write and provider rules alike.
- **Tests:** `src/lib/dev/send-guard-log.test.ts` (2 red → green; installs the real patch and asserts on the actual `console.warn` output); the reviewer's `src/security-review/lead-fixes.test.ts`.
- **Review:** "Final check (lead fixes)": FIXED. The reviewer grepped every `console.*` in `src` and `server.ts` and found no credential or full provider URL logged anywhere else. One INFO PII line remains: `src/lib/flows/meta-send.ts:542` logs the IGSID and the first 80 characters of a media URL. It is recorded under V-057 (PARTIALLY FIXED); masking is recommended.
- **Regressions:** `[DEV] blocked …` lines no longer show the path, which makes debugging on dev slightly harder. Production is unaffected.
