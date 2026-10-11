-- Google Calendar: the business calendar.
--
-- Follow-ups (call-backs, appointments the assistant books) and tasks are
-- written to the connected Google Calendar; a time changed or an event
-- cancelled there comes back. calendar_settings holds the booking rules
-- (slot length, working days and hours, Meet links, what syncs).
--
-- Safe to run again.

ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS calendar_settings JSONB;

ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS google_meet_link TEXT;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS follow_ups_google_event_idx ON follow_ups (account_id) WHERE google_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_google_event_idx ON tasks (account_id) WHERE google_event_id IS NOT NULL;
