-- Connect Google: private Google Sheets for the assistant's knowledge,
-- new Data Store records written to a sheet, and a sheet's rows imported
-- into a table.
--
-- One Google account per CRM account, through the account's own Google
-- Cloud OAuth app, with the drive.file scope: the CRM can reach only the
-- files someone picks in the Google Picker or that the CRM created.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS google_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL,
  client_id         TEXT NOT NULL,
  client_secret     TEXT NOT NULL,
  api_key           TEXT,
  google_email      TEXT,
  refresh_token     TEXT,
  access_token      TEXT,
  access_expires_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'not_connected',
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS google_sheet_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  table_id         UUID NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('export', 'import')),
  spreadsheet_id   TEXT NOT NULL,
  spreadsheet_name TEXT,
  sheet_title      TEXT NOT NULL,
  auto_sync        BOOLEAN NOT NULL DEFAULT false,
  imported_keys    TEXT[] NOT NULL DEFAULT '{}',
  last_synced_at   TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_sheet_links_table_id_direction_key ON google_sheet_links (table_id, direction);
CREATE INDEX IF NOT EXISTS google_sheet_links_account_id_idx ON google_sheet_links (account_id);
