# Authorization matrix

Part of the 2026-10 security audit. Index: [README.md](README.md). Per-route detail: [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md).

This matrix shows what the code **enforces** at commit `f9b10c4`, server-side, in the route handlers. It is not what the UI shows. Sources: A2's authorization matrix and rounds 2–5, the role floors from A3/A8/A9, the R4 config sweep, and the reviewer's verdicts.

## 1. Roles

| Role | Rank | Who |
|---|---|---|
| owner | 5 | One per business (`account.owner_user_id`). Can be changed only through **transfer ownership**. |
| admin | 4 | Business administrators |
| supervisor | 3 | Team leads |
| agent | 2 | Front-line staff. They see only their own and pool leads, and only the conversations **assigned to them**. Page access can be restricted further by an admin. |
| viewer | 1 | **Read-only** members |
| API key | acts at **supervisor** rank, as its creator | Owner-minted `wcrm_…` key, bound to its creator and its account |
| platform owner | outside tenants | The server operator (`isPlatformOwner`: `PLATFORM_ADMIN_EMAILS` plus a password hash). Not a tenant role. |

Every member reads and writes only inside their own account (`account_id` from the session or key). Roles and accounts are read from the database on each request (60 s per-process cache, cleared on every role or account change). They are never taken from the JWT or the request body.

**Legend:** ✓ allowed · – refused (403) · **⚑** changed by this remediation (the original behaviour is noted) · "own" = only their own or assigned records.

## 2. Capability matrix

| Capability | viewer | agent | supervisor | admin | owner | API key | Platform owner | Change vs original |
|---|---|---|---|---|---|---|---|---|
| Read contacts, leads, conversations, dashboards (account-scoped) | ✓ | ✓ (leads: own + pool; conversations: assigned) | ✓ | ✓ | ✓ | ✓ (supervisor view) | – | |
| Send messages; write contacts and leads | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | |
| Start a new chat (`conversations/new-chat` POST) | – | ✓ | ✓ | ✓ | ✓ | – | – | ⚑ was any member (V-050) |
| Delete or unsend a message | – | own chats | ✓ | ✓ | ✓ | – | – | ⚑ was any member; channel/id now taken from the DB (V-050) |
| AI reply suggestion (`messages/ai-suggest`) | – | assigned chats only | ✓ | ✓ | ✓ | – | – | ⚑ was any member, any chat (V-116) |
| Take, assign or reassign conversations | – | take unassigned / give back own | ✓ | ✓ | ✓ | – | – | ⚑ agents could take colleagues' chats; assignee must be a member (V-049) |
| Edit or reassign a colleague's lead | – | – (own or pool; assign to self/null) | ✓ | ✓ | ✓ | ✓ | – | ⚑ V-047 |
| Link deals, tasks or activities to records | – | own account's records only | same | same | same | same | – | ⚑ foreign ids were accepted (V-048) |
| Data Store: read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | |
| Data Store: create/update/delete/import rows | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ⚑ was any member (V-038) |
| Data Store: create tables, columns, rename, AI flag | – | – | ✓ | ✓ | ✓ | ✓ | – | ⚑ was any member (V-038) |
| Data Store: delete a table | – | – | – | ✓ | ✓ | – | – | |
| Automations: read | ✓ (+page) | ✓ (+page) | ✓ | ✓ | ✓ | – | – | ⚑ page check added |
| Automations: create, edit, activate, delete, duplicate | – | ✓ (+page `/automations`) | ✓ | ✓ | ✓ | – | – | ⚑ was any member; duplicate was scoped by user, not account (V-041) |
| Flows and chatbots: create, edit, publish, activate, upload | – | ✓ (+page `/flows` or `/chatbot`) | ✓ (+page) | ✓ | ✓ | – | – | ⚑ was any member (V-110) |
| Flows sync | – | ✓ | ✓ | ✓ | ✓ | – | – | ⚑ V-110 |
| Flows key pair: regenerate/upload | – | – | – | ✓ | ✓ | – | – | ⚑ was any member (V-110) |
| Flows key setup (`admin/setup-flows-key`) | – | – | – | – | ✓ | – | – | ⚑ was any member (V-013) |
| Chatbot delete | – | – | – | ✓ | ✓ | – | – | |
| Broadcasts: create, process, retry, rescue | – | ✓ (+page) | ✓ | ✓ | ✓ | ✓ | – | ⚑ rate limit 20/min (V-051); header media must be own files (V-043) |
| Reports | – | – | ✓ (+page) | ✓ | ✓ | – | – | |
| Pipelines and stages: edit | – | – | – | ✓ | ✓ | ✓ | – | ⚑ stage IDOR fixed (V-045) |
| Read files (`/api/files`) | own account folder | same | same | same | same | – | – | ⚑ traversal across tenants fixed (V-042); legacy files only on single-business servers (V-044) |
| Upload, File Manager | – | ✓ | ✓ | ✓ | ✓ | – | – | ⚑ random names (V-053) |
| Send a stored file as media | – | own account's files only | same | same | same | same | – | ⚑ any tenant's file before (V-043) |
| Integrations: read (secrets redacted) | ✓ (+page) | ✓ (+page) | ✓ | ✓ | ✓ | ✓ | – | ⚑ secrets were returned to all (V-040) |
| Integrations: create, edit, test | – | – | – | ✓ | ✓ | ✓ (test) | – | ⚑ URLs fetched through `safeFetch` (V-039) |
| Outgoing webhooks: list | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | |
| Outgoing webhooks: create, update, delete | – | – | – | ✓ | ✓ | – | – | ⚑ was any member (V-091) |
| WhatsApp business profile edit | – | – | – | ✓ | ✓ | – | – | ⚑ was any member (V-098) |
| WhatsApp template sync | – | – | ✓ | ✓ | ✓ | – | – | ⚑ was any member (V-099) |
| SMS test message (paid) | – | – | – | ✓ | ✓ | – | – | ⚑ was any member (V-099) |
| Connect or replace WhatsApp (`whatsapp/config` POST) | – | – | – | – | ✓ | – | – | ⚑ was any member (V-090) |
| Connect or replace email, SMS or RCS provider credentials | – | – | – | – | ✓ | – | – | ⚑ was any member (V-104) |
| See email `inbound_secret` / SMS `webhook_secret` | – | – | – | – | ✓ | – | – | ⚑ was any member (V-104) |
| Facebook/Instagram config, Embedded Signup, payments config, catalog config, AI provider keys | – | – | – | – | ✓ | – | – | |
| Telegram, Google, Microsoft email config; AI sub-settings; call-config | – | – | – | ✓ | ✓ | – | – | call-forward URL must be https and public (⚑ V-093) |
| Invite members, revoke invitations, add agents | – | – | – | ✓ | ✓ | – | – | ⚑ optional email binding (V-014) |
| Change roles, edit, remove, or reset the password of **supervisor/agent/viewer** | – | – | – | ✓ | ✓ | – | – | |
| Do the same to an **admin** | – | – | – | – | ✓ | – | – | ⚑ admins could act on peer admins (V-021) |
| Do the same to the **owner** | – | – | – | – | – | – | – | ⚑ explicit rule (`canActOnMember`) |
| Rename account, out-of-scope, capture config | – | – | – | ✓ | ✓ | – | – | |
| API keys: mint, list, revoke | – | – | – | – | ✓ | – | – | ⚑ was any member (V-002) |
| Transfer ownership | – | – | – | – | ✓ | – | – | |
| Platform Meta App (Embedded Signup app) | – | – | – | – | – | – | ✓ | ⚑ was any tenant owner (V-004) |
| Whole-database backup download | – | – | – | – | – | – | ✓ | (no step-up yet, V-046) |
| Own profile, MFA, sessions, password | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ⚑ MFA cannot be replaced while on (V-012); a password change signs out other devices (V-017) |
| Set own role | never | never | never | never | never | – | – | |
| Real-time ticket (Socket.io) | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ⚑ sockets expire ≤ 15 min and are cut on sign-out or removal (V-011) |

Product notes:
- A few agent-level writes are flagged by the reviewer as **product decisions, not bugs**: `meta-ads/audiences` POST, `catalog/products*`, `file-manager/[id]` DELETE (any file in the account), and `custom-fields` POST.
- The `restrict_to_assigned` setting is stored but not enforced. Agents are always narrowed to their assigned conversations (fails safe).

## 3. Admin-over-admin policy

Enforced by `canActOnMember(actor, target)` in `src/lib/auth/roles.ts` (V-021). Checked on `PATCH /api/account/members/[userId]` (every field, not only the role; editing yourself is exempt), `DELETE /api/account/members/[userId]` and `POST /api/account/members/[userId]/password`.

| Actor ↓ / target → | owner | admin | supervisor | agent | viewer |
|---|---|---|---|---|---|
| owner | – | ✓ | ✓ | ✓ | ✓ |
| admin | – | – ⚑ | ✓ | ✓ | ✓ |
| supervisor and below | – | – | – | – | – |

- Nobody acts on the owner. The owner cannot be removed or demoted. Ownership moves only through transfer.
- `canIssueAgentPassword` still limits password resets to roles below admin, **even for the owner** (A2 did not widen this).
- A member can never change their own role, and no route sets `owner` except transfer. Invitations never grant `owner`.
- Removing a member uses `deactivateMember`: the member's profile moves to a holding account as a viewer, their password hash is cleared, their sessions are invalidated, their sockets are cut and their API keys are soft-revoked. The user is never deleted.

## 4. API key rules

| Rule | Enforcement |
|---|---|
| Who mints, lists and revokes | **Owner only** (`requireRole('owner')`) ⚑ |
| Format and storage | `wcrm_` + 32 random bytes. Stored as SHA-256 and compared with `timingSafeEqual`. Shown once. Bound to `account_id`. |
| Rank | Fixed at **supervisor**, with all pages. A key never reaches admin- or owner-only routes. |
| Acting user | The key's **creator** (`created_by_user_id`). The earlier fallback to the owner or the earliest member is removed. ⚑ |
| Creator must still qualify | Every request checks that the creator's profile is still in the key's account with a role ≥ supervisor. Removal or demotion kills the key. ⚑ |
| Expiry | Optional `expires_at`, in the future and ≤ 365 days ahead; enforced on every request ⚑ |
| Revocation | DELETE is a hard delete. `deactivateMember` sets `revoked_at` (soft). No cache, so a revoked key fails on its next call. ⚑ |
| Creator-less (pre-migration-152) keys | **Refused** in code. Migration 154 records them and soft-revokes them (with a rollback block). Owners see "Older API keys were turned off for security. Create a new key and update your integrations." ⚑ |
| Where keys work | Every consumer goes through `verifyApiKey`: `requireRoleOrApiKey` routes (contacts, leads, deals, follow-ups, broadcasts, contact lists, pipelines, integrations, razorpay …), `data-tables` (3 routes), `whatsapp/send` and `mcp` (read-only tools, 120/min per key) |
| Proxy | A `Bearer wcrm_` header only skips the proxy's session gate on `/api/` paths, and it still runs the idle check when a cookie is present. Every route authenticates the key itself. ⚑ (V-009) |
| Ownership transfer | The old owner becomes admin. Their keys keep working at supervisor rank, which is not an escalation. |
