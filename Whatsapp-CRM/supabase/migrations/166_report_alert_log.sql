-- 166: red alerts from the Performance guide (phase F3, plan §8 decision 6:
-- to owners and supervisors). One row per issue per business per day: the
-- sweep inserts the row first (ON CONFLICT DO NOTHING) and sends only when
-- it won the insert — so an issue is announced once a day, even with two
-- server processes ("twice is once").
--
-- code is the guide card's stable code (e.g. never_contacted,
-- broadcast_failed:<name>), never customer data. Safe to run twice.

CREATE TABLE IF NOT EXISTS report_alert_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code        text        NOT NULL,
  -- business-time day
  sent_on     date        NOT NULL,
  recipients  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_alert_log_code_len') THEN
    ALTER TABLE report_alert_log ADD CONSTRAINT report_alert_log_code_len CHECK (char_length(code) BETWEEN 1 AND 200);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS report_alert_log_once_a_day ON report_alert_log (account_id, code, sent_on);
