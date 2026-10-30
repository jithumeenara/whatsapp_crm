# API security matrix

Part of the 2026-10 security audit. Index: [README.md](README.md). Role model and capabilities: [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md).

Code state: commit `f9b10c4`. Route handlers: **335** `route.ts` files under `Whatsapp-CRM/src/app/api` (no `"use server"` actions). **110** of them were modified by this remediation; they are marked **changed** in the appendix.

## Legend

- **Auth type:**
  - `session` = NextAuth JWT cookie (checked in `src/proxy.ts` and again in the route)
  - `API key` = `Authorization: Bearer wcrm_…`, owner-minted, acting at supervisor rank as its creator
  - `signature` = HMAC or provider signature over the raw body
  - `URL secret` / `URL token` = secret in the path or query
  - `cron secret` = `AUTOMATION_CRON_SECRET` (or the route's cron secret), timing-safe, fails closed
  - `platform owner` = `isPlatformOwner()` (server operator, not a tenant role)
  - `public` = no credential
- **Min role:** owner > admin > supervisor > agent > viewer. `+page` means a page-access check (`assertPageAccess` / `requirePageAccess`) as well.
- **Tenant-scoped:** every record read or write is constrained by `account_id` from the session or key, never from the URL or body.
- **Rate limit:** route-level `checkRateLimit` (Y), "API key only" (per-key limit only when called with a key), or `-`. The proxy applies extra per-IP limits to the sign-in/MFA/register/redeem paths; the Nginx example adds zone limits (see [INFRASTRUCTURE_SECURITY.md §4](INFRASTRUCTURE_SECURITY.md#4-nginx-and-tls-manual--docsdeploynginxconfexample)).
- **Changed:** **⚑** marks a row whose security behaviour this remediation changed, with the register ID.

Sections 1–6 come from the agents' and reviewer's findings. Section 7 is A3's hand-built matrix of its 159 routes, copied as A3 wrote it. Section 8 is an automated grep of all 335 route files, for completeness; it is **not** a verified review.

---

## 1. Endpoints without a staff session (public, webhooks, crons, machine-to-machine)

| Path | Methods | Auth type | Tenant resolution | Validation / hardening | Rate limit | Notes |
|---|---|---|---|---|---|---|
| `whatsapp/webhook` | GET (verify), POST | signature: Meta `X-Hub-Signature-256` over the raw body, timing-safe, 401 before parsing; GET verify token via `sameToken()` | `phone_number_id` (DB unique) | fails closed with no secret | Nginx `crm_webhook` | ⚑ V-081 verify-token compare and logging |
| `facebook/webhook`, `instagram/webhook` | GET, POST | signature: platform secrets for all accounts; a tenant's own FB app secret **only for that tenant's pages** (`socialWebhookScope`) | `entry.id` → page, then `scopeAllows` | `META_SOCIAL_SIGNATURE=observe` rollout switch (never leave set) | Nginx | ⚑ V-089 cross-tenant forgery fixed; ⚑ V-081 |
| `flows/[id]/webhook`, `flows/[id]/endpoint`, `flows/data-exchange/[flowId]/[screenId]` | POST | signature: `X-Hub-Signature-256` (`checkFlowRequestSignature`) **plus** RSA-OAEP/AES-GCM encryption; 432 on a bad signature, generic 421 on a decryption error | the Flow's `account_id` | `META_FLOWS_SIGNATURE=observe` rollout switch | Nginx | ⚑ V-112, V-109, V-111 |
| `telegram/webhook/*` | POST | per-bot secret header, timing-safe; 404 before parsing; 1 MB cap | bot row | — | Nginx | secure as found |
| `sms/webhook/[secret]` | GET, POST | URL secret (192-bit) | secret → account | POST rate-limited; GET not (V-103) | POST Y | TextBee HMAC timing-safe |
| `email/webhook/[secret]` (SendGrid inbound) | POST | URL secret | secret → account | — | Y | |
| `rcs/webhook` | POST | Twilio signature, validated with **each claimant's own** auth token | claimant whose token validates | up to 20 claimants | Nginx | ⚑ V-095 |
| `email/microsoft/notify` | POST | `clientState`, timing-safe; validationToken echoed as text/plain + nosniff | subscription | only triggers a server-side fetch | Nginx | |
| `payments/phonepe/webhook` | POST | SHA256(user:pass), timing-safe | payment row | amount re-checked; atomic status update | Y | |
| `whatsapp/payments/webhook`, Razorpay payment-link webhook | POST | per-tenant HMAC; empty secret now fails closed | payment row | idempotent | Nginx | ⚑ V-100 |
| `google/sheet-ping` | POST | per-link secret compared through hashes, timing-safe | link | — | Y (per link) | |
| `meta-ads/track` | POST | URL secret (`web_events_secret`) | secret → account | CORS for customer sites; no CORP | Nginx `crm_public` | |
| `webchat/config/[key]`, `webchat/frame/[key]`, `webchat/session`, `webchat/messages`, `webchat/handoff` | GET/POST | public widget key + 256-bit session bearer (stored as SHA-256) | session decides account and conversation | Origin check; 8 KB bodies; 2000-character messages; frame-ancestors from `allowed_domains`; IP hash key fixed (⚑ V-025) | Y (per session/IP) | |
| `forms/[token]`, `forms/[token]/logo` | POST, GET | URL token (128-bit format check) | token → table | 64 KB cap; honeypot/consent; raster logo only | Y (per IP/form/rows) | |
| `v/[token]` | POST | HMAC-signed read link (132-bit), timing-safe | link | — | Y | |
| `external/webhook` | POST | URL secret `?secret=` (`lead_settings.webhook_secret`) | secret → account | no length caps (V-061) | Y (per IP) | |
| `file-manager/[id]/scan-result` | POST | HMAC signature of the file id, timing-safe | file row | — | - | |
| `push/vapid` | GET | public (public key); `?generate=1` any session | — | returns fresh random keys only (V-062) | - | |
| `csp-report` | POST | public | — | stores nothing; truncates; 8 KB check after buffering (V-034) | Y (60 / 15 min / IP) | |
| `automations/cron`, `chatbot/cron`, `flows/cron`, `scheduled-messages/cron`, `offers/cron` | GET | cron secret, `timingSafeEqual` + length check; 503 when unset | all accounts (job) | Nginx example: localhost only | - | ⚑ V-052 (automations was `!==`) |
| `voice/context`, `voice/transcript` | POST | `VOICE_AGENT_SECRET`, timing-safe, fails closed (503) | `phone_number_id` | transcript ≤ 100k characters; `end_reason` ≤ 100 | - | ⚑ V-114 |
| `mcp` | POST | API key (`verifyApiKey`), the same 401 for missing or wrong | key's account; read-only tools | Origin checked; stateless; generic tool errors | Y (120/min per key) | ⚑ V-005 key rules |
| `auth/[...nextauth]` (sign-in, callback, csrf, session) | GET/POST | public / session | — | generic errors; MFA challenge consumed in `authorize()`; `POST /api/auth/session` refused when idle | proxy per-IP (login 10/15 min) | ⚑ V-010 |
| `auth/mfa/start`, `auth/mfa/verify` | POST | public (credentials in body) | user | attempts reserved atomically (⚑ V-015); TOTP replay blocked (⚑ V-016) | Y + proxy | |
| `auth/register` | POST | public; closed unless `NEXT_PUBLIC_ALLOW_SIGNUP=true` or a valid invitation is **claimed** atomically | invitation's account, or a new empty workspace | 8-char passwords; `@agent.local` refused; 409 on duplicate email | proxy per-IP | ⚑ V-003, V-014, V-019 |
| `invitations/[token]/peek` | GET | URL token | invitation | returns no secrets | proxy per-IP | |
| `auth/verify-email` | GET | URL token | — | — | — | not reviewed in detail by the agents |
| `platform/meta-config/public` | GET | session (helper detected by the §8 scan; despite the name it is not anonymous) | platform singleton | not detailed by the agents | — | |

## 2. Authentication, account and member management (A2, 37 routes)

| Path | Methods: auth / min role | Tenant-scoped | Notes |
|---|---|---|---|
| `api-keys` | GET/POST: session / **owner** | Y | ⚑ V-002 (was any member); POST stores the creator and an optional `expires_at` (≤ 365 days); GET lists unrevoked keys plus `legacy_keys_off`; rate-limited |
| `api-keys/[id]` | DELETE: session / **owner** | Y | ⚑ V-002; hard delete |
| `auth/password` | POST: session (self) | self | ⚑ V-017 revokes other device sessions; 8-char floor |
| `account` | GET: viewer; PATCH (rename): admin | Y | |
| `account/agents` | POST: admin | Y | add agent; ⚑ invalidates the business-count cache (V-044) |
| `account/invitations` | GET/POST: admin | Y | ⚑ V-014 optional email; host from `NEXT_PUBLIC_SITE_URL` (V-023 if unset) |
| `account/invitations/[id]` | DELETE: admin | Y | |
| `invitations/[token]/redeem` | POST: session | invitation's account | ⚑ V-006 atomic claim; 409 if the caller owns a team; email binding |
| `account/members` | GET: viewer (emails supervisor+) | Y | |
| `account/members/[userId]` | PATCH/DELETE: admin + `canActOnMember` | Y | ⚑ V-021: admin cannot act on admin or owner; nobody sets their own role or `owner` |
| `account/members/[userId]/password` | POST: admin + `canActOnMember` + `canIssueAgentPassword` | Y | ⚑ V-021 |
| `account/transfer-ownership` | POST: owner | Y | ⚑ V-018 cache cleared |
| `account/mfa`, `account/mfa/disable` | session (self); disable needs the password | self | |
| `account/mfa/enroll/start`, `…/confirm` | POST: session (self); **409 while MFA is on** | self | ⚑ V-012 |
| `account/profile/email/verify/start`, `account/profile/phone/verify/start`, `…/confirm` | POST: session (self) | self | proxy rate limit |
| `account/session-settings` | session (self) | self | |
| `account/sessions` | GET: session (self) | self (`user_id`) | |
| `account/sessions/[id]` | DELETE: session (self) | self | ⚑ V-011 disconnects the user's sockets |
| `account/sign-out-everywhere` | POST: session (self) | self | sets `session_invalidated_at`; revokes rows; disconnects sockets |
| `account/capture-config` | GET: viewer; PATCH: admin | Y | |
| `me`, `profile`, `profiles` | session | Y / self | `/api/me` self-heals an owner mismatch only toward `owner_user_id` |
| `out-of-scope` | admin (write) | Y | |
| `platform/meta-config` | GET/PATCH: owner **+ platform owner** | singleton | ⚑ V-004 |
| `admin/setup-flows-key` | GET: **owner** | Y | ⚑ V-013 (was any member; still a GET) |

## 3. Channel and provider configuration (R4 sweep after the fixes)

| Route | GET | POST | PUT | PATCH | DELETE |
|---|---|---|---|---|---|
| `email/config` | member (secret owner-only) | **owner** ⚑ V-104 | – | – | owner |
| `sms/config` | member (secret owner-only) | **owner** ⚑ V-104 | – | – | owner |
| `rcs/config` | member (no secrets) | **owner** ⚑ V-104 | – | – | owner |
| `sms/config/test-message` | – | **admin** ⚑ V-099 | – | – | – |
| `whatsapp/config` | member (no secrets; `has_verify_token` boolean) | **owner** ⚑ V-090 | – | – | owner |
| `whatsapp/config/check-marketing-eligibility`, `direct-send`, `set-default` | – | owner | – | – | – |
| `whatsapp/config/webhook-route` | – | admin | – | – | – |
| `whatsapp/config/verify-registration` | member (diagnostics, no secrets) | – | – | – | – |
| `whatsapp/payments/config` | owner | – | owner | – | owner |
| `telegram/config` | admin (no secret returned) | admin | admin | – | admin |
| `instagram/config` | owner (token masked) | – | – | owner ⚑ V-065, V-094 | – |
| `facebook/config` | owner (secrets masked) | – | – | owner ⚑ V-065, V-094 | – |
| `meta-ads/config` | viewer (no secrets) | owner | – | – | owner |
| `platform/meta-config` | owner + platform owner | – | – | owner + platform owner ⚑ V-004 | – |
| `catalog/config` | agent | – | owner | – | owner |
| `ai-config` | viewer (`has_key` booleans) | – | owner | – | owner |
| `ai-config/test` | – | owner (rate-limited) | – | – | – |
| `ai-config/*` (accuracy-rules, embedding-model, eval, handover, image-reading, live-voice, admin-test, tts-credentials) | admin | admin | admin | – | admin |
| `call-config` | agent | – | admin (`call_forward_url` must be https and public) ⚑ V-093 | – | – |
| `google/config` | admin (`has_secret` boolean) | admin | admin | – | admin |
| `email/microsoft/config` | admin (`has_secret` boolean) | – | admin | – | admin |
| `account/capture-config` | viewer | – | – | admin | – |

## 4. Other messaging and integration routes changed by this remediation (A8)

| Path | Methods: auth / min role | Tenant-scoped | Notes |
|---|---|---|---|
| `webhooks` | GET: member (no `signing_secret`); POST: **admin** | Y | ⚑ V-091 (viewer passed the role check; Playwright 400 → 403); URL checked with `assertPublicUrl` on save (⚑ V-093); signing secret sealed (⚑ V-065); deliveries via `safeFetch` `redirect:'error'`; dev/preview: blocked (round 6, reviewer-checked) |
| `webhooks/[id]` | PUT/DELETE: **admin** | Y | ⚑ V-091 |
| `whatsapp/send` | POST: session or API key; the send permission is checked inside the route (the exact floor was not tabulated by the agents) | Y | ⚑ V-043 media path must be the caller's `account-<id>`; ⚑ V-020 API-key sends attributed to the creator; error text sanitised |
| `whatsapp/broadcast` | POST: session (send permission checked inside the route; not tabulated) | Y | ⚑ V-043 header file tenancy |
| `whatsapp/profile` | PATCH: **admin** | Y | ⚑ V-098 |
| `whatsapp/templates/sync` | POST: **supervisor** | Y | ⚑ V-099 |
| `whatsapp/templates/[id]`, `whatsapp/templates/submit` | supervisor | Y | error text sanitised (⚑ V-056) |
| `whatsapp/media/[mediaId]` | GET: session | Y | ⚑ V-097 `isMediaId`; token sent only to Meta CDN hosts |
| `meta/embedded-signup` | POST: owner | Y | ⚑ V-096 phone must belong to the WABA for the exchanged token; tokens sealed |
| `facebook/profile`, `facebook/profile/photo`, `instagram/profile`, `instagram/ice-breakers`, `social/facebook`, `social/instagram`, `meta-ads/lead-forms/discover` | as before | Y | ⚑ V-065 read sealed tokens |
| `razorpay/create-order`, `razorpay/save-payment`, `razorpay/verify-payment` | POST: agent / API key | Y | ⚑ V-060 integration credentials opened from sealed storage; env Razorpay fallback for any tenant (V-101, UNRESOLVED); dev/preview: orders/links blocked unless `DEV_ALLOWED_HOSTS=api.razorpay.com` |

## 5. AI, Flows, chatbot, voice, admin-chat (A9, 44 routes)

| Path | Methods: auth / min role | Tenant-scoped | Rate limit | Notes |
|---|---|---|---|---|
| `flows` | GET: session (no page check, V-115); POST: agent **+page `/flows`** | Y | - | ⚑ V-110 |
| `flows/[id]` | GET: session; PUT: agent +page | Y | - | ⚑ V-110 |
| `flows/[id]/publish`, `/activate`, `/upload`, `/endpoint` | POST: agent +page | Y | - | ⚑ V-110; upload reads only own files (⚑ V-043); error text not confirmed sanitised (V-056) |
| `flows/sync` | POST: **agent** | Y | - | ⚑ V-110 |
| `flows/keys`, `flows/keys/upload` | POST: **admin** | Y | - | ⚑ V-110 |
| `flows/[id]/runs`, `/screens`, `/last-error`, `flows/templates` | GET: session | Y | - | not page-gated (V-115) |
| `chatbot` | GET: session; POST: agent +page `/chatbot` | Y | - | ⚑ V-110 |
| `chatbot/[id]` | GET: session; PUT/PATCH: agent +page; DELETE: admin | Y | - | ⚑ V-110 |
| `ai-knowledge` | GET: member; writes: **admin** | Y | upload/sync Y | website import via `safeFetch` (⚑ V-106) |
| `ai-config/tts-credentials` | admin | Y | - | `token_uri` pinned (⚑ V-107); token cache per credential (⚑ V-108) |
| `ai-usage` | admin | Y | - | |
| `ai-quality` | GET: agent | Y | - | |
| `admin-chat/*` (5) | enrolled member + own TOTP, lockout after 5 | Y | - | propose → "YES <code>"; sends need web approval + step-up |
| `voice/*`, `mcp`, `chatbot/cron`, `flows/cron`, Flows Meta endpoints | see §1 | | | |

## 6. Next.js runtime routes (A1)

| Path | Methods: auth / min role | Notes |
|---|---|---|
| `realtime/ticket` | GET: **viewer**, no-store | HMAC-SHA256 ticket (60 s, reusable within its life, V-035); sockets now expire ≤ 15 min (⚑ V-011) |
| `heartbeat` | POST: session cookie (`getToken`) | ⚑ V-008: refuses idle, stale (authTime) and revoked tokens before re-signing |
| `presence/leave` | POST: session cookie | ⚑ V-008: refuses revoked sessions; writes only the caller's row |
| `version` | GET: viewer | commit, branch, build time visible to any member (V-037) |
| `csp-report` | POST: public | see §1 |

## 7. Core business routes — A3 matrix (159 routes)

Copied from A3's findings. Notation: `GET:viewer/apikey` = minimum role viewer, also accepts an API key (supervisor rank, rate-limited per key). Rows whose *Notes* say **FIXED A3-nn** were changed by this remediation; map them to register IDs with the *Source IDs* column of [VULNERABILITY_REGISTER.md](VULNERABILITY_REGISTER.md) (A3-01 → V-038, A3-02 → V-039, A3-03 → V-040, A3-04 → V-041, A3-05 → V-043, A3-06 → V-042, A3-07 → V-045, A3-08 → V-046, A3-09 → V-047, A3-10 → V-048, A3-11 → V-051, A3-12 → V-049, A3-13 → V-050, A3-14 → V-052, A3-15 → V-053, A3-16 → V-054, A3-17 → V-055, A3-18 → V-056). Changes made after A3 wrote this matrix:
- `messages/ai-suggest` POST is now **agent**, and agents are limited to their assigned chats (⚑ V-116).
- The broadcast, header-media and send paths now require the caller's own `account-<id>` folder (⚑ V-043).
- `files/[...path]` serves unrecorded legacy files only under the single-business rule (⚑ V-044).
- `automations` webhook steps are blocked on dev/preview (rounds 6–7).
- `integrations`, `integrations/[id]` and `integrations/[id]/sync`: `auth_config` is now sealed at rest; a redacted echo from a client keeps the stored credentials (⚑ V-060).
- A3's "FIXED A3-06" on broadcast routes refers to page-access checks added in the same pass.

| Path | Methods: auth / min role | Tenant-scoped | Validation | Rate limit | Notes |
|---|---|---|---|---|---|
| `contacts` | GET:viewer/apikey; POST:agent/apikey | Y | fields allow-listed | API key only |  |
| `contacts/sync-check` | GET:admin; POST:admin | Y | fields allow-listed | - |  |
| `contacts/[id]/ai-tags` | GET:viewer; POST:agent | Y | fields allow-listed | - |  |
| `contacts/[id]` | GET:viewer/apikey; DELETE:agent/apikey; PATCH:agent/apikey | Y | fields allow-listed | API key only |  |
| `contacts/[id]/telegram-link` | GET:agent | Y | fields allow-listed | - |  |
| `contacts/[id]/notes` | GET:viewer; POST:agent | Y | fields allow-listed | - |  |
| `contacts/[id]/notes/[noteId]` | DELETE:agent | Y | fields allow-listed | - |  |
| `contacts/[id]/channels` | GET:viewer | Y | fields allow-listed | - |  |
| `contacts/[id]/timeline` | GET:viewer | Y | fields allow-listed | - |  |
| `contacts/[id]/leads` | GET:viewer/apikey | Y | fields allow-listed | API key only |  |
| `contacts/[id]/leads/history` | GET:viewer/apikey | Y | fields allow-listed | API key only |  |
| `contacts/[id]/block` | POST:agent; DELETE:agent | Y | fields allow-listed | - |  |
| `contacts/[id]/restore` | POST:agent/apikey | Y | fields allow-listed | API key only |  |
| `contacts/[id]/delete-impact` | GET:member(any) | Y | fields allow-listed | - |  |
| `contacts/[id]/tags` | GET:viewer; PUT:agent; POST:agent; DELETE:agent | Y | fields allow-listed | - |  |
| `contacts/[id]/custom-values` | GET:viewer; PUT:agent | Y | fields allow-listed | - |  |
| `contacts/import` | POST:agent | Y | fields allow-listed | Y |  |
| `contacts/import/check` | POST:agent | Y | fields allow-listed | Y |  |
| `contacts/merge` | POST:agent/apikey | Y | fields allow-listed | API key only |  |
| `contacts/duplicates` | GET:agent/apikey | Y | fields allow-listed | API key only |  |
| `contacts/duplicates/merge` | POST:agent/apikey | Y | fields allow-listed | API key only |  |
| `contacts/check-duplicate` | GET:agent | Y | fields allow-listed | - |  |
| `data-tables` | GET:viewer/apikey; POST:supervisor/apikey | Y | fields allow-listed | Y | FIXED A3-01 (POST supervisor) |
| `data-tables/[id]/ai` | PUT:admin; GET:viewer; POST:admin | Y | fields allow-listed | Y |  |
| `data-tables/[id]` | GET:viewer; PUT:supervisor; DELETE:admin | Y | fields allow-listed | - | FIXED A3-01 (PUT supervisor) |
| `data-tables/[id]/records` | GET:viewer/apikey; POST:agent/apikey | Y | fields allow-listed | Y | FIXED A3-01, A3-16 media values; pageSize<=500 |
| `data-tables/[id]/records/[recordId]` | PUT:agent/apikey; DELETE:agent/apikey | Y | fields allow-listed | Y | FIXED A3-01, A3-16 |
| `data-tables/[id]/find-row` | POST:admin | Y | fields allow-listed | - |  |
| `data-tables/[id]/field-values` | GET:dataStoreMember'viewer' | Y | fields allow-listed | - | FIXED A3-01 (viewer, via requireRole) |
| `data-tables/[id]/form` | GET:admin; PUT:admin; POST:admin | Y | fields allow-listed | - |  |
| `data-tables/[id]/form/translate` | GET:admin; POST:admin | Y | fields allow-listed | Y |  |
| `data-tables/[id]/sheet-routes` | GET:admin; POST:admin; PUT:admin | Y | fields allow-listed | - |  |
| `data-tables/[id]/sheet-routes/[routeId]` | PATCH:admin; DELETE:admin | Y | fields allow-listed | - |  |
| `data-tables/[id]/sheet-routes/actions` | POST:admin | Y | fields allow-listed | Y |  |
| `data-tables/[id]/health` | GET:viewer; POST:agent | Y | fields allow-listed | - |  |
| `data-tables/[id]/import` | GET:viewer; POST:agent | Y | fields allow-listed | - | FIXED A3-01 (POST agent) |
| `data-tables/[id]/alerts` | GET:admin; PUT:admin | Y | fields allow-listed | - |  |
| `data-tables/[id]/fields/[fieldId]` | PUT:supervisor; DELETE:supervisor | Y | fields allow-listed | - | FIXED A3-01 (supervisor) |
| `data-tables/[id]/fields` | PUT:supervisor; POST:supervisor | Y | fields allow-listed | - | FIXED A3-01 (supervisor) |
| `data-tables/[id]/google-sheet` | all:admin (shared guard) | Y | fields allow-listed | - |  |
| `data-tables/[id]/google-sheet/browse` | GET:admin | Y | fields allow-listed | - |  |
| `data-tables/[id]/google-sheet/instant` | GET:admin | Y | fields allow-listed | - |  |
| `data-tables/from-sheet` | POST:admin | Y | fields allow-listed | Y |  |
| `leads` | GET:viewer/apikey; POST:agent/apikey | Y | fields allow-listed | API key only | FIXED A3-09 assignee check |
| `leads/views` | GET:agent; POST:agent; DELETE:agent | Y | fields allow-listed | - |  |
| `leads/funnel` | GET:supervisor | Y | fields allow-listed | - |  |
| `leads/follow-up` | POST:agent/apikey | Y | fields allow-listed | API key only |  |
| `leads/[id]` | GET:viewer/apikey; PATCH:agent/apikey; DELETE:admin/apikey | Y | fields allow-listed | API key only | FIXED A3-09 ownership + refs |
| `leads/bulk` | POST:agent | Y | fields allow-listed | - |  |
| `leads/settings` | GET:agent; PATCH:supervisor | Y | fields allow-listed | - |  |
| `leads/merge` | POST:agent | Y | fields allow-listed | - |  |
| `leads/ai-accuracy` | GET:agent | Y | fields allow-listed | - |  |
| `leads/duplicates` | GET:agent | Y | fields allow-listed | - |  |
| `leads/ai-review` | POST:agent | Y | fields allow-listed | - |  |
| `broadcasts/demo-template` | GET:viewer/apikey+page | Y | fields allow-listed | API key only | FIXED A3-06 |
| `broadcasts/audience-count` | POST:viewer/apikey+page | Y | fields allow-listed | API key only |  |
| `broadcasts` | GET:viewer/apikey+page; POST:agent/apikey+page | Y | fields allow-listed | Y | FIXED A3-05 header media; A3-11 rate limit |
| `broadcasts/[id]` | GET:viewer/apikey+page; PATCH:agent/apikey+page; DELETE:agent/apikey+page | Y | fields allow-listed | API key only | FIXED A3-06 page |
| `broadcasts/[id]/rescue` | POST:agent/apikey+page | Y | fields allow-listed | Y | FIXED A3-06, A3-11 |
| `broadcasts/[id]/process` | POST:agent/apikey+page | Y | fields allow-listed | Y | FIXED A3-06, A3-11 |
| `broadcasts/[id]/retry` | POST:agent/apikey+page | Y | fields allow-listed | Y | FIXED A3-06, A3-11 |
| `broadcasts/[id]/export` | GET:viewer/apikey+page | Y | fields allow-listed | API key only | FIXED A3-06 page; A3-17 formula-safe |
| `broadcasts/[id]/outcomes` | GET:viewer/apikey+page | Y | fields allow-listed | API key only |  |
| `broadcasts/[id]/outcomes/tag` | POST:agent/apikey+page | Y | fields allow-listed | API key only |  |
| `broadcasts/[id]/recipients` | PATCH:agent/apikey+page | Y | fields allow-listed | API key only | FIXED A3-06 |
| `broadcasts/settings` | GET:viewer/apikey+page; PUT:admin/apikey+page | Y | fields allow-listed | API key only |  |
| `broadcasts/table-values` | GET:agent/apikey+page | Y | fields allow-listed | API key only |  |
| `broadcasts/draft` | POST:agent+page | Y | fields allow-listed | - | FIXED A3-05, A3-06 page |
| `broadcasts/parse-excel` | POST:agent/apikey+page | Y | fields allow-listed | API key only | FIXED A3-06 |
| `conversations` | GET:viewer | Y | fields allow-listed | - |  |
| `conversations/[id]` | GET:viewer; PATCH:agent | Y | fields allow-listed | - | FIXED A3-12 assignee member + unread_count |
| `conversations/[id]/assign` | POST:agent | Y | fields allow-listed | - | FIXED A3-12 |
| `conversations/[id]/reactions` | GET:viewer | Y | fields allow-listed | - |  |
| `conversations/[id]/messages` | GET:viewer | Y | fields allow-listed | - |  |
| `conversations/new-chat` | GET:member(country only); POST:agent | Y | fields allow-listed | Y | FIXED A3-13 (POST agent) |
| `conversations/unread` | GET:member(any) | Y | fields allow-listed | - |  |
| `messages/[id]` | DELETE:agent | Y | fields allow-listed | - | FIXED A3-13 agent + own chat + id from DB |
| `messages/[id]/ai-sources` | GET:admin | Y | fields allow-listed | - |  |
| `messages/translate` | POST:agent | Y | fields allow-listed | Y | A3-18 error text |
| `messages/ai-suggest` | POST:member(any) | Y | fields allow-listed | Y | A3-18; getCurrentAccount (any role) + per-user RL |
| `pipelines` | GET:viewer/apikey+page; POST:admin/apikey+page | Y | fields allow-listed | API key only |  |
| `pipelines/[id]` | GET:viewer/apikey; PATCH:admin/apikey; DELETE:admin/apikey | Y | fields allow-listed | API key only |  |
| `pipelines/[id]/stages` | POST:admin/apikey; PUT:admin/apikey | Y | fields allow-listed | API key only |  |
| `pipelines/[id]/stages/[stageId]` | PATCH:admin/apikey; DELETE:admin/apikey | Y | fields allow-listed | API key only | FIXED A3-07 (A4-05) IDOR |
| `deals` | GET:viewer/apikey; POST:agent/apikey | Y | fields allow-listed | API key only | FIXED A3-10 refs |
| `deals/[id]` | PATCH:agent/apikey; DELETE:agent/apikey | Y | fields allow-listed | API key only | FIXED A3-10 refs + stage in pipeline |
| `tasks` | GET:viewer; POST:agent | Y | fields allow-listed | - | FIXED A3-10 |
| `tasks/[id]` | PATCH:agent; DELETE:agent | Y | fields allow-listed | - | FIXED A3-10 |
| `tags` | GET:viewer; POST:agent | Y | fields allow-listed | - |  |
| `tags/[id]` | DELETE:admin; PATCH:admin | Y | fields allow-listed | - |  |
| `segments` | GET:viewer; POST:agent | Y | fields allow-listed | - |  |
| `segments/[id]` | GET:viewer; PATCH:agent; DELETE:agent | Y | fields allow-listed | - |  |
| `custom-fields` | GET:viewer; POST:agent | Y | fields allow-listed | - |  |
| `custom-fields/[id]` | DELETE:admin | Y | fields allow-listed | - |  |
| `contact-lists` | GET:viewer/apikey+page; POST:agent/apikey+page | Y | fields allow-listed | API key only |  |
| `contact-lists/[id]` | GET:viewer/apikey+page; PATCH:agent/apikey+page; DELETE:agent/apikey+page | Y | fields allow-listed | API key only |  |
| `contact-lists/[id]/export` | GET:viewer/apikey+page | Y | fields allow-listed | API key only | A3-17 formula-safe |
| `contact-lists/[id]/members` | DELETE:agent/apikey+page | Y | fields allow-listed | API key only |  |
| `reports/catalog` | GET:supervisor+page | Y | fields allow-listed | - |  |
| `reports/export` | POST:supervisor+page | Y | fields allow-listed | Y |  |
| `reports/run` | POST:supervisor+page | Y | fields allow-listed | Y |  |
| `reports/saved` | GET:supervisor+page; POST:supervisor+page; DELETE:supervisor+page | Y | fields allow-listed | Y |  |
| `dashboard` | GET:viewer | Y | fields allow-listed | - |  |
| `dashboard/performance` | GET:agent | Y | fields allow-listed | - |  |
| `file-manager` | GET:agent | Y | fields allow-listed | - |  |
| `file-manager/[id]/scan-result` | POST:validScanSignature | n/a | fields allow-listed | - | scanner callback: HMAC sig of file id, timing-safe |
| `file-manager/[id]` | GET:agent; DELETE:agent | Y | fields allow-listed | - |  |
| `file-manager/upload` | POST:agent | Y | fields allow-listed | - |  |
| `file-manager/sync` | POST:agent | Y | fields allow-listed | - |  |
| `upload` | POST:agent | Y | fields allow-listed | - | FIXED A3-15 random names |
| `files/[...path]` | GET:member, own account folder | Y | fields allow-listed | - | FIXED A3-06b traversal + legacy owner + headers |
| `lead-activities` | GET:viewer; POST:agent | Y | fields allow-listed | - | FIXED A3-10 |
| `follow-ups` | GET:viewer/apikey; POST:agent/apikey | Y | fields allow-listed | API key only |  |
| `follow-ups/[id]` | PATCH:agent/apikey; DELETE:agent/apikey | Y | fields allow-listed | API key only |  |
| `follow-ups/[id]/outcome` | POST:agent/apikey | Y | fields allow-listed | API key only |  |
| `follow-ups/due` | GET:agent | Y | fields allow-listed | - |  |
| `offers` | GET:member(any) | Y | fields allow-listed | - |  |
| `offers/cron` | GET:CRON_SECRET | n/a | fields allow-listed | - | cron secret, timing-safe |
| `offers/[id]` | PATCH:agent | Y | fields allow-listed | - |  |
| `judgements` | GET:member(any) | Y | fields allow-listed | - |  |
| `judgements/[id]` | PATCH:agent | Y | fields allow-listed | - |  |
| `judgements/accuracy` | GET:member(any) | Y | fields allow-listed | - |  |
| `service-categories` | GET:member(any); PUT:admin | Y | fields allow-listed | - |  |
| `service-categories/suggest` | POST:admin | Y | fields allow-listed | Y |  |
| `scheduled-messages/contacts-summary` | GET:viewer | Y | fields allow-listed | - |  |
| `scheduled-messages` | GET:viewer; POST:agent | Y | fields allow-listed | - |  |
| `scheduled-messages/cron` | GET:CRON_SECRET | n/a | fields allow-listed | - | cron secret, timing-safe |
| `scheduled-messages/[id]` | PATCH:agent; DELETE:agent | Y | fields allow-listed | - |  |
| `automations` | GET:viewer+page; POST:agent+page | Y | fields allow-listed | - | FIXED A3-04 (+page /automations) |
| `automations/cron` | GET:CRON_SECRET | n/a | fields allow-listed | - | cron secret, timing-safe (FIXED A3-14) |
| `automations/[id]/last-error` | GET:viewer+page | Y | fields allow-listed | - | FIXED A3-04 |
| `automations/[id]` | GET:viewer+page; PATCH:agent+page; DELETE:agent+page | Y | fields allow-listed | - | FIXED A3-04; scoped user_id+account_id |
| `automations/[id]/duplicate` | POST:agent+page | Y | fields allow-listed | - | FIXED A3-04; account scope added |
| `automations/[id]/logs` | GET:viewer | Y | fields allow-listed | - |  |
| `automations/engine` | POST:admin | Y | fields allow-listed | - |  |
| `alerts/template-fields` | GET:admin; PUT:admin | Y | fields allow-listed | - |  |
| `alerts/test` | POST:admin | Y | fields allow-listed | Y |  |
| `push/subscribe` | POST:viewer; DELETE:viewer | Y | fields allow-listed | - |  |
| `push/vapid` | GET:public / member | n/a | fields allow-listed | - | public key public; ?generate=1 any session (fresh random keys only) |
| `catalog/config` | GET:agent; PUT:owner; DELETE:owner | Y | fields allow-listed | - |  |
| `catalog/discover` | POST:owner | Y | fields allow-listed | - |  |
| `catalog/products` | GET:agent; POST:agent | Y | fields allow-listed | - |  |
| `catalog/products/[id]` | PUT:agent; DELETE:agent | Y | fields allow-listed | - |  |
| `catalog/products/sync` | POST:agent | Y | fields allow-listed | - |  |
| `company-profile` | GET:viewer; PUT:admin | Y | fields allow-listed | - |  |
| `sheet-verifications` | GET:supervisor+page; POST:admin+page | Y | fields allow-listed | - |  |
| `sheet-verifications/[id]` | GET:supervisor+page; PATCH:admin+page; DELETE:admin+page | Y | fields allow-listed | - |  |
| `sheet-verifications/[id]/actions` | POST:supervisor+page | Y | fields allow-listed | - | A3-18 |
| `sheet-verifications/[id]/people` | GET:supervisor+page | Y | fields allow-listed | - |  |
| `forms/[token]/logo` | GET:FORM_TOKEN | n/a | fields allow-listed | Y | public: form token, per-IP limit, account file by id, raster only |
| `forms/[token]` | POST:FORM_TOKEN | n/a | fields allow-listed | Y | public: form token + per-IP/per-form/rows limits, 64KB cap |
| `database/backup` | GET:platform owner | n/a | fields allow-listed | - | isPlatformOwner only (FIXED A3-08) |
| `v/[token]` | POST:readLink | n/a | fields allow-listed | Y | public: HMAC-signed link (132-bit), per-IP/per-link limits |
| `external/webhook` | POST:public secret | n/a | fields allow-listed | Y | public: ?secret= (lead_settings.webhook_secret), per-IP limit |
| `integrations` | GET:viewer/apikey+page; POST:admin/apikey+page | Y | fields allow-listed | API key only | FIXED A3-03 secrets redacted |
| `integrations/[id]` | GET:viewer/apikey+page; PATCH:admin/apikey; DELETE:admin/apikey | Y | fields allow-listed | API key only | FIXED A3-03 redacted + page check |
| `integrations/[id]/ingest` | POST:supervisor/apikey | Y | fields allow-listed | API key only |  |
| `integrations/[id]/sync` | POST:agent/apikey | Y | fields allow-listed | API key only | FIXED A3-02 via integration-fetch |
| `integrations/test` | POST:admin/apikey | Y | fields allow-listed | API key only | FIXED A3-02 safeFetch |

## 8. Appendix — automated scan of all 335 route files

Produced by a grep of each `route.ts` at `f9b10c4`: the exported HTTP methods, the guard helpers found in the file, the role names passed to those helpers anywhere in the file (not per method), whether `checkRateLimit` appears, and whether the file changed since `pre-security-audit`. **This is a heuristic inventory, not a review.**
- "none detected" means only that none of the known helper names appear. Most of those routes authenticate in another way (see §1). For example, voice routes check `VOICE_AGENT_SECRET` through a helper, webchat uses session tokens, `auth/mfa/*` checks credentials, and the NextAuth catch-all is handled by NextAuth.
- The "Roles referenced" column lists every role string in the file, so a file with `viewer/agent` typically reads at viewer and writes at agent.
- Sections 1–7 are authoritative where they disagree with this appendix.

| Path | Methods | Auth detected | Roles referenced | Rate limit | Changed |
|---|---|---|---|---|---|
| `account` | GET/PATCH | session+role | admin | Y |  |
| `account/agents` | POST | session+role | admin | - | changed |
| `account/capture-config` | GET/PATCH | session+role | viewer/admin | - |  |
| `account/invitations` | GET/POST | session+role | admin | Y | changed |
| `account/invitations/[id]` | DELETE | session+role | admin | Y |  |
| `account/members` | GET | session | - | - |  |
| `account/members/[userId]` | PATCH/DELETE | session+role | admin | Y | changed |
| `account/members/[userId]/password` | POST | session+role | admin | Y | changed |
| `account/mfa` | GET | session | - | - |  |
| `account/mfa/disable` | POST | session | - | Y |  |
| `account/mfa/enroll/confirm` | POST | session | - | Y | changed |
| `account/mfa/enroll/start` | POST | session | - | Y | changed |
| `account/profile/email/verify/start` | POST | session | - | Y |  |
| `account/profile/phone/verify/confirm` | POST | session | - | Y |  |
| `account/profile/phone/verify/start` | POST | session | - | Y |  |
| `account/session-settings` | GET/PATCH | session | - | Y |  |
| `account/sessions` | GET | session | - | - |  |
| `account/sessions/[id]` | DELETE | session | - | Y | changed |
| `account/sign-out-everywhere` | POST | session | - | Y |  |
| `account/transfer-ownership` | POST | session+role | owner | Y | changed |
| `admin-chat` | GET/PUT | session+role | admin | - |  |
| `admin-chat/actions/[id]` | POST | session+role | admin | - |  |
| `admin-chat/members` | POST | session+role | admin | - |  |
| `admin-chat/members/[id]` | PATCH/DELETE | session+role | admin | - |  |
| `admin-chat/sessions` | POST | session+role | admin | - |  |
| `admin/setup-flows-key` | GET | session+role | owner | - | changed |
| `ai-config` | GET/PUT/DELETE | session+role | - | - |  |
| `ai-config/accuracy-rules` | GET/PUT | session+role | admin | - |  |
| `ai-config/admin-test` | POST | session+role | admin | Y |  |
| `ai-config/embedding-model` | GET/PUT | session+role | admin | Y |  |
| `ai-config/eval` | GET/POST | session+role | admin | Y |  |
| `ai-config/handover` | GET/PUT | session+role | admin | - |  |
| `ai-config/image-reading` | GET/PUT | session+role | admin | - |  |
| `ai-config/live-voice` | POST | session+role | admin | Y |  |
| `ai-config/test` | POST | session+role | owner | Y |  |
| `ai-config/tts-credentials` | GET/POST/DELETE | session+role | admin | - |  |
| `ai-knowledge` | GET/POST | session+role | - | - |  |
| `ai-knowledge/[id]` | GET/PATCH/DELETE | session+role | viewer/admin | - |  |
| `ai-knowledge/sync` | POST | session+role | admin | Y |  |
| `ai-knowledge/upload` | POST | session+role | admin | Y |  |
| `ai-quality` | GET | session+role | agent | - |  |
| `ai-usage` | GET | session+role | admin | - |  |
| `alerts/template-fields` | GET/PUT | session+role | admin | - |  |
| `alerts/test` | POST | session+role | admin | Y |  |
| `api-keys` | GET/POST | API key, session+role | owner | - | changed |
| `api-keys/[id]` | DELETE | API key, session+role | owner | - | changed |
| `auth/[...nextauth]` | ? | none detected | - | - |  |
| `auth/mfa/start` | POST | none detected | - | Y |  |
| `auth/mfa/verify` | POST | none detected | - | Y |  |
| `auth/password` | POST | session+role | viewer | - | changed |
| `auth/register` | POST | none detected | - | - | changed |
| `auth/verify-email` | GET | none detected | - | - |  |
| `automations` | GET/POST | session+role | viewer/agent | - | changed |
| `automations/[id]` | GET/PATCH/DELETE | session+role | viewer/agent | - | changed |
| `automations/[id]/duplicate` | POST | session+role | agent | - | changed |
| `automations/[id]/last-error` | GET | session+role | viewer | - | changed |
| `automations/[id]/logs` | GET | session+role | viewer | - |  |
| `automations/cron` | GET | cron secret | - | - | changed |
| `automations/engine` | POST | session+role | admin | - |  |
| `broadcasts` | GET/POST | API key, session+role | viewer/agent | Y | changed |
| `broadcasts/[id]` | GET/PATCH/DELETE | API key, session+role | viewer/agent | - | changed |
| `broadcasts/[id]/export` | GET | API key, session+role | viewer | - | changed |
| `broadcasts/[id]/outcomes` | GET | API key, session+role | viewer | - |  |
| `broadcasts/[id]/outcomes/tag` | POST | API key, session+role | agent | - |  |
| `broadcasts/[id]/process` | POST | API key, session+role | agent | Y | changed |
| `broadcasts/[id]/recipients` | PATCH | API key, session+role | agent | - | changed |
| `broadcasts/[id]/rescue` | POST | API key, session+role | agent | Y | changed |
| `broadcasts/[id]/retry` | POST | API key, session+role | agent | Y | changed |
| `broadcasts/audience-count` | POST | API key, session+role | viewer | - |  |
| `broadcasts/demo-template` | GET | API key, session+role | viewer | - | changed |
| `broadcasts/draft` | POST | session+role | agent | - | changed |
| `broadcasts/parse-excel` | POST | API key, session+role | agent | - | changed |
| `broadcasts/settings` | GET/PUT | API key, session+role | viewer/admin | - |  |
| `broadcasts/table-values` | GET | API key, session+role | agent | - |  |
| `call-config` | GET/PUT | session+role | agent/admin | - | changed |
| `calls` | GET | session+role | agent | - |  |
| `calls/[id]` | GET | session+role | agent | - |  |
| `calls/[id]/respond` | POST | session+role | agent | - |  |
| `catalog/config` | GET/PUT/DELETE | session+role | agent/owner | - |  |
| `catalog/discover` | POST | session+role | owner | - |  |
| `catalog/products` | GET/POST | session+role | agent | - |  |
| `catalog/products/[id]` | PUT/DELETE | session+role | agent | - |  |
| `catalog/products/sync` | POST | session+role | agent | - |  |
| `chatbot` | GET/POST | session+role | - | - | changed |
| `chatbot/[id]` | GET/PUT/PATCH/DELETE | session+role | admin | - | changed |
| `chatbot/[id]/node-activity` | GET | session+role | agent | - |  |
| `chatbot/cron` | GET | cron secret | - | - |  |
| `company-profile` | GET/PUT | session+role | viewer/admin | - |  |
| `contact-lists` | GET/POST | API key, session+role | viewer/agent | - |  |
| `contact-lists/[id]` | GET/PATCH/DELETE | API key, session+role | viewer/agent | - |  |
| `contact-lists/[id]/export` | GET | API key, session+role | viewer | - | changed |
| `contact-lists/[id]/members` | DELETE | API key, session+role | agent | - |  |
| `contacts` | GET/POST | API key, session+role | viewer/agent | - |  |
| `contacts/[id]` | GET/PATCH/DELETE | API key, session+role | viewer/agent | - |  |
| `contacts/[id]/ai-tags` | GET/POST | session+role | viewer/agent | - |  |
| `contacts/[id]/block` | POST/DELETE | session+role | agent | - |  |
| `contacts/[id]/channels` | GET | session+role | viewer | - |  |
| `contacts/[id]/custom-values` | GET/PUT | session+role | viewer/agent | - |  |
| `contacts/[id]/delete-impact` | GET | session | - | - |  |
| `contacts/[id]/leads` | GET | API key, session+role | viewer | - |  |
| `contacts/[id]/leads/history` | GET | API key, session+role | viewer | - |  |
| `contacts/[id]/notes` | GET/POST | session+role | viewer/agent | - |  |
| `contacts/[id]/notes/[noteId]` | DELETE | session+role | agent | - |  |
| `contacts/[id]/restore` | POST | API key, session+role | agent | - |  |
| `contacts/[id]/tags` | GET/POST/PUT/DELETE | session+role | viewer/agent | - |  |
| `contacts/[id]/telegram-link` | GET | session+role | agent | - |  |
| `contacts/[id]/timeline` | GET | session+role | viewer | - |  |
| `contacts/check-duplicate` | GET | session+role | agent | - |  |
| `contacts/duplicates` | GET | API key, session+role | agent | - |  |
| `contacts/duplicates/merge` | POST | API key, session+role | agent | - |  |
| `contacts/import` | POST | session+role | agent | Y |  |
| `contacts/import/check` | POST | session+role | agent | Y |  |
| `contacts/merge` | POST | API key, session+role | agent | - |  |
| `contacts/sync-check` | GET/POST | session+role | admin | - |  |
| `conversations` | GET | session+role | viewer | - |  |
| `conversations/[id]` | GET/PATCH | session+role | viewer/agent | - | changed |
| `conversations/[id]/assign` | POST | session+role | agent | - | changed |
| `conversations/[id]/messages` | GET | session+role | viewer | - |  |
| `conversations/[id]/reactions` | GET | session+role | viewer | - |  |
| `conversations/new-chat` | GET/POST | session+role | agent | Y | changed |
| `conversations/unread` | GET | session | - | - |  |
| `csp-report` | POST | none detected | - | - |  |
| `custom-fields` | GET/POST | session+role | viewer/agent | - |  |
| `custom-fields/[id]` | DELETE | session+role | admin | - |  |
| `dashboard` | GET | session+role | viewer | - |  |
| `dashboard/performance` | GET | session+role | agent | - |  |
| `data-tables` | GET/POST | API key, session+role | viewer | Y | changed |
| `data-tables/[id]` | GET/PUT/DELETE | session+role | admin | - | changed |
| `data-tables/[id]/ai` | GET/POST/PUT | session+role | viewer/admin | Y | changed |
| `data-tables/[id]/alerts` | GET/PUT | session+role | admin | - |  |
| `data-tables/[id]/field-values` | GET | session+role | viewer | - | changed |
| `data-tables/[id]/fields` | POST/PUT | session+role | supervisor | - | changed |
| `data-tables/[id]/fields/[fieldId]` | PUT/DELETE | session+role | supervisor | - | changed |
| `data-tables/[id]/find-row` | POST | session+role | admin | - |  |
| `data-tables/[id]/form` | GET/POST/PUT | session+role | admin | - |  |
| `data-tables/[id]/form/translate` | GET/POST | session+role | admin | Y |  |
| `data-tables/[id]/google-sheet` | GET/POST/PUT/PATCH/DELETE | session+role | admin | - | changed |
| `data-tables/[id]/google-sheet/browse` | GET | session+role | admin | - |  |
| `data-tables/[id]/google-sheet/instant` | GET | session+role | admin | - |  |
| `data-tables/[id]/health` | GET/POST | session+role | viewer/agent | - |  |
| `data-tables/[id]/import` | GET/POST | session+role | - | - | changed |
| `data-tables/[id]/records` | GET/POST | API key, session+role | - | Y | changed |
| `data-tables/[id]/records/[recordId]` | PUT/DELETE | API key, session+role | agent | Y | changed |
| `data-tables/[id]/sheet-routes` | GET/POST/PUT | session+role | admin | - |  |
| `data-tables/[id]/sheet-routes/[routeId]` | PATCH/DELETE | session+role | admin | - |  |
| `data-tables/[id]/sheet-routes/actions` | POST | session+role | admin | Y |  |
| `data-tables/from-sheet` | POST | session+role | admin | Y |  |
| `database/backup` | GET | session, platform owner | - | - | changed |
| `deals` | GET/POST | API key, session+role | viewer/agent | - | changed |
| `deals/[id]` | PATCH/DELETE | API key, session+role | agent | - | changed |
| `email/attachments` | POST | session+role | agent | Y |  |
| `email/config` | GET/POST/DELETE | session+role | owner | - | changed |
| `email/microsoft/callback` | GET | session+role | admin | - |  |
| `email/microsoft/config` | GET/PUT/DELETE | session+role | admin | - |  |
| `email/microsoft/connect` | GET | session+role | admin | - |  |
| `email/microsoft/notify` | POST | signature/HMAC | - | Y |  |
| `email/webhook/[secret]` | POST | URL secret | - | Y |  |
| `external/webhook` | POST | URL secret | - | Y |  |
| `facebook/config` | GET/PATCH | session+role | owner | - | changed |
| `facebook/profile` | GET/PATCH | session+role | owner | - | changed |
| `facebook/profile/photo` | POST | session+role | owner | - | changed |
| `facebook/webhook` | GET/POST | signature/HMAC | - | - | changed |
| `file-manager` | GET | session+role | agent | - |  |
| `file-manager/[id]` | GET/DELETE | session+role | agent | - |  |
| `file-manager/[id]/scan-result` | POST | signature/HMAC | - | - |  |
| `file-manager/sync` | POST | session+role | agent | - |  |
| `file-manager/upload` | POST | session+role | agent | - |  |
| `files/[...path]` | GET | session | - | - | changed |
| `flows` | GET/POST | session+role | - | - | changed |
| `flows/[id]` | GET/PUT/DELETE | session+role | admin | - | changed |
| `flows/[id]/activate` | POST | session+role | - | - | changed |
| `flows/[id]/endpoint` | GET/POST | session+role | - | - | changed |
| `flows/[id]/last-error` | GET | session | - | - |  |
| `flows/[id]/publish` | POST | session+role | - | - | changed |
| `flows/[id]/runs` | GET | session | - | - |  |
| `flows/[id]/screens` | GET | session | - | - |  |
| `flows/[id]/upload` | GET/POST | session+role | - | - | changed |
| `flows/[id]/webhook` | GET/POST | session+role, signature/HMAC | admin | - | changed |
| `flows/cron` | GET | cron secret | - | - |  |
| `flows/data-exchange/[flowId]/[screenId]` | POST | signature/HMAC | - | - | changed |
| `flows/keys` | GET/POST | session+role | admin | - | changed |
| `flows/keys/upload` | POST | session+role | admin | - | changed |
| `flows/sync` | POST | session+role | agent | - | changed |
| `flows/templates` | GET | session | - | - |  |
| `follow-ups` | GET/POST | API key, session+role | viewer/agent | - |  |
| `follow-ups/[id]` | PATCH/DELETE | API key, session+role | agent | - |  |
| `follow-ups/[id]/outcome` | POST | API key, session+role | agent | - |  |
| `follow-ups/due` | GET | session+role | agent | - |  |
| `forms/[token]` | POST | URL token | - | Y |  |
| `forms/[token]/logo` | GET | URL token | - | Y |  |
| `google/calendar` | GET/POST/PUT | session+role | admin | - |  |
| `google/callback` | GET | session+role | admin | - |  |
| `google/config` | GET/POST/PUT/DELETE | session+role | admin | - |  |
| `google/connect` | GET | session+role | admin | - |  |
| `google/contacts` | GET/POST | session+role | admin | - |  |
| `google/drive` | GET/POST | session+role | agent | - |  |
| `google/forms` | GET/POST | session+role | admin | - |  |
| `google/forms/[id]` | POST/PATCH/DELETE | session+role | admin | - |  |
| `google/picker` | GET | session+role | agent | - |  |
| `google/services` | POST | session+role | admin | - |  |
| `google/sheet-ping` | POST | none detected | - | Y |  |
| `google/sheets` | GET | session+role | admin | - |  |
| `google/sheets/create` | POST | session+role | admin | Y |  |
| `google/sheets/preview` | GET | session+role | admin | - |  |
| `google/sheets/step-test` | POST | session+role | admin | Y |  |
| `heartbeat` | POST | session | - | - | changed |
| `instagram/config` | GET/PATCH | session+role | owner | - | changed |
| `instagram/ice-breakers` | GET/PATCH/DELETE | session+role | owner | - | changed |
| `instagram/profile` | GET | session+role | owner | - | changed |
| `instagram/webhook` | GET/POST | signature/HMAC | - | - | changed |
| `integrations` | GET/POST | API key, session+role | viewer/admin | - | changed |
| `integrations/[id]` | GET/PATCH/DELETE | API key, session+role | viewer/admin | - | changed |
| `integrations/[id]/ingest` | POST | API key, session+role | supervisor | - |  |
| `integrations/[id]/sync` | POST | API key, session+role | agent | - |  |
| `integrations/test` | POST | API key, session+role | admin | - |  |
| `invitations/[token]/peek` | GET | URL token | - | Y |  |
| `invitations/[token]/redeem` | POST | session, URL token | - | Y | changed |
| `judgements` | GET | session | - | - |  |
| `judgements/[id]` | PATCH | session+role | agent | - |  |
| `judgements/accuracy` | GET | session | - | - |  |
| `lead-activities` | GET/POST | session+role | viewer/agent | - | changed |
| `leads` | GET/POST | API key, session+role | viewer/agent | - | changed |
| `leads/[id]` | GET/PATCH/DELETE | API key, session+role | viewer/agent/admin | - | changed |
| `leads/ai-accuracy` | GET | session+role | agent | - |  |
| `leads/ai-review` | POST | session+role | agent | - |  |
| `leads/bulk` | POST | session+role | agent | - |  |
| `leads/duplicates` | GET | session+role | agent | - |  |
| `leads/follow-up` | POST | API key, session+role | agent | - |  |
| `leads/funnel` | GET | session+role | supervisor | - |  |
| `leads/merge` | POST | session+role | agent | - |  |
| `leads/settings` | GET/PATCH | session+role | agent/supervisor | - |  |
| `leads/views` | GET/POST/DELETE | session+role | agent | - |  |
| `mcp` | GET/POST/DELETE | API key | - | Y |  |
| `me` | GET | session | - | - |  |
| `messages/[id]` | DELETE | session+role | agent | - | changed |
| `messages/[id]/ai-sources` | GET | session+role | admin | - |  |
| `messages/ai-suggest` | POST | session+role | agent | Y | changed |
| `messages/translate` | POST | session+role | agent | Y | changed |
| `meta-ads/audiences` | GET/POST | session+role | viewer/agent | Y |  |
| `meta-ads/config` | GET/POST/DELETE | session+role | viewer/owner | Y |  |
| `meta-ads/dashboard` | GET | session+role | viewer | - |  |
| `meta-ads/lead-forms` | GET/POST/PATCH | session+role | viewer/agent | - |  |
| `meta-ads/lead-forms/discover` | GET | session+role | viewer | - | changed |
| `meta-ads/pixel` | GET/POST | session+role | viewer/owner | - |  |
| `meta-ads/track` | POST | URL secret | - | Y |  |
| `meta/embedded-signup` | POST | session+role | owner | - | changed |
| `offers` | GET | session | - | - |  |
| `offers/[id]` | PATCH | session+role | agent | - |  |
| `offers/cron` | GET | cron secret | - | - |  |
| `out-of-scope` | GET/PUT | session+role | admin | - |  |
| `payments/phonepe/webhook` | POST | none detected | - | Y |  |
| `pipelines` | GET/POST | API key, session+role | viewer/admin | - |  |
| `pipelines/[id]` | GET/PATCH/DELETE | API key, session+role | viewer/admin | - |  |
| `pipelines/[id]/stages` | POST/PUT | API key, session+role | admin | - |  |
| `pipelines/[id]/stages/[stageId]` | PATCH/DELETE | API key, session+role | admin | - | changed |
| `platform/meta-config` | GET/PATCH | session+role, platform owner | owner | - | changed |
| `platform/meta-config/public` | GET | session | - | - |  |
| `presence/leave` | POST | session | - | - | changed |
| `profile` | PATCH | session+role | viewer | - |  |
| `profiles` | GET | session+role | viewer | - |  |
| `push/subscribe` | POST/DELETE | session+role | viewer | - |  |
| `push/vapid` | GET | session | - | - |  |
| `razorpay/create-order` | POST | API key, session+role | agent | - | changed |
| `razorpay/save-payment` | POST | API key, session+role | agent | - | changed |
| `razorpay/verify-payment` | POST | API key, session+role | agent | - | changed |
| `rcs/config` | GET/POST/DELETE | session+role | owner | - | changed |
| `rcs/webhook` | POST | signature/HMAC | - | - | changed |
| `realtime/ticket` | GET | session+role | viewer | - |  |
| `reports/catalog` | GET | session+role | supervisor | - |  |
| `reports/export` | POST | session+role | supervisor | Y |  |
| `reports/run` | POST | session+role | supervisor | Y |  |
| `reports/saved` | GET/POST/DELETE | session+role | supervisor | Y |  |
| `scheduled-messages` | GET/POST | session+role | viewer/agent | - | changed |
| `scheduled-messages/[id]` | PATCH/DELETE | session+role | agent | - |  |
| `scheduled-messages/contacts-summary` | GET | session+role | viewer | - |  |
| `scheduled-messages/cron` | GET | cron secret | - | - |  |
| `segments` | GET/POST | session+role | viewer/agent | - |  |
| `segments/[id]` | GET/PATCH/DELETE | session+role | viewer/agent | - |  |
| `service-categories` | GET/PUT | session+role | admin | - |  |
| `service-categories/suggest` | POST | session+role | admin | Y |  |
| `sheet-verifications` | GET/POST | session+role | supervisor/admin | - |  |
| `sheet-verifications/[id]` | GET/PATCH/DELETE | session+role | supervisor/admin | - |  |
| `sheet-verifications/[id]/actions` | POST | session+role | supervisor | - | changed |
| `sheet-verifications/[id]/people` | GET | session+role | supervisor | - |  |
| `sms/config` | GET/POST/DELETE | session+role | owner | - | changed |
| `sms/config/test-message` | POST | session+role | admin | Y | changed |
| `sms/webhook/[secret]` | GET/POST | URL secret | - | Y |  |
| `social/facebook` | GET | session+role | owner | - | changed |
| `social/instagram` | GET | session+role | owner | - | changed |
| `tags` | GET/POST | session+role | viewer/agent | - |  |
| `tags/[id]` | PATCH/DELETE | session+role | admin | - |  |
| `tasks` | GET/POST | session+role | viewer/agent | - | changed |
| `tasks/[id]` | PATCH/DELETE | session+role | agent | - | changed |
| `telegram/config` | GET/POST/PUT/DELETE | session+role | admin | Y |  |
| `telegram/media/[messageId]` | GET | session+role | viewer | - |  |
| `telegram/webhook/[botId]` | POST | signature/HMAC | - | - |  |
| `upload` | POST | session+role | agent | - | changed |
| `v/[token]` | POST | URL token | - | Y |  |
| `version` | GET | session+role | viewer | - |  |
| `voice/context` | POST | none detected | - | - |  |
| `voice/transcript` | POST | none detected | - | - | changed |
| `webchat/config/[key]` | GET | none detected | - | - |  |
| `webchat/frame/[key]` | GET | none detected | - | - |  |
| `webchat/handoff` | POST | none detected | - | - |  |
| `webchat/messages` | GET/POST | none detected | - | - |  |
| `webchat/session` | POST | none detected | - | - |  |
| `webhooks` | GET/POST | session+role | admin | - | changed |
| `webhooks/[id]` | PUT/DELETE | session+role | admin | - | changed |
| `website-chat` | GET/POST/PUT | session+role | admin | - |  |
| `website-chat/[id]` | PATCH/DELETE | session+role | admin | - |  |
| `website-chat/whatsapp-numbers` | GET | session+role | admin | - |  |
| `whatsapp/broadcast` | POST | session | - | Y | changed |
| `whatsapp/config` | GET/POST/DELETE | session+role | owner | - | changed |
| `whatsapp/config/check-marketing-eligibility` | POST | session+role | owner | - |  |
| `whatsapp/config/direct-send` | POST | session+role | owner | - |  |
| `whatsapp/config/set-default` | POST | session+role | owner | - |  |
| `whatsapp/config/verify-registration` | GET | session | - | - |  |
| `whatsapp/config/webhook-route` | POST | session+role | admin | Y |  |
| `whatsapp/media/[mediaId]` | GET | session | - | - | changed |
| `whatsapp/payments/config` | GET/PUT/DELETE | session+role | owner | - |  |
| `whatsapp/payments/webhook` | POST | signature/HMAC | - | - |  |
| `whatsapp/profile` | GET/PATCH | session+role | admin | - | changed |
| `whatsapp/qr-code` | GET | session | - | - |  |
| `whatsapp/react` | POST | session | - | Y |  |
| `whatsapp/send` | POST | API key, session | - | Y | changed |
| `whatsapp/send-otp` | POST | session+role | agent | Y |  |
| `whatsapp/send-payment-request` | POST | session+role | agent | - |  |
| `whatsapp/templates` | GET | session+role | viewer | - |  |
| `whatsapp/templates/[id]` | PATCH/DELETE | session+role | supervisor | - | changed |
| `whatsapp/templates/submit` | POST | session+role | supervisor | - | changed |
| `whatsapp/templates/suggest` | POST | session+role | supervisor | Y |  |
| `whatsapp/templates/sync` | POST | session+role | supervisor | - | changed |
| `whatsapp/test-message` | POST | session | - | - |  |
| `whatsapp/validate-contacts` | POST | API key, session+role | agent | - |  |
| `whatsapp/webhook` | GET/POST | signature/HMAC | - | Y | changed |
