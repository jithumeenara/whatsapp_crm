-- WhatsApp account/phone-number-level webhook alerts (quality changes,
-- account alerts, display-name/account review decisions, security events)
-- are now pushed to the tenant admin as a browser notification. This
-- column debounces re-notifying on webhook redelivery of the same
-- underlying alert — see src/lib/whatsapp/account-webhook.ts.
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS last_alert_notified_at TIMESTAMPTZ;
