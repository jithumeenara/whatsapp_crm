-- 158: what the new Reports need recorded (docs/plans/reports-plan.md, Phase 0).
--
-- Counting happens on leads; money on Pipeline deals. Today neither keeps
-- enough to answer "when was this won, by whom, for how much, from which
-- ad", so this adds the columns, a deal stage history, the per-business
-- report settings, and the indexes report queries read by.
--
-- Nothing is backfilled: earlier rows stay empty and reports say from
-- which date a figure is complete, rather than guessing the past.
--
-- Safe to run twice. Additive only: no column, row or table is removed.

-- ── Deals: when and why they closed ───────────────────────────────────
ALTER TABLE deals ADD COLUMN IF NOT EXISTS won_at      timestamptz;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_at     timestamptz;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_by   uuid;

-- Every stage or status change of a deal, so a report can say what was
-- in the pipeline on a past date and how long deals sat in each stage.
CREATE TABLE IF NOT EXISTS deal_stage_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id       uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id uuid,
  to_stage_id   uuid,
  from_status   text,
  to_status     text,
  -- The deal's value at the moment of the change.
  value         numeric(12, 2),
  user_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_stage_events_account_time ON deal_stage_events (account_id, created_at);
CREATE INDEX IF NOT EXISTS deal_stage_events_deal_time ON deal_stage_events (deal_id, created_at);

-- ── Leads: who closed it, first reply, where it came from ─────────────
-- Credit for a win goes to whoever closed it, not whoever holds it now.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_by            uuid;
-- The first reply a person (not the bot) sent this lead's contact.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_response_at    timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_response_by    uuid;
-- The reason picked from the business's own list; lost_reason keeps the words.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason_key      text;
-- The Meta ad that brought it (click-to-WhatsApp source_id, or a lead form's ad_id).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_id                text;
-- Which of the business's WhatsApp numbers it came in on.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_config_id   uuid;
-- What the enquiry is about: a service_categories.key of the same account.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS service_category_key text;

-- ── Per-business settings ─────────────────────────────────────────────
-- [{ key, label, order, outcome: open|won|lost }] — the business's own funnel.
ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS funnel_stages   jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Settings → Reports: digest, thresholds, manual ad spend, and so on.
ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS report_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── Links to users never delete business data (migration 132) ─────────
DO $$
DECLARE
  link record;
BEGIN
  FOR link IN
    SELECT * FROM (VALUES
      ('deals', 'closed_by', 'deals_closed_by_fkey'),
      ('deal_stage_events', 'user_id', 'deal_stage_events_user_id_fkey'),
      ('leads', 'closed_by', 'leads_closed_by_fkey'),
      ('leads', 'first_response_by', 'leads_first_response_by_fkey')
    ) AS t(tbl, col, con)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = link.con) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users (id) ON DELETE RESTRICT',
        link.tbl, link.con, link.col);
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_whatsapp_config_id_fkey')
     AND to_regclass('whatsapp_config') IS NOT NULL THEN
    -- A number that is removed leaves its leads; they just lose the link.
    ALTER TABLE leads ADD CONSTRAINT leads_whatsapp_config_id_fkey
      FOREIGN KEY (whatsapp_config_id) REFERENCES whatsapp_config (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Indexes report queries read by ────────────────────────────────────
CREATE INDEX IF NOT EXISTS lead_activities_account_time ON lead_activities (account_id, created_at);
CREATE INDEX IF NOT EXISTS leads_account_converted ON leads (account_id, converted_at) WHERE converted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_account_lost ON leads (account_id, lost_at) WHERE lost_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS deals_account_won ON deals (account_id, won_at) WHERE won_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS deals_account_status ON deals (account_id, status);
