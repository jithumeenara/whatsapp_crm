-- Adds an optional phone number to profiles — the account owner's/team
-- member's own WhatsApp number, collected at signup (country code +
-- local number combined into one E.164 string client-side before save).
-- Distinct from whatsapp_config, which holds the Business Platform
-- number the app itself sends/receives through.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
