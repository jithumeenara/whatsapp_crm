-- 192: Our own daily copy of ad spend, per ad and day.
--
-- Meta keeps detailed insights for a limited time (13 months for unique
-- and hourly figures, 37 months for totals) and dropped the 7- and 28-day
-- view windows in January 2026. Reports therefore keep a daily copy: one
-- row per ad account, ad and day, with the attribution setting it came
-- from. Refreshed for the last 7 days every few hours (Meta revises recent
-- days). Numbers only — no names of people, no tokens. Safe to run twice.

CREATE TABLE IF NOT EXISTS ad_insights_daily (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID          NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ad_account_id  TEXT          NOT NULL CHECK (ad_account_id ~ '^[0-9]{1,30}$'),
  ad_id          TEXT          NOT NULL CHECK (ad_id ~ '^[0-9]{1,30}$'),
  day            DATE          NOT NULL,
  spend          NUMERIC(14,2) NOT NULL DEFAULT 0,
  impressions    BIGINT        NOT NULL DEFAULT 0,
  clicks         BIGINT        NOT NULL DEFAULT 0,
  currency       TEXT,
  attribution    TEXT          NOT NULL DEFAULT 'meta_default',
  fetched_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (account_id, ad_account_id, ad_id, day)
);
CREATE INDEX IF NOT EXISTS ad_insights_daily_account_day_idx ON ad_insights_daily (account_id, day);
