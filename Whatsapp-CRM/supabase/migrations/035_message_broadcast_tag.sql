-- Broadcast campaigns never wrote a Message row at all (only
-- broadcast_recipients) — a sent campaign was completely invisible in that
-- contact's Inbox thread. broadcast_id tags a message as having come from
-- a specific campaign, so the inbox bubble can render a "Broadcast" badge.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_broadcast_id ON messages (broadcast_id) WHERE broadcast_id IS NOT NULL;
