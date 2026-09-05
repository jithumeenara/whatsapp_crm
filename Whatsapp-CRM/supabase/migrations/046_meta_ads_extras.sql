-- Meta Ads: Custom Audiences sync (one CRM Segment -> one Meta audience).
CREATE TABLE IF NOT EXISTS meta_custom_audiences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  segment_id        UUID NOT NULL UNIQUE REFERENCES segments(id) ON DELETE CASCADE,
  meta_audience_id  TEXT NOT NULL,
  synced_count      INTEGER NOT NULL DEFAULT 0,
  last_synced_at    TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
