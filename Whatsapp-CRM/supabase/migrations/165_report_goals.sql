-- 165: goals for the Reports (phase F2, plan §8 decision 4: owners and
-- admins set them). "50 won this month for the team", "attended 60% this
-- week for one person". Progress is worked out at report time from the
-- same numbers the reports show; nothing here is updated by a sweep.
--
-- user_id NULL = the whole team. One goal per metric, period and person
-- (or team) — the unique index treats "team" as one value.
-- Links to users are ON DELETE RESTRICT (migration 132). Safe to run twice.

CREATE TABLE IF NOT EXISTS report_goals (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid          NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- leads | won | calls | attended_pct | first_reply_min | revenue
  metric      text          NOT NULL,
  -- week | month (the running week / month, business time)
  period      text          NOT NULL,
  target      numeric(14,2) NOT NULL,
  user_id     uuid          REFERENCES users(id) ON DELETE RESTRICT,
  created_by  uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_goals_metric_check') THEN
    ALTER TABLE report_goals ADD CONSTRAINT report_goals_metric_check
      CHECK (metric IN ('leads', 'won', 'calls', 'attended_pct', 'first_reply_min', 'revenue'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_goals_period_check') THEN
    ALTER TABLE report_goals ADD CONSTRAINT report_goals_period_check CHECK (period IN ('week', 'month'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_goals_target_check') THEN
    ALTER TABLE report_goals ADD CONSTRAINT report_goals_target_check CHECK (target > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS report_goals_one_per_scope
  ON report_goals (account_id, metric, period, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS report_goals_account_idx ON report_goals (account_id);
