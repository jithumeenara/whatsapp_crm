-- Capture opt-in properly: no consent/source/timestamp was recorded
-- anywhere on Contact before this. opt_in_status is tri-state; opted_out
-- is reserved for a future inbound-STOP-keyword handler (not built yet —
-- nothing sets it today, so it will only ever be 'unknown' or 'opted_in'
-- for the foreseeable future, but the column exists so that follow-up
-- doesn't need its own migration later).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_in_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_in_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_in_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_opt_in_status_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_opt_in_status_check
  CHECK (opt_in_status IN ('unknown', 'opted_in', 'opted_out'));
