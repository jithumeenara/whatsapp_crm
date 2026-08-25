-- TextBee (https://textbee.dev) as a second SMS provider alongside MSG91.
-- device_id: optional TextBee device override for outbound sends.
-- textbee_webhook_id: the webhook subscription id TextBee's API returns when
-- we auto-register the inbound webhook, so re-saving PATCHes it instead of
-- creating a duplicate subscription every time.
ALTER TABLE sms_config ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE sms_config ADD COLUMN IF NOT EXISTS textbee_webhook_id TEXT;
