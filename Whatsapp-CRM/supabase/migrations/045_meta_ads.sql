-- Meta Ads integration: Click-to-WhatsApp attribution + Lead Ads sync.

-- Click-to-WhatsApp attribution — captured once from the referral object
-- on a customer's first message, read later when reporting a real
-- outcome back to Meta via the Conversions API for Business Messaging.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ctwa_clid TEXT,
  ADD COLUMN IF NOT EXISTS ctwa_ad_headline TEXT,
  ADD COLUMN IF NOT EXISTS ctwa_source_id TEXT;

CREATE TABLE IF NOT EXISTS meta_ads_config (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  waba_id                  TEXT NOT NULL,
  ad_account_id            TEXT,
  business_id              TEXT,
  access_token             TEXT NOT NULL,
  dataset_id               TEXT,
  automatic_events_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status                   TEXT NOT NULL DEFAULT 'disconnected',
  last_tested_at           TIMESTAMPTZ,
  test_error               TEXT,
  connected_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_ad_forms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  meta_form_id TEXT NOT NULL UNIQUE,
  page_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_ad_forms_account_idx ON lead_ad_forms(account_id);

CREATE TABLE IF NOT EXISTS lead_ad_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  form_id         UUID NOT NULL REFERENCES lead_ad_forms(id) ON DELETE CASCADE,
  meta_leadgen_id TEXT NOT NULL UNIQUE,
  ad_id           TEXT,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  raw_field_data  JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_ad_submissions_account_created_idx ON lead_ad_submissions(account_id, created_at);
