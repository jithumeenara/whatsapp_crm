-- Gmail as an Inbox channel: where the mailbox was last read up to.
--
-- gmail_history_id is Gmail's own change counter. Every minute the CRM
-- asks Gmail for what changed since it, so new mail arrives without Pub/Sub
-- (which would need extra Google Cloud setup). Set when "Gmail — full
-- inbox" is first connected: mail from before that is not imported.
--
-- Safe to run again.

ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS gmail_history_id TEXT;
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS gmail_polled_at TIMESTAMPTZ;
