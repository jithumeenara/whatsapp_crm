-- 164: reports sent on a schedule (Reports → Scheduled, plan §5 "Schedule
-- ചെയ്ത് അയയ്ക്കൽ", phase F1).
--
-- Who gets it is a list of team members, never free-typed addresses: a
-- business report goes only to people in the business, on their own Admin
-- Chat (WhatsApp / Telegram) and/or their login email. The sweep checks
-- each person's access to the report again at send time.
--
-- "Twice is once": last_sent_key holds the period just sent (e.g.
-- 2026-11-16 for a daily one); the sweep claims it with a conditional
-- update before sending, so two server processes never both send.
--
-- Safe to run twice. created_by keeps ON DELETE RESTRICT (migration 132:
-- deleting a member never deletes business data).

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  report_key     text        NOT NULL,
  -- daily (yesterday) | weekly (last week) | monthly (last month)
  frequency      text        NOT NULL,
  -- weekly: 1 = Monday … 7 = Sunday; monthly: day 1–28
  day            integer     NOT NULL DEFAULT 1,
  -- business time zone, 0–23
  send_hour      integer     NOT NULL DEFAULT 9,
  recipient_ids  uuid[]      NOT NULL DEFAULT '{}',
  by_chat        boolean     NOT NULL DEFAULT true,
  by_email       boolean     NOT NULL DEFAULT false,
  enabled        boolean     NOT NULL DEFAULT true,
  last_sent_key  text,
  last_sent_at   timestamptz,
  last_result    text,
  created_by     uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reports_frequency_check') THEN
    ALTER TABLE scheduled_reports ADD CONSTRAINT scheduled_reports_frequency_check CHECK (frequency IN ('daily', 'weekly', 'monthly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reports_hour_check') THEN
    ALTER TABLE scheduled_reports ADD CONSTRAINT scheduled_reports_hour_check CHECK (send_hour BETWEEN 0 AND 23);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reports_day_check') THEN
    ALTER TABLE scheduled_reports ADD CONSTRAINT scheduled_reports_day_check CHECK (day BETWEEN 1 AND 28);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reports_recipients_check') THEN
    ALTER TABLE scheduled_reports ADD CONSTRAINT scheduled_reports_recipients_check CHECK (cardinality(recipient_ids) <= 50);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS scheduled_reports_account_idx ON scheduled_reports (account_id);
CREATE INDEX IF NOT EXISTS scheduled_reports_enabled_idx ON scheduled_reports (enabled) WHERE enabled;
