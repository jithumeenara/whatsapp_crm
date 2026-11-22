-- 179: One Facebook Login for Business configuration per channel.
--
-- "Connect Instagram" and "Connect Messenger" are separate buttons on
-- separate channel cards, so each opens Meta with its own configuration:
-- the Instagram one asks only for Instagram accounts, the Messenger one only
-- for Facebook Pages. (WhatsApp keeps config_id, its Embedded Signup.)
--
-- The single shared social_config_id (migration 169) is copied into both
-- new columns so a server that already connects keeps working. The app
-- clears social_config_id once the new fields are saved, so a re-run of this
-- file never brings back a value the owner removed.
--
-- Adds columns only; nothing is removed. Safe to run twice.

ALTER TABLE IF EXISTS meta_platform_config ADD COLUMN IF NOT EXISTS instagram_config_id TEXT;
ALTER TABLE IF EXISTS meta_platform_config ADD COLUMN IF NOT EXISTS messenger_config_id TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'meta_platform_config' AND column_name = 'social_config_id'
  ) THEN
    UPDATE meta_platform_config
       SET instagram_config_id = social_config_id
     WHERE instagram_config_id IS NULL AND social_config_id IS NOT NULL AND social_config_id <> '';
    UPDATE meta_platform_config
       SET messenger_config_id = social_config_id
     WHERE messenger_config_id IS NULL AND social_config_id IS NOT NULL AND social_config_id <> '';
  END IF;
END $$;
