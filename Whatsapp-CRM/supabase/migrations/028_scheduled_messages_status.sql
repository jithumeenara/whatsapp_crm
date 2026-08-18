-- Adds explicit failure/expiry tracking to scheduled_messages so a send
-- error doesn't retry silently forever, and the UI can show a real status
-- (Pending / Completed / Paused / Cancelled / Failed / Expired) instead of
-- just "active".

ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS error_count INT NOT NULL DEFAULT 0;
