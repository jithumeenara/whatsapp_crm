-- 150: people check their own details, straight from a Google Sheet.
--
-- A business keeps its list (participants, students, patients…) in a
-- Google Sheet, filled from many places. A "verification" sends each row's
-- person a private link; they see their own row and either confirm it or
-- correct what the business allows. Corrections are written back to the
-- same row of the sheet. The people's details stay in the sheet: these
-- tables hold the settings, and per person only the row's reference and
-- how far they got — never their name, number or answers.
--
--   sheet_verifications         one per list being checked
--   sheet_verification_people   per row: state, and how each message went
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS sheet_verifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  spreadsheet_id    text NOT NULL,
  spreadsheet_name  text,
  tab_title         text NOT NULL,
  -- Column headers (not letters): the sheet's columns may move.
  name_column       text,
  phone_column      text,
  email_column      text,
  show_columns      jsonb NOT NULL DEFAULT '[]'::jsonb,
  edit_columns      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Only rows whose filter column equals this value (e.g. one programme).
  filter_column     text,
  filter_value      text,
  -- Links stop working after this; nothing can be changed after it.
  deadline          timestamptz,
  language          text NOT NULL DEFAULT 'en',
  intro             text,
  -- WhatsApp: an approved template; what fills each {{n}}.
  template_name     text,
  template_params   jsonb NOT NULL DEFAULT '[]'::jsonb,
  sms_text          text,
  email_subject     text,
  email_text        text,
  -- Raised to cancel every link sent so far.
  key_version       integer NOT NULL DEFAULT 1,
  -- While a send runs: a second press waits for it to finish.
  sending_until     timestamptz,
  status            text NOT NULL DEFAULT 'active',
  created_by        uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sheet_verifications_account_idx ON sheet_verifications (account_id);

-- Why the last send stopped, shown to the admin who pressed Send.
ALTER TABLE sheet_verifications ADD COLUMN IF NOT EXISTS last_send_error text;

CREATE TABLE IF NOT EXISTS sheet_verification_people (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id  uuid NOT NULL REFERENCES sheet_verifications(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ref              text NOT NULL,
  -- pending · opened · verified · corrected · phone
  state            text NOT NULL DEFAULT 'pending',
  opened_at        timestamptz,
  done_at          timestamptz,
  done_by          uuid REFERENCES users(id) ON DELETE RESTRICT,
  wa_status        text,
  wa_message_id    text,
  wa_error         text,
  sms_status       text,
  sms_error        text,
  email_status     text,
  email_error      text,
  last_sent_at     timestamptz,
  send_count       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sheet_verification_people_ref_key
  ON sheet_verification_people (verification_id, ref);
CREATE INDEX IF NOT EXISTS sheet_verification_people_wa_idx
  ON sheet_verification_people (wa_message_id)
  WHERE wa_message_id IS NOT NULL;
