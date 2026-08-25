-- Broadcast scheduling: "send later" (once) and "repeat" (recurring --
-- re-runs the full send to the whole audience again every interval, up to
-- max_sends times or until cancelled). Mirrors scheduled_messages' shape
-- minus stop_on_reply, which has no meaning for a bulk fan-out send.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS schedule_type TEXT NOT NULL DEFAULT 'now';
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS interval_value INTEGER;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS interval_unit TEXT;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS max_sends INTEGER NOT NULL DEFAULT 1;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS sends_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

-- Sweep polls "status = 'scheduled' AND next_send_at <= now()" every minute.
CREATE INDEX IF NOT EXISTS idx_broadcasts_scheduled_due
  ON broadcasts (status, next_send_at)
  WHERE status = 'scheduled';
