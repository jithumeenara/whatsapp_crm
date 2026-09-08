-- Meta Ads findings MA·02 (72-hour Free Entry Point tracking) and MA·04
-- (Instagram Lead Forms platform tagging) — both additive, no backfill
-- needed (both are forward-only: FEP is set at conversation-origination
-- time going forward, platform is resolved at lead-ingestion time going
-- forward; existing rows simply stay NULL, which correctly reads as
-- "not tracked" for data that predates this feature).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS fep_expires_at TIMESTAMPTZ;

ALTER TABLE lead_ad_submissions
  ADD COLUMN IF NOT EXISTS platform TEXT; -- 'facebook' | 'instagram' | 'mixed' | NULL
