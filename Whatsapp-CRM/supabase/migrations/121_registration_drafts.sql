-- A registration being put together from a photo or file the customer
-- sent (src/lib/ai/registration-draft.ts): what was read, what is still
-- to ask, and where the conversation is. One per conversation; deleted
-- when the registration is saved or cancelled, and ignored after it
-- expires. The values are encrypted (they can hold bank details).
-- Also created on first use if this has not run. Safe to run more than once.
CREATE TABLE IF NOT EXISTS registration_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
  values_enc text NOT NULL,
  step text NOT NULL,
  field_key text,
  month text,
  page integer NOT NULL DEFAULT 0,
  lang text NOT NULL DEFAULT 'en',
  edits integer NOT NULL DEFAULT 0,
  source_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_registration_drafts_conversation ON registration_drafts (conversation_id);
