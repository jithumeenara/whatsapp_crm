-- Telling a person, on WhatsApp, when the assistant gives up.
--
-- A handover already writes a note onto the conversation. That note is
-- exactly right for whoever opens the conversation, and reaches nobody
-- who doesn't. A lead that the assistant could not close sits in Pending
-- until somebody happens to look — which, for a training institute whose
-- staff live in WhatsApp and not in a CRM tab, can be the next morning.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_alert_enabled boolean NOT NULL DEFAULT false;

-- E.164 numbers as a JSON array of strings.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_alert_numbers jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The name of an approved Utility template.
--
-- Not optional in practice, and the UI says so. Meta only allows a
-- free-form business-initiated message inside a 24-hour window opened by
-- the recipient writing first; a staff number that never messages the
-- business is permanently outside it. Without a template the alert is
-- delivered when the staff member happened to be chatting recently and
-- silently not at all otherwise, which is the worst kind of alert.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_alert_template text;

-- Which reasons are worth interrupting somebody for; empty means all.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_alert_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;
