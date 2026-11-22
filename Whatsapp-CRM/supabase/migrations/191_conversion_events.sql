-- 191: Results sent back to Meta — one pipeline for every channel.
--
--   conversion_settings  per workspace: on/off, the stage names sent to
--                        Meta for Lead Ads (Conversion Leads), the Lead Ads
--                        dataset id, and datasets made for Messenger Pages.
--   conversion_events    one row per event (outbox + send log): what was
--                        sent, to which target, its status, the attempts and
--                        a plain-words error. (account_id, event_id) is
--                        unique, so the same result is never queued twice.
--
-- Holds Meta ids only (ctwa_clid, Page-scoped id, Lead Ads lead id) — no
-- phone numbers, no names, no tokens. Safe to run twice.

CREATE TABLE IF NOT EXISTS conversion_settings (
  account_id      UUID        PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  stage_names     JSONB       NOT NULL DEFAULT '{"raw":"Lead","qualified":"Qualified","won":"Converted","lost":"Lost"}'::jsonb,
  crm_dataset_id  TEXT        CHECK (crm_dataset_id IS NULL OR crm_dataset_id ~ '^[0-9]{5,30}$'),
  datasets        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_by      UUID        REFERENCES users(id) ON DELETE RESTRICT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversion_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target           TEXT        NOT NULL CHECK (target IN ('business_messaging', 'crm')),
  channel          TEXT        CHECK (channel IS NULL OR channel IN ('whatsapp', 'instagram', 'messenger')),
  stage            TEXT        NOT NULL CHECK (stage IN ('raw', 'qualified', 'won', 'lost')),
  event_name       TEXT        NOT NULL,
  event_id         TEXT        NOT NULL,
  record_kind      TEXT        NOT NULL CHECK (record_kind IN ('lead', 'deal')),
  record_id        UUID        NOT NULL,
  payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts         INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, event_id)
);
CREATE INDEX IF NOT EXISTS conversion_events_due_idx ON conversion_events (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS conversion_events_account_time_idx ON conversion_events (account_id, created_at DESC);
