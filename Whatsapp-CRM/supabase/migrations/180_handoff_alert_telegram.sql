-- "Alert staff on Telegram" (Settings -> AI -> Hand off when unsure):
-- whether a handover also messages the owners/admins who linked Admin Chat
-- on Telegram (src/lib/ai/staff-telegram.ts). On by default, which is how
-- it already behaved. Read with plain SQL (telegram-alert-setting.ts), so a
-- database without the column keeps working; also added when first changed.
-- Safe to run twice.
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS handoff_alert_telegram BOOLEAN NOT NULL DEFAULT true;
