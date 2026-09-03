-- Tracks how a WhatsApp connection was set up, so the settings UI can show
-- "Connected via Quick Connect" vs "Connected via Manual Setup".
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS connect_method TEXT NOT NULL DEFAULT 'manual';
