-- Telling somebody when a new person writes in for the first time.
--
-- The handoff alert (085) covers the assistant giving up. This covers
-- the opposite end: a number nobody has seen before starts a
-- conversation. For a business that treats every new enquiry as a lead,
-- that first message is the moment worth knowing about — and it is
-- currently visible only to whoever happens to have the Inbox open.
--
-- Off by default. An account that gets hundreds of new contacts a day
-- should not be woken by all of them without asking.
ALTER TABLE contact_capture_configs
  ADD COLUMN IF NOT EXISTS new_contact_alert_enabled boolean NOT NULL DEFAULT false;

-- E.164 numbers as a JSON array of strings.
ALTER TABLE contact_capture_configs
  ADD COLUMN IF NOT EXISTS new_contact_alert_numbers jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The name of an approved Utility template.
--
-- Same 24-hour rule as every other business-initiated message: without
-- a template the alert only reaches a staff member who messaged this
-- business number within the last day, and silently reaches nobody
-- otherwise. See src/lib/ai/handoff-alert.ts for the full explanation.
ALTER TABLE contact_capture_configs
  ADD COLUMN IF NOT EXISTS new_contact_alert_template text;
