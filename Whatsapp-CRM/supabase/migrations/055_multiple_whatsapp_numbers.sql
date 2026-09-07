-- Multiple WhatsApp numbers per tenant (audit Finding #14), plus the
-- Marketing Messages (#10) and Direct Send (#08b) per-number flags that
-- ride along on the same WhatsAppConfig row. Additive + backfill only —
-- every existing account has exactly one WhatsAppConfig row today, so
-- every backfill below is unambiguous.

ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS marketing_messages_status TEXT;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS direct_send_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_account_contact_channel_wa_config_idx
  ON conversations (account_id, contact_id, channel, whatsapp_config_id);

ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS waba_id TEXT;

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID;

-- Drop the old single-number uniqueness on whatsapp_config.account_id —
-- name may be "whatsapp_config_account_id_key" (Prisma's default for a
-- @unique column) or "whatsapp_config_account_id_unique" depending on
-- how it was originally created; try both, ignore if neither matches.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_account_id_key') THEN
    ALTER TABLE whatsapp_config DROP CONSTRAINT whatsapp_config_account_id_key;
  ELSIF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_account_id_unique') THEN
    ALTER TABLE whatsapp_config DROP CONSTRAINT whatsapp_config_account_id_unique;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS whatsapp_config_account_id_idx ON whatsapp_config (account_id);

-- ── Backfill ────────────────────────────────────────────────────────

-- Every existing account's sole WhatsApp number becomes its default.
UPDATE whatsapp_config SET is_default = true WHERE is_default = false;

-- Every existing WhatsApp conversation gets bound to its account's (only)
-- connected number.
UPDATE conversations c
SET whatsapp_config_id = wc.id
FROM whatsapp_config wc
WHERE c.channel = 'whatsapp'
  AND c.whatsapp_config_id IS NULL
  AND wc.account_id = c.account_id;

-- Every existing template gets tagged with its account's (only) WABA.
UPDATE message_templates mt
SET waba_id = wc.waba_id
FROM whatsapp_config wc
WHERE mt.waba_id IS NULL
  AND wc.account_id = mt.account_id
  AND wc.waba_id IS NOT NULL;

-- ── Re-key message_templates' uniqueness to include waba_id ──────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_account_id_name_language_key') THEN
    ALTER TABLE message_templates DROP CONSTRAINT message_templates_account_id_name_language_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_waba_name_language_key
  ON message_templates (account_id, waba_id, name, language);
