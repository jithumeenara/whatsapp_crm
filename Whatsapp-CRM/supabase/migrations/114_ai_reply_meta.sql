-- Where each AI-written reply came from: the knowledge entries and
-- passages the assistant was given, how well they matched, and the
-- look-ups it made. Shown under the message in the Inbox.
-- Nullable; also applied at start-up by src/lib/ai/reply-sources.ts.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_meta JSONB;
