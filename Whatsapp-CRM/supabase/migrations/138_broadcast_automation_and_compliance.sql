-- Automatic follow-ups, event-based broadcasts, retry of Meta's per-person
-- marketing limit, and the compliance settings (frequency cap, STOP words).
--
--   broadcasts.finished_at
--       When the last send of this broadcast ended — an automatic
--       follow-up waits from here.
--   broadcasts.follow_up_delay_minutes
--       schedule_type 'after_parent': sent this long after the parent
--       finished, to the parent's group (parent_outcome). Recipients are
--       chosen at that moment, so they are the group as it is then.
--   broadcasts.template_category
--       The template's category when it was last sent ('Marketing', …) —
--       the frequency cap counts only marketing messages.
--   broadcasts.event_trigger / event_tag_id / event_delay_minutes
--       schedule_type 'event': stays 'active' and sends to each person
--       when a tag is added to (or removed from) them, once per person,
--       after the delay.
--   broadcasts.send_window
--       'HH:MM-HH:MM' in the business's time zone; automatic sends wait
--       for it. NULL = any time.
--   broadcast_recipients.send_after
--       An event recipient waits until then. NULL = now.
--   broadcast_recipients.auto_retried_at
--       Retried once automatically after Meta's per-person marketing limit
--       (131049) — never twice.
--   broadcast_settings
--       One row per account; no row means the defaults.
--
-- Safe to run again.

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS follow_up_delay_minutes INTEGER;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS template_category TEXT;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS event_trigger TEXT;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS event_tag_id UUID;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS event_delay_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS send_window TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_event_tag_id_fkey') THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_event_tag_id_fkey
      FOREIGN KEY (event_tag_id) REFERENCES tags(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_event_trigger_check') THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_event_trigger_check
      CHECK (event_trigger IS NULL OR event_trigger IN ('tag_added', 'tag_removed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_delays_check') THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_delays_check
      CHECK ((follow_up_delay_minutes IS NULL OR follow_up_delay_minutes BETWEEN 0 AND 43200)
         AND event_delay_minutes BETWEEN 0 AND 43200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_send_window_check') THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_send_window_check
      CHECK (send_window IS NULL OR send_window ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS broadcasts_event_tag_idx ON broadcasts (event_tag_id) WHERE event_tag_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS broadcasts_status_schedule_idx ON broadcasts (status, schedule_type);

ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ;
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS auto_retried_at TIMESTAMPTZ;
-- The frequency cap counts one person's recent sends.
CREATE INDEX IF NOT EXISTS broadcast_recipients_contact_sent_idx ON broadcast_recipients (contact_id, sent_at);

CREATE TABLE IF NOT EXISTS broadcast_settings (
  account_id              UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  frequency_cap_enabled   BOOLEAN NOT NULL DEFAULT true,
  frequency_cap_count     INTEGER NOT NULL DEFAULT 2 CHECK (frequency_cap_count BETWEEN 1 AND 50),
  frequency_cap_days      INTEGER NOT NULL DEFAULT 7 CHECK (frequency_cap_days BETWEEN 1 AND 90),
  stop_keywords_enabled   BOOLEAN NOT NULL DEFAULT true,
  auto_retry_daily_limit  BOOLEAN NOT NULL DEFAULT true,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
