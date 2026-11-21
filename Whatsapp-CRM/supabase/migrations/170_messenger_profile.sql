-- 170: Messenger "front door" settings for a Facebook Page — greeting,
-- Get Started button, ice breakers and persistent menu — as last synced to
-- Meta. Instagram already keeps its own in instagram_config.
--
-- facebook_config is created by the app on first use
-- (src/lib/social/ensure-tables.ts adds these same columns), so this only
-- runs when the table exists. Safe to run twice.

DO $$
BEGIN
  IF to_regclass('public.facebook_config') IS NOT NULL THEN
    ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS messenger_profile JSONB;
    ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS profile_synced_at TIMESTAMPTZ;
  END IF;
END $$;
