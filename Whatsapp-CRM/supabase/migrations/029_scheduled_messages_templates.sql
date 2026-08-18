-- Scheduled messages must now be Meta-approved templates -- WhatsApp
-- rejects free-form text/media outside the 24h customer-service window,
-- which a scheduled (especially recurring, multi-day) send routinely
-- lands outside of. These columns hold the chosen template + its filled
-- variables; the pre-existing content_text/media_url/media_type/buttons
-- columns are kept for any rows created before this change.

ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS template_name TEXT;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS template_language TEXT;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS template_body_params JSONB;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS template_header_text TEXT;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS template_button_params JSONB;
