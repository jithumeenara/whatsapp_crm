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
