-- WhatsApp Coexistence: a number used in the WhatsApp Business app on the
-- phone AND in the CRM (src/lib/whatsapp/coexistence.ts).
--
-- whatsapp_coexistence_syncs: the one-time contacts + history sync Meta
-- allows within 24 hours of onboarding (POST /{phone_number_id}/smb_app_data),
-- its request ids (for Meta support) and how far the history import got.
--
-- whatsapp_history_chunks: each `history` / `smb_message_echoes` /
-- `smb_app_state_sync` webhook stored as it arrived, before it is turned
-- into messages and contacts. Meta never resends these, so the raw payload
-- is kept first and processed after. Six months of private chats: the
-- account's own data, never AI knowledge.
--
-- Read and written with plain SQL. Safe to run twice.

CREATE TABLE IF NOT EXISTS whatsapp_coexistence_syncs (
  whatsapp_config_id   UUID PRIMARY KEY REFERENCES whatsapp_config(id) ON DELETE CASCADE,
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  onboarded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  contacts_request_id  TEXT,
  contacts_error       TEXT,
  history_request_id   TEXT,
  history_error        TEXT,
  -- pending | importing | done | declined | failed
  history_status       TEXT NOT NULL DEFAULT 'pending',
  history_progress     INTEGER NOT NULL DEFAULT 0,
  history_messages     INTEGER NOT NULL DEFAULT 0,
  contacts_synced      INTEGER NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_coexistence_syncs_account_idx ON whatsapp_coexistence_syncs (account_id);

CREATE TABLE IF NOT EXISTS whatsapp_history_chunks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_config_id   UUID NOT NULL REFERENCES whatsapp_config(id) ON DELETE CASCADE,
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  field                TEXT NOT NULL,
  payload              JSONB NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at         TIMESTAMPTZ,
  error                TEXT
);
CREATE INDEX IF NOT EXISTS whatsapp_history_chunks_pending_idx
  ON whatsapp_history_chunks (received_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_history_chunks_config_idx ON whatsapp_history_chunks (whatsapp_config_id);
