-- Email: recipients/attachments/format per message, scheduled emails, and
-- a mailbox signature. All nullable additions; safe to run more than once.
-- The app applies the same statements on first use (lib/email/schema.ts).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_meta JSONB;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS email_meta JSONB;
ALTER TABLE microsoft_mailboxes ADD COLUMN IF NOT EXISTS signature TEXT;
