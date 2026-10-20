-- Admin Chat phase 2: a morning brief and "chats are piling up" alerts,
-- sent to each admin who has them switched on, on their own channel.
--
-- A brief holds counts only (new chats, leads, messages yesterday; waiting
-- and unassigned now) — no names or numbers — and ends "reply ADMIN for
-- details", which opens the usual authenticator-code session.
--
-- WhatsApp only lets a business message someone freely within 24 hours of
-- their last message; outside that, an approved Utility template is
-- needed (brief_template_*, two body variables: name and the summary).
--
--   admin_chat_settings.alert_waiting_threshold  chats waiting for the team
--                       before an alert goes out.
--   admin_chat_members.brief_enabled / brief_minute (minute of the day,
--                       business time) / last_brief_date — one brief a day.
--   admin_chat_members.alerts_enabled / last_alert_at — at most every 3 h.
--   admin_chat_members.last_inbound_at — their last message to the
--                       business (the WhatsApp 24-hour window).
--
-- Safe to run again.

ALTER TABLE admin_chat_settings ADD COLUMN IF NOT EXISTS brief_template_name TEXT;
ALTER TABLE admin_chat_settings ADD COLUMN IF NOT EXISTS brief_template_language TEXT;
ALTER TABLE admin_chat_settings ADD COLUMN IF NOT EXISTS alert_waiting_threshold INTEGER NOT NULL DEFAULT 10;

ALTER TABLE admin_chat_members ADD COLUMN IF NOT EXISTS brief_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admin_chat_members ADD COLUMN IF NOT EXISTS brief_minute INTEGER NOT NULL DEFAULT 540;
ALTER TABLE admin_chat_members ADD COLUMN IF NOT EXISTS last_brief_date DATE;
ALTER TABLE admin_chat_members ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admin_chat_members ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;
ALTER TABLE admin_chat_members ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_chat_settings_alert_check') THEN
    ALTER TABLE admin_chat_settings ADD CONSTRAINT admin_chat_settings_alert_check CHECK (alert_waiting_threshold BETWEEN 1 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_chat_members_brief_minute_check') THEN
    ALTER TABLE admin_chat_members ADD CONSTRAINT admin_chat_members_brief_minute_check CHECK (brief_minute BETWEEN 0 AND 1439);
  END IF;
END $$;
