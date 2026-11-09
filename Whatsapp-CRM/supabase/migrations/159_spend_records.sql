-- 159: record what each WhatsApp message and each AI call cost, and who it was for
-- (the Spending report; docs/plans/reports-plan.md).
--
-- WhatsApp: Meta's status webhook says the category and type of the charge for
-- every message but never the price. One row per message holds that, the price
-- worked out from Meta's rate card, and which card it came from, so history is
-- never repriced from today's card. A WhatsApp id is charged at most once, so
-- (account_id, message_id) is unique and a status Meta delivers twice cannot
-- count twice.
--
-- AI: ai_usage_events gains who, which conversation, which channel and which
-- number, so AI cost can be shown per person and per channel. Old rows stay
-- empty and are shown as "not attributed"; nothing is backfilled or guessed.
--
-- Safe to run twice. Additive only: no column, row or table is removed.

CREATE TABLE IF NOT EXISTS whatsapp_message_costs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Meta's message id (wamid).
  message_id         text NOT NULL,
  conversation_id    uuid,
  whatsapp_config_id uuid,
  -- Who sent it. A person for agent sends and broadcasts; null for the bot,
  -- automations and system messages (sender_type says which).
  sender_user_id     uuid,
  sender_type        text,
  template_name      text,
  broadcast_id       uuid,
  -- The market Meta prices the recipient in (from their number) and its country.
  recipient_market   text,
  recipient_iso      text,
  -- Exactly what Meta reported, so a later change of its format loses nothing.
  pricing_category   text,
  pricing_type       text,
  pricing_model      text,
  pricing_subtype    text,
  raw_pricing        jsonb,
  -- Null when no honest price exists (no card for the currency, a message from
  -- before the card, an unknown category). 0 is a real figure: a free message.
  amount             numeric(14, 6),
  currency           text,
  rate_known         boolean NOT NULL DEFAULT false,
  -- Which card priced it, e.g. 'INR 2026-10-01'.
  rate_version       text,
  -- When Meta reported the message (sent), and when it was delivered.
  occurred_at        timestamptz NOT NULL,
  delivered_at       timestamptz,
  -- A message that failed before delivery is not charged.
  voided_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_message_costs_message ON whatsapp_message_costs (account_id, message_id);
CREATE INDEX IF NOT EXISTS whatsapp_message_costs_time ON whatsapp_message_costs (account_id, occurred_at);
CREATE INDEX IF NOT EXISTS whatsapp_message_costs_person ON whatsapp_message_costs (account_id, sender_user_id, occurred_at)
  WHERE sender_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_message_costs_number ON whatsapp_message_costs (account_id, whatsapp_config_id, occurred_at);
CREATE INDEX IF NOT EXISTS whatsapp_message_costs_category ON whatsapp_message_costs (account_id, pricing_category, occurred_at);

-- ── AI usage: whom it was for ─────────────────────────────────────────
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS user_id            uuid;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS conversation_id    uuid;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS channel            text;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS whatsapp_config_id uuid;

CREATE INDEX IF NOT EXISTS ai_usage_events_person ON ai_usage_events (account_id, user_id, created_at)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_usage_events_channel ON ai_usage_events (account_id, channel, created_at)
  WHERE channel IS NOT NULL;

-- ── Links to users never delete business data (migration 132) ─────────
DO $$
DECLARE
  link record;
BEGIN
  FOR link IN
    SELECT * FROM (VALUES
      ('whatsapp_message_costs', 'sender_user_id', 'whatsapp_message_costs_sender_user_id_fkey'),
      ('ai_usage_events', 'user_id', 'ai_usage_events_user_id_fkey')
    ) AS t(tbl, col, con)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = link.con) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users (id) ON DELETE RESTRICT',
        link.tbl, link.con, link.col);
    END IF;
  END LOOP;

  -- A removed number leaves its history; the rows just lose the link.
  IF to_regclass('whatsapp_config') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_message_costs_whatsapp_config_id_fkey') THEN
      ALTER TABLE whatsapp_message_costs ADD CONSTRAINT whatsapp_message_costs_whatsapp_config_id_fkey
        FOREIGN KEY (whatsapp_config_id) REFERENCES whatsapp_config (id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_events_whatsapp_config_id_fkey') THEN
      ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_whatsapp_config_id_fkey
        FOREIGN KEY (whatsapp_config_id) REFERENCES whatsapp_config (id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
