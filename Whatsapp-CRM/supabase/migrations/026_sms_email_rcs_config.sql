-- SMS (MSG91), Email (SendGrid), and RCS (Twilio) channel credentials.
-- Follows the whatsapp_config/ai_configs pattern (real table, one row per
-- account, secrets encrypted at the application layer via encrypt()/
-- decrypt() from src/lib/whatsapp/encryption.ts) rather than the
-- instagram_config/facebook_config shortcut (ad hoc CREATE TABLE, plaintext
-- token) or the generic `integrations` table (unencrypted JSON, built for
-- data-pull connectors, not messaging credentials).

CREATE TABLE IF NOT EXISTS sms_config (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL DEFAULT 'msg91',
  auth_key         TEXT        NOT NULL,
  sender_id        TEXT,
  route            TEXT        DEFAULT '4',
  dlt_entity_id    TEXT,
  dlt_template_id  TEXT,
  webhook_secret   TEXT,
  status           TEXT        NOT NULL DEFAULT 'disconnected',
  last_tested_at   TIMESTAMPTZ,
  test_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_config (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT        NOT NULL DEFAULT 'sendgrid',
  api_key             TEXT        NOT NULL,
  from_email          TEXT        NOT NULL,
  from_name           TEXT,
  inbound_parse_host  TEXT,
  inbound_secret      TEXT,
  webhook_public_key  TEXT,
  status              TEXT        NOT NULL DEFAULT 'disconnected',
  last_tested_at      TIMESTAMPTZ,
  test_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rcs_config (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id                UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider               TEXT        NOT NULL DEFAULT 'twilio',
  account_sid            TEXT        NOT NULL,
  auth_token             TEXT        NOT NULL,
  messaging_service_sid  TEXT,
  rcs_agent_id           TEXT,
  from_number            TEXT,
  status                 TEXT        NOT NULL DEFAULT 'disconnected',
  last_tested_at         TIMESTAMPTZ,
  test_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email has a subject/body split the other channels don't — cleaner as its
-- own column than encoding it into content_text.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_subject TEXT;
