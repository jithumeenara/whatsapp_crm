-- 162: which ad each lead came from, on every channel.
--
-- ad_touches: one row each time a customer arrives from a Meta ad — a
-- Click-to-WhatsApp, Click-to-Messenger or Click-to-Instagram-Direct ad
-- (the webhook's referral) or a Lead Ads form. The first touch is also
-- kept on leads.ad_id (migration 158); this table keeps every later one,
-- so a returning customer who clicks a new ad is seen too.
-- Deduped on Meta's own id (message id / leadgen id): a webhook Meta
-- sends twice is stored once.
--
-- ad_catalog: the ad's own name, its ad set and campaign, read once from
-- Meta and kept, so a screen shows "Diwali offer · November leads" and
-- not "120213456789". Never holds customer data.
--
-- Safe to run twice. Additive only.

CREATE TABLE IF NOT EXISTS ad_touches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  -- whatsapp | messenger | instagram | lead_form
  channel         text NOT NULL,
  -- Meta's id for what brought it in: the message id, or the leadgen id.
  external_id     text NOT NULL,
  ad_id           text,
  -- A boosted post instead of an ad (WhatsApp source_type 'post').
  post_id         text,
  source_type     text,
  headline        text,
  click_id        text,
  source_url      text,
  media_url       text,
  touched_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_touches_dedupe ON ad_touches (account_id, channel, external_id);
CREATE INDEX IF NOT EXISTS ad_touches_contact_time ON ad_touches (contact_id, touched_at);
CREATE INDEX IF NOT EXISTS ad_touches_account_ad_time ON ad_touches (account_id, ad_id, touched_at);

CREATE TABLE IF NOT EXISTS ad_catalog (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ad_id            text NOT NULL,
  ad_name          text,
  adset_id         text,
  adset_name       text,
  campaign_id      text,
  campaign_name    text,
  thumbnail_url    text,
  effective_status text,
  -- Why the names are missing (no ad account connected, no permission…).
  error            text,
  fetched_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_catalog_account_ad ON ad_catalog (account_id, ad_id);

-- Reports group leads by ad.
CREATE INDEX IF NOT EXISTS leads_account_ad_created ON leads (account_id, ad_id, created_at) WHERE ad_id IS NOT NULL;
