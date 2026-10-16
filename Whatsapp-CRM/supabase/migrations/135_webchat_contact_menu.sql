-- Website Bot: a contact menu on the chat button — WhatsApp, Call, or the
-- bot — so a visitor picks how to reach the business.
--
--   contact_menu_enabled  off by default: existing widgets keep opening the
--                         chat straight away until someone switches it on.
--   whatsapp_links        [{config_id, label, phone}] — which of the account's
--                         connected WhatsApp numbers to offer. The phone is a
--                         snapshot read from Meta when the widget is saved.
--   call_links            [{label, phone}] — numbers for the Call button.
--   whatsapp_prefill      optional first message typed into WhatsApp for them.
--
-- Safe to run again.

ALTER TABLE web_chat_widgets ADD COLUMN IF NOT EXISTS contact_menu_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE web_chat_widgets ADD COLUMN IF NOT EXISTS whatsapp_links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE web_chat_widgets ADD COLUMN IF NOT EXISTS call_links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE web_chat_widgets ADD COLUMN IF NOT EXISTS whatsapp_prefill TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_chat_widgets_whatsapp_links_check') THEN
    ALTER TABLE web_chat_widgets
      ADD CONSTRAINT web_chat_widgets_whatsapp_links_check
      CHECK (jsonb_typeof(whatsapp_links) = 'array' AND jsonb_array_length(whatsapp_links) <= 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_chat_widgets_call_links_check') THEN
    ALTER TABLE web_chat_widgets
      ADD CONSTRAINT web_chat_widgets_call_links_check
      CHECK (jsonb_typeof(call_links) = 'array' AND jsonb_array_length(call_links) <= 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_chat_widgets_whatsapp_prefill_check') THEN
    ALTER TABLE web_chat_widgets
      ADD CONSTRAINT web_chat_widgets_whatsapp_prefill_check
      CHECK (whatsapp_prefill IS NULL OR char_length(whatsapp_prefill) <= 300);
  END IF;
END $$;
