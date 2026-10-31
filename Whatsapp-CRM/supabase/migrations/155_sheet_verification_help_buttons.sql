-- 155: "Call" and "WhatsApp" buttons on the check-your-details page.
--
-- help_whatsapp_config_id  which connected WhatsApp number the button opens a chat with
-- help_whatsapp_text       the message already typed in that chat (e.g. a chatbot trigger word)
-- help_call_phone          the number the Call button dials (the company profile's phone when empty)
--
-- Only adds columns; safe to run twice.

ALTER TABLE sheet_verifications ADD COLUMN IF NOT EXISTS help_whatsapp_config_id uuid;
ALTER TABLE sheet_verifications ADD COLUMN IF NOT EXISTS help_whatsapp_text text;
ALTER TABLE sheet_verifications ADD COLUMN IF NOT EXISTS help_call_phone text;
