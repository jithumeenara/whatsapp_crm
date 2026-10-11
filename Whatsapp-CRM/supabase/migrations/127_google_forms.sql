-- Google Forms: a form's responses arrive as Data Store records.
--
-- One link per table. question_map turns the form's question ids into the
-- table's field keys (the table is made from the form when it is linked).
-- imported_ids holds the response ids already brought in, so a response
-- comes in once however often the form is read.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS google_form_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  table_id       UUID NOT NULL UNIQUE REFERENCES data_tables(id) ON DELETE CASCADE,
  form_id        TEXT NOT NULL,
  form_title     TEXT,
  responder_url  TEXT,
  question_map   JSONB NOT NULL DEFAULT '{}',
  auto_sync      BOOLEAN NOT NULL DEFAULT true,
  imported_ids   TEXT[] NOT NULL DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_form_links_account_id_idx ON google_form_links (account_id);
