-- 194: A monthly spending limit for the AI, per workspace.
--
-- ai_usage_events already records what every AI call cost (an estimate),
-- but nothing ever stopped spending: a loop, a spam burst or a forgotten
-- setting could run up a bill nobody saw until the invoice. One row per
-- workspace that set a limit:
--   monthly_limit_usd  the limit, in USD (the unit ai_usage_events uses);
--                      no row = no limit, exactly as before
--   warned_month       'YYYY-MM' (business time zone) the 80% warning went out
--   stopped_month      'YYYY-MM' the limit was reached and admins were told
-- At the limit, automatic customer replies stop and conversations go to
-- the team; everything else keeps working. It starts again on the 1st.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS ai_budgets (
  account_id        UUID          PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  monthly_limit_usd NUMERIC(10,2) NOT NULL CHECK (monthly_limit_usd > 0 AND monthly_limit_usd <= 100000),
  warned_month      TEXT          CHECK (warned_month IS NULL OR warned_month ~ '^[0-9]{4}-[0-9]{2}$'),
  stopped_month     TEXT          CHECK (stopped_month IS NULL OR stopped_month ~ '^[0-9]{4}-[0-9]{2}$'),
  updated_by        UUID          REFERENCES users(id) ON DELETE RESTRICT,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Summing this month's spend uses ai_usage_events_account_created_idx
-- (migration 069), so no new index is needed.
