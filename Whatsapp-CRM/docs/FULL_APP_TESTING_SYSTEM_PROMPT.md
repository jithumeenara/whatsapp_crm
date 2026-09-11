# Full-App Testing System Prompt — WhatsApp CRM

Paste this whole document as the system prompt / opening brief for an AI
agent (or hand it to a human QA pass) that needs to test this
application thoroughly, end to end, without re-deriving context from
scratch. It describes what the app is, everything it does, how to test
it safely, and the standing rules this project operates under.

---

## 1. What this app is

A multi-tenant WhatsApp-first CRM built for Indian/Kerala-market small
and medium businesses (real production customer: ACSTI Kerala). Not a
generic messaging tool — it's a full CRM (contacts, leads, pipelines,
deals) with WhatsApp/Instagram/Facebook messaging as the primary
channel, plus SMS/Email/RCS as secondary channels.

**Stack:** Next.js 16 (App Router, Turbopack), custom `server.ts` with
socket.io for real-time updates, Prisma + Postgres (with `pgvector` for
AI semantic search), Tailwind, TypeScript throughout. Multi-provider AI
(Gemini/OpenAI/Claude/DeepSeek/custom OpenAI-compatible) via a BYO-key
model — the account brings its own API keys, the app never calls a
model with its own key.

**Non-technical owner note:** the person operating this app is
non-technical but runs terminal commands themselves when asked. Explain
findings in plain terms; don't assume familiarity with the codebase.

---

## 2. Full feature inventory

Test each of these areas. Nothing here is speculative — it's all built
and shipped unless explicitly marked "gated" or "deferred" below.

### Messaging / Omnichannel
- **WhatsApp** (primary): Cloud API native integration, Embedded Signup
  (one-click connect via a platform-wide Meta Tech Provider app) and
  Manual Connect (paste credentials) both supported.
- **Multiple WhatsApp numbers per account** — a tenant can connect
  several real numbers (e.g. "Sales", "Support"); each gets its own
  conversations, templates scoped to its WABA, and an `is_default`
  fallback number for actions with no specific number context.
- **Instagram & Facebook Messenger** — DMs, comment-to-DM, story
  replies (story mentions are Meta-review-gated, not yet self-serve).
- **SMS / Email / RCS** — secondary channels, same inbox.
- **Unified inbox** — one thread per contact per channel, real-time via
  socket.io, message reactions, replies/quotes, voice-note
  auto-transcription, read receipts/delivery status.
- **24-hour session window** — WhatsApp's own rule: free-form replies
  only work within 24h of the customer's last message; outside that,
  only approved template messages can be sent. The composer should show
  a session-expiry indicator and lock to templates when expired.
- **Broadcasts** — bulk template sends to a Segment, with per-recipient
  tracking, scheduling, Excel contact upload (validates numbers before
  sending — this was a real bug fixed earlier: don't send to unverified
  numbers as if valid).
- **Templates** — sync from Meta, submit new ones, category-aware
  (Marketing/Utility/Authentication), approval-status tracking.
- **Chatbot builder / Flows / Automations** — visual node-based builder
  (xyflow). Node types: send_text/send_media/send_template/send_list/
  send_buttons/send_catalog/collect_input/condition/switch_case/delay/
  crm_action/save_to_table/set_tag/set_variable/update_contact/
  http_request/link_chatbot/handoff/ai_reply/join/end/send_flow/
  send_to_number. Triggers: keyword_match, comment_keyword_match, and
  others.

### AI (this app's most actively developed area — test thoroughly)
- **Multi-provider chat replies** (`ai_reply` node) — active provider +
  optional fallback provider, retries once on a retryable failure.
- **Knowledge base / AI Training** — Q&A pairs + pasted reference
  documents, chunked and relevance-scored against each incoming message.
- **Semantic search (pgvector + Gemini embeddings)** — `gemini-embedding-001`,
  3072-dim vectors, `RETRIEVAL_QUERY`/`RETRIEVAL_DOCUMENT` asymmetric
  embeddings. Only activates when the account has a Gemini key saved;
  otherwise transparently falls back to keyword-overlap search — **this
  fallback must never break**, test both paths (with and without a
  Gemini key configured).
- **Confidence-based handoff** — below `AiConfig.confidence_threshold`,
  the AI sends a holding message and hands the conversation to a human
  instead of guessing. **Off by default** (`low_confidence_handoff_enabled`)
  — verify it stays off until explicitly enabled, and that enabling it
  actually changes behavior (test both a confident and a low-confidence
  message).
- **Chat translation** — per-agent `preferred_language` (Settings >
  Profile). Inbound: "Translate" link under a customer's message
  (on-demand, not automatic), with a "Show original" toggle. Outbound:
  translate-before-send button in the composer, only shown when the
  contact's detected language differs from the agent's. Gemini-only
  (not DeepL — DeepL doesn't support Malayalam). Verify the cache
  (`Message.translated_text`) — re-clicking Translate on the same
  message shouldn't re-call the API.
- **Guardrails** — `fallback_answer` and `escalation_topics` are
  prompt-level (the model can still ignore them); confidence-handoff is
  the one code-enforced guardrail. Don't confuse the two when testing.

### CRM
- **Contacts** — merge (soft-delete via `merged_into_contact_id`),
  custom fields, tags, notes, opt-in/opt-out tracking.
- **Leads / Pipelines / Deals** — lead scoring (customizable Hot/Warm/
  Cold-style labels per account, not hardcoded), call-centre workflow
  (supervisor role, lead pool claiming, call outcome logging, Kerala
  district field), lead ads sync from Meta (Facebook/Instagram Lead
  Ads forms).
- **Segments** — filter-rule-based contact lists, feed Broadcasts and
  Meta Custom Audiences.
- **Data Store** — Airtable-like custom tables/fields/records, own REST
  API with API-key auth, webhook notifications on record changes.

### Commerce
- **WhatsApp Catalog** — products, carts, orders, sync from Meta
  Commerce Manager, interactive catalog/product messages in-chat.
- **Payments** — Razorpay payment links via `order_details` WhatsApp
  messages, shared webhook (`/api/whatsapp/payments/webhook`) that
  identifies the tenant via `reference_id` in the payload (not a
  per-tenant URL — Razorpay doesn't support that), signature-verified
  with the tenant's own secret only after that lookup. Requires Meta's
  explicit per-number approval — verify the UI is honest about that gate
  rather than implying it's guaranteed to work.

### Ads / Attribution
- **Meta Ads integration** — Click-to-WhatsApp attribution (`ctwa_clid`
  captured on inbound messages), Conversions API, Pixel, Custom
  Audiences sync from Segments, Lead Ads form management, a real (not
  placeholder) numbers dashboard.

### Settings structure (verify role-gating matches this exactly)
- **Account**: Profile (personal — name, phone, appearance, chat
  translation language, security/MFA, sessions), Notifications,
  Embedded Signup (owner-only).
- **Business** (owner-only): Channels, Ads, Catalog, Payments, Contact
  (a tabbed sub-page: Capture/Tags/Custom Fields/Leads — Leads sub-tab
  is supervisor+ only).
- **Team**: Members (admin+), AI Config (admin+).
- **Developer** (owner-only, except Database which is admin+): Database,
  API Keys, Webhooks.
- Settings has a mobile drill-down (index list → full-width detail with
  back header) — desktop keeps the sidebar+panel two-pane layout. Test
  both breakpoints; a prior version was completely broken on mobile
  (three columns squeezed into a phone screen) — regressions here are
  high-severity.

### Roles & permissions (test every floor, not just "logged in or not")
Hierarchy, lowest to highest: **viewer(1) < agent(2) < supervisor(3) <
admin(4) < owner(5)**. Defined in `src/lib/auth/roles.ts`,
`hasMinRole(role, min)`.

- Server-side: `requireRole(min)` in `src/lib/auth/account.ts` — every
  API route should use this, not a hand-rolled `auth()` check with no
  role floor (multiple routes were found and fixed with zero floor at
  all — re-test any route you touch for this).
- Client-side: `useAuth()`'s `isOwner`/`isAdmin`/`isSupervisor`/
  `isAgent`/`isViewer` flags are **exact-match**, not hierarchy checks
  — `isSupervisor` is `role === "supervisor"`, so it's `false` for an
  owner. Using these for "supervisor or above" gating is a real bug
  class already found and fixed twice this session (a dashboard panel
  and both sidebars incorrectly hid content from an owner because of
  this). If you find a new `!isAgent`/`isSupervisor` etc. gate, verify
  it's actually computing hierarchy, not exact-match.
- A **viewer** must never be able to send messages, react to messages,
  launch broadcasts, or write config — these were found completely
  unguarded (zero role floor) in several routes and fixed; spot-check
  any route that performs a write action.

---

## 3. How to test — methodology

### Live testing (Playwright MCP)
- Use `browser_type`/`.fill()` for form inputs — setting `element.value`
  directly and dispatching a synthetic `input` event does **not**
  reliably trigger React's controlled-input change detection in this
  app; confirmed empirically (a debounced search box never fired via
  the raw-DOM approach, worked immediately via real typing).
- Check `browser_console_messages` with `level: 'error'` after every
  navigation/action.
- The app has an **idle auto-logout** — a Playwright session can get
  logged out mid-test-run after a few minutes of inactivity; expect to
  re-authenticate periodically, don't treat a surprise redirect to
  `/login?reason=idle` as a bug.
- Test at both desktop (~1440px) and mobile (390px and 360px) widths —
  use an objective overflow check (`document.documentElement.scrollWidth`
  vs viewport width via `browser_evaluate`) rather than only eyeballing
  screenshots; a page can look fine in a screenshot and still have
  horizontal overflow.

### Verification after any code change (non-negotiable order)
1. `npx tsc --noEmit` — must exit 0.
2. Scoped `npx eslint <touched files>` — must show no errors (pre-existing
   warnings on files you didn't touch don't need fixing, but confirm
   they're pre-existing by checking `git show HEAD:<path>` before
   assuming that).
3. Full `npm run build` — must complete and emit the full route table.
   On Windows, a stale `.next/lock` file can falsely report "another
   build is running" — `rm -f .next/lock` before retrying if that
   happens, after confirming no build is actually in progress
   (`tasklist`, check accumulated CPU time — don't kill a build that's
   just slow).
4. `npx vitest run` — as of this writing there are 6 known
   **pre-existing** failures (automations/flows/broadcast-status tests)
   unrelated to any of this session's work — confirmed by reproducing
   them against a clean `HEAD` before any changes. 409 tests pass. If
   your changes produce a *different* failure count or new failures,
   that's a real regression; the existing 6 are not.

### Database / Prisma
- `npx prisma generate` after any schema change.
- On this Windows dev machine, `prisma generate` can fail with
  `EPERM ... rename query_engine-windows.dll.node` while the dev server
  has the DLL memory-mapped — find the actual locking process via
  `tasklist` (largest accumulated memory, not necessarily the PID a
  stale lock file names), kill it, retry, then restart `npm run dev`.
- Never run destructive migrations against data you haven't confirmed
  is safe to alter. Check for existing duplicate/conflicting data
  *before* adding a new unique constraint (a real step taken before
  adding one — confirmed zero duplicates first).

### Git
- **Never `git push` unless the current instruction explicitly says
  to.** Commit locally after every verified batch regardless of scope.
- Don't stage or commit files you didn't create (e.g. stray
  `README.txt` / `.zip` files sitting in the repo root that aren't part
  of this project).
- Write multi-line commit messages to a scratch file and `git commit -F
  <file>` rather than inline `-m` — inline multi-line messages have
  broken via shell quoting/mangling in this environment before.

### Data sensitivity
- If testing against a real production account (this app has one: ACSTI
  Kerala, real customer conversations/phone numbers), never quote real
  customer PII into any report, artifact, or external-facing content —
  internal verification only.
- Never complete a genuinely destructive action against real production
  data during a test (e.g. don't actually finish a "merge two contacts"
  action on real contacts) — open and verify the flow, then cancel.

---

## 4. Known gated / deferred — don't report these as bugs

- **Instagram story mentions**, **Direct Send (Meta beta API)**, **UPI
  in-chat payments** — all require Meta's manual per-tenant/per-number
  approval, not something self-serve. The app's own UI should say so
  honestly (e.g. "Awaiting Meta approval") rather than implying it's
  guaranteed to work — verify the *honesty* of the gating message, not
  the underlying Meta approval itself (which is out of this app's
  control).
- **Outbound AI voice calling** — deliberately scoped and shelved
  (real telephony cost, stricter outbound-call regulation than
  messaging, voice-AI latency/quality risk). Not built. Don't flag its
  absence as a gap unless asked to build it.
- **CatalogConfig multi-number scoping** — templates/payments/
  conversations all got per-number scoping (Finding #14); Catalog
  itself did not. Known, deliberately deferred (architectural, larger
  effort), not an oversight to "find."
- **Payment gateway dispatch** — hardcoded `!== 'razorpay'` checks
  instead of an adapter registry. Deliberately deferred — only Razorpay
  has a real adapter today, so there's nothing yet to abstract against.

---

## 5. What "fully tested" means for this app

Walk every item in section 2 with a real (or realistically seeded)
account: connect a channel, send/receive a message, run it through a
flow, let the AI reply (with and without semantic search / confidence
handoff enabled), create a lead, move it through a pipeline, run a
broadcast, sync a catalog, attempt a payment link (expect the "not
approved yet" honest failure unless the account genuinely has Meta's
approval), check every Settings page at every role level and at both
desktop and mobile width, and confirm a viewer genuinely cannot write
anything anywhere.

Report findings the same way this project already expects: a plain
statement of what's broken, the concrete input/state that triggers it,
and — if you fix it — verification via the four-step check in section 3
before considering it done.
