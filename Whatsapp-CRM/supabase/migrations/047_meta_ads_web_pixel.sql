-- Standard Meta Pixel + web Conversions API, separate from the WhatsApp
-- messaging Conversions API dataset already in meta_ads_config.
ALTER TABLE meta_ads_config
  ADD COLUMN IF NOT EXISTS pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS web_events_secret TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS meta_ads_config_web_events_secret_key
  ON meta_ads_config(web_events_secret);
