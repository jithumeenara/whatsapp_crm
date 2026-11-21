-- 173: AI chat summaries on the lead page (docs/plans/lead-tags-and-ai-summary-plan.md).
--
-- One row per lead and focus ('' = the whole chat; otherwise a topic such
-- as 'fees'). A refresh overwrites the same row, so a double click never
-- leaves two. text_en is the English summary; translations holds the
-- cached copies by language code ({"ml": "...", "hi": "..."}) so a second
-- request for the same language never calls the model again.
--
-- Derived data: it goes with its lead or account. The person who made it
-- is kept with ON DELETE RESTRICT, like every other link to users
-- (migration 132: deleting a user never removes business data).
--
-- 168–172 are taken by the Messenger/Instagram work. Safe to run twice.

CREATE TABLE IF NOT EXISTS lead_summaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  focus           TEXT NOT NULL DEFAULT '',
  text_en         TEXT NOT NULL,
  translations    JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_count   INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  model           TEXT,
  feedback        TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_summaries_focus_len CHECK (char_length(focus) <= 60),
  CONSTRAINT lead_summaries_feedback_ok CHECK (feedback IS NULL OR feedback IN ('up', 'down'))
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_summaries_lead_focus ON lead_summaries (lead_id, focus);
CREATE INDEX IF NOT EXISTS lead_summaries_account ON lead_summaries (account_id);
