-- Reports (Moments): saved report sentences, and a record of every export.
--
-- saved_reports holds the sentence a report is, as JSON — never results,
-- so a saved report always shows today's numbers. report_exports is the
-- audit trail for data leaving the system: who exported what, when.
-- Both are also created by the app on first use (src/lib/reports/store.ts)
-- for a server whose migrations lag; safe to run again.

CREATE TABLE IF NOT EXISTS saved_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  name        text NOT NULL,
  spec        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_reports_account
  ON saved_reports (account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS report_exports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  format      text NOT NULL,
  title       text NOT NULL,
  spec        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_exports_account
  ON report_exports (account_id, created_at DESC);
