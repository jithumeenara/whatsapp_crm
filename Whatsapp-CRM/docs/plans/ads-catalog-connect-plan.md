# Ads and Catalog connections — plan (2026-11-22)

Status: **proposed, not built.** Waiting for the five decisions at the end.

Sources: three research passes on 2026-11-22 — this codebase (HEAD 478a1ca),
Meta's official docs (Graph/Marketing API v27.0), and eleven competing CRMs'
help centres. Applies to every workspace and industry; nothing is ACSTI-only.

## 1. What is wrong today

1. **The Ads tab and the Catalog tab show the WhatsApp Embedded Signup
   button.** Pressing it re-runs the whole WhatsApp connection
   (`/api/meta/embedded-signup`): subscribes the WABA, **re-registers the
   phone number with a new random PIN** and rewrites `WhatsAppConfig`. A
   business that only wanted to connect ads can disturb its live WhatsApp.
2. **One ad account, one catalog per workspace.** `meta_ads_config` and
   `catalog_config` are one row per workspace (`account_id @unique`) with a
   single `ad_account_id` / `catalog_id` and one token. Embedded Signup takes
   `GET /me/adaccounts` → `data[0]` only; a catalog only if exactly one exists.
3. **Products cannot repeat a SKU across catalogs** — unique key
   `(account_id, retailer_id)` on `catalog_products`.
4. Everything that uses ads data (`/ads` "From click to sale", dashboard,
   spending reports/PDF, custom audiences, CAPI triggers, access check) reads
   the single row. Catalog users (Inbox picker, chatbot `send_catalog`, AI
   `product_catalog` tool, order → deal) also assume one catalog.
5. No tests for catalog routes or order processing.

## 2. What Meta allows (official, Nov 2026)

- Facebook Login for Business configurations can hold **Ad accounts** and
  **Catalogs** as assets; the Business Integration System User token
  (never expires) works for `ads_read`, `ads_management`, `leads_retrieval`,
  `business_management`, `catalog_management`, `pages_*`.
- `ads_read` alone covers insights, spend, ad/creative names. `leads_retrieval`
  pulls in `ads_management` + `pages_manage_ads` + `pages_read_engagement` +
  `pages_show_list` + `business_management`.
- Minimum ad-account task for analytics: **ANALYZE**.
- After login, which assets were shared: `debug_token` → `granular_scopes[].target_ids`
  (fallback `/me/adaccounts`, `/{business}/owned_product_catalogs`).
- **One catalog per WhatsApp Business Account (WABA)**, shared by all its
  numbers. Link: `POST /{waba-id}/product_catalogs {catalog_id}` (WhatsApp
  token). Per number: `POST /{phone-number-id}/whatsapp_commerce_settings`
  (`is_catalog_visible`, `is_cart_enabled`). So "several catalogs" = one per
  WABA, plus catalogs kept for Instagram/Messenger.
- Serving other businesses needs App Review (Advanced Access) and Business
  Verification for these permissions; Marketing API "Full" tier needs
  500 calls / 15 days and < 15 % errors. v27: catalog `/batch` → `items_batch`.

## 3. What competitors do (and how we go further)

Standard (Wati, Gallabox, HubSpot, Gupshup, Sprout): a **separate "Connect ad
account"** button, Facebook login, checkbox picker, several accounts. Best UX
(Gallabox): account switcher, per-connection health badge naming the missing
permission, "Reconfigure", daily sync + rate-limited manual sync. Catalogs:
everyone allows one per WABA; pick from a dropdown; warn that replacing wipes.

We go further:
- One-click per asset type with Meta showing **only** that asset type.
- Per-account health in plain words (active / billing problem / disabled /
  permission missing), last sync time, "Sync now".
- Per-account disconnect, a **default** ad account (nobody documents this).
- Ads ROI across **all** channels (WhatsApp, Instagram, Messenger, Lead Ads)
  with an account filter — not CTWA only.
- Catalog chosen **automatically by the sending number's WABA**; product
  health (missing price / image / out of stock) shown.

## 4. Plan (phases, in order)

### Phase 0 — stop the harm (small, first)
- Remove `EmbeddedSignupButton` from `ads-tab.tsx` and `catalog-tab.tsx`
  (keep the manual forms until Phase 2 replaces them). WhatsApp Embedded
  Signup stops auto-picking `data[0]` ad account / the only catalog.
- Test: the Ads/Catalog tabs never call `/api/meta/embedded-signup`.

### Phase 1 — connect plumbing (reuse the Instagram/Messenger pattern)
- `SocialChannel` gains `'ads' | 'catalog'` (signed in the state, as now).
- `meta_platform_config`: `ads_config_id`, `catalog_config_id` (new migration,
  number agreed with the other session). Settings → Embedded Signup gets two
  more fields with the exact assets/permissions to tick.
- Discovery: `debug_token` granular `target_ids`, validated one by one
  (`act_{id}?fields=name,account_status,currency,timezone_name`;
  `{catalog}?fields=name,product_count`), with the documented fallbacks.
- Chooser: **checkboxes** (several), returns to `tab=ads` / `tab=catalog`.
- Security as today: owner only, rate limit, nonce cookie, appsecret_proof,
  ids accepted only if offered in the session, sealed tokens, audit log.

### Phase 2 — data model (non-destructive)
- `meta_asset_connections` — one per login: kind (ads|catalog), sealed token,
  business id, granted scopes, status, connected_by, timestamps.
- `meta_ad_accounts` — one per ad account: `(account_id, ad_account_id)`
  unique, connection id, name, currency, timezone, account_status,
  `is_default`, last_synced_at, last_error (plain words).
- `meta_catalogs` — one per catalog: `(account_id, catalog_id)` unique,
  connection id, name, product_count, `is_default`, last_synced_at.
- `catalog_products` unique key → `(account_id, catalog_id, retailer_id)`.
- Existing `meta_ads_config` / `catalog_config` rows copied into the new
  tables by the migration (old tables kept, read as fallback, dropped only
  in a later release). Dry-run on `crm_prod_copy`, safe to run twice.

### Phase 3 — ads features on several accounts
- `/ads` "From click to sale", dashboard, spending reports/PDF: loop over
  connected accounts; **account filter**; totals per currency (never add
  different currencies).
- Custom audiences: choose the target ad account (default preselected).
- CAPI dataset stays with the WhatsApp number/WABA (decision 3).
- Health card per account + daily sync + rate-limited "Sync now".
- Lead Ads: per decision 2.

### Phase 4 — catalogs on several WABAs
- Catalog list with sync status, counts, product health.
- Per WABA: "Catalog for this WhatsApp account" picker → Meta link call;
  per number: catalog visible / cart enabled switches; clear warning on
  replace.
- Inbox picker, chatbot `send_catalog`, AI `product_catalog` tool, orders →
  deal: use the catalog of the **sending number's WABA** automatically; the
  products list/API filter by catalog.
- Tests for catalog routes and order processing (none exist today).

### Phase 5 — finish
- `crm-ui-review` + Playwright at 360 px; full suite; App Review checklist
  (`ads_read`, `ads_management`, `leads_retrieval`, `catalog_management`,
  `business_management`; Business Verification); deploy notes
  (migration + `prisma generate`).

### Later (not in this plan)
Shopify / WooCommerce product sync; Instagram/Messenger product messages;
creating Click-to-WhatsApp ads from the CRM.

## 5. Decisions needed

1. **Ads scope:** analytics only (`ads_read` — easiest App Review) or also
   custom audiences + Lead Ads (`ads_management`, `leads_retrieval`)?
   Recommended: analytics first, the rest as a second configuration later.
2. **Lead Ads source:** keep through the Messenger/Page connection (works
   today) — recommended — or move into Connect Ads?
3. **Conversions API dataset:** stay tied to the WhatsApp number (recommended).
4. **Catalog for sending:** automatic by the sending number's WABA
   (recommended) or chosen per message?
5. **Existing ACSTI/Hospital ads + catalog settings:** copy into the new
   tables automatically (recommended)?

---

# v2 — "Ad to revenue": Ads + Catalog + Leads (review after 2 more research passes, 2026-11-22)

## Honest verdict on v1
v1 is a **safe, standard** plan (separate connects, several accounts, health,
default account). That matches the best WhatsApp CRMs (Gallabox, Wati) — it is
**not** ahead of them and not future-proof. Leaders outside the WhatsApp niche
(HubSpot, Triple Whale, Hyros, LeadSquared, Charles) win by **closing the
loop**: real cost per sale per ad, every lead stage sent back to Meta, routing
measured against a reply deadline. Meta's 2025–26 changes push the same way.

## What we already have (good base)
- Conversions API for Business Messaging on qualify / close for WhatsApp and
  Instagram (`src/lib/meta-ads/triggers.ts`, event ids deduped), `ctwa_clid`
  captured, ad attribution across channels (mig 162), lead pool + routing +
  AI tags + AI summary, catalog + carts + orders, UPI / Razorpay / PhonePe.

## Meta facts that change the design (official unless marked)
1. Conversions API for CRM ("Conversion Leads"): send every stage from Raw Lead,
   matched on the 15–17-digit `lead_id`; 2–3+ stages in order; ~3–4 weeks to
   optimise. Chat leads use CAPI-BM events (`LeadSubmitted`, `QualifiedLead`,
   `Purchase`, `Order*`, `CartAbandoned`) with `ctwa_clid` / PSID / IGSID.
2. Meta's own **Automatic Events** already report some WhatsApp leads and
   purchases — ours must not double-count.
3. Insights history is cut (13 / 6 / 37 months) and `7d_view` / `28d_view`
   windows were removed (12 Jan 2026) — keep our own daily snapshots with the
   window stored. (Our code does not use the removed windows — checked.)
4. Ads in **WhatsApp Status / Updates tab** start chats too — a new entry point.
5. **WhatsApp usernames / BSUID** (2026): webhooks may carry no phone number —
   contact matching cannot rely on phone alone. (Separate track.)
6. Embedded Signup v2 deprecated 15 Oct 2026; ES v4 bundles messaging + ads +
   events. **Check which version our WhatsApp signup configuration uses.**
7. Facebook/Instagram Shops checkout and the Commerce Order Management API are
   gone; WhatsApp is the only in-chat checkout. Catalog sync must use
   `items_batch` (`/batch` stops in v27).
8. Meta Business AI may own a thread first; a hand-over event passes control.

## Revised phases

### NOW (P0–P3)
- **P0 Stop the harm** (as v1 Phase 0) + check the ES version of the WhatsApp
  configuration.
- **P1 Connect Ads / Connect Catalog** (v1 Phases 1–2: per-asset one-click,
  several accounts/catalogs, health, default, migrated rows).
- **P2 One conversion-event pipeline (the biggest lever).**
  - Per-workspace stage map: our lead/deal stages → Meta events
    (Raw → `LeadSubmitted`, Qualified → `QualifiedLead`, Won → `Purchase`,
    Lost → CRM stage), for both CAPI-BM (WhatsApp, Instagram, **Messenger**)
    and Conversions API for CRM (Instant Form `lead_id`).
  - An **outbox** table: one row per event, idempotent id, retries with
    back-off, plain-words send log and match-quality health on screen.
  - Skip events Meta's Automatic Events already sent.
- **P3 Cost per qualified lead and cost per sale** per ad / ad set / campaign,
  all channels, all connected ad accounts, per currency; **daily insights
  snapshots** stored with their attribution window.

### NEXT
- **Speed-to-lead routing with a reply deadline:** reassign when the first
  reply is missed, fallback owner, manager alert (extends our lead routing).
- **Lead journey timeline:** ad (incl. Status ads) → chat → call → visit →
  sale on the lead page; capture `lead_id` / `ctwa_clid` / PSID / IGSID /
  placement on first touch.
- **Lead score (rules) + AI "why" panel**, feeding routing and stage events.
- **Spend / cost-per-lead alerts with noise guards** (2 days running + minimum
  spend) and an AI explanation (creative fatigue, slow replies, audience).
- **Catalog health:** Meta diagnostics mirrored, one-click fixes, AI titles /
  descriptions; sync via `items_batch`.
- **Order flow:** `order_details` → `order_status` automation, cart recovery,
  back-in-stock / win-back; order events sent to CAPI-BM.
- **Leads access check:** Page subscribed, `leads_retrieval`, Leads Access
  Manager, Meta test lead received.

### LATER
- Shopify / WooCommerce event-driven sync; AI product recommendations in chat.
- First-click cohort ROI (revenue by month after first contact, break-even).
- Creative analysis; agency roll-ups; side-by-side attribution models.
- BSUID-first contacts; thread control with Meta Business AI; Marketing
  Messages send path + per-message cost.

## Where this beats everyone
WhatsApp CRMs stop at "this lead came from an ad" and send one or two events.
We would send **every stage on every channel** back to Meta (lower cost per
good lead), show **true cost per sale per ad across WhatsApp, Instagram,
Messenger and Lead Ads**, and measure **reply speed** per lead — built on
attribution, routing and commerce we already have.

## Decisions (v2)
1. Start with NOW = P0–P3 in that order? (recommended)
2. Default stage map Raw / Qualified / Won / Lost, editable per workspace?
3. Ads scope: `ads_read` first; audiences + Lead Ads permissions in a second
   configuration later? (recommended)
4. Catalog for sending chosen automatically by the sending number's WABA?
5. Copy existing ads / catalog settings into the new tables automatically?
