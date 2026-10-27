-- 147: what goes into each variable of a staff-alert template.
--
-- A handover or new-contact alert sent as an approved template used to
-- fill {{1}}..{{4}} in a fixed order (name, number, message, reason). Now:
--   ai_configs.handoff_alert_params                 ["customer_name", "customer_phone", …]
--   contact_capture_configs.new_contact_alert_params  the same, for new contacts
--   message_templates.variable_fields               what an AI-made template's
--                                                    {{1}}, {{2}}… stand for,
--                                                    so choosing it fills the mapping.
-- All nullable: no value keeps the old order. Safe to run twice.

ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS handoff_alert_params jsonb;
ALTER TABLE contact_capture_configs ADD COLUMN IF NOT EXISTS new_contact_alert_params jsonb;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS variable_fields jsonb;
