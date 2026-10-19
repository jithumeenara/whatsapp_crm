-- Sheet routing: Data Store rows sent to Google Sheets by rules, and a
-- retry queue so nothing is lost when Google is busy.
--
--   sheet_route_tables   per Data Store table: first match only or every
--                        match, and how far the change scan has read
--                        (cursor_at / cursor_id over data_records.updated_at).
--   sheet_routes         one rule: conditions → a spreadsheet and tab (or a
--                        tab/sheet per group, from split_template such as
--                        "{{Month}} – {{Target group}}"), which columns in
--                        which order, and its own delivery report.
--   sheet_route_rows     where each record's row is now, per rule — so an
--                        edit that changes the rule's answer moves the row
--                        (found in the sheet by its "CRM ID" column), and a
--                        deleted record's row is removed. No foreign key to
--                        data_records: the record may be gone, that is the
--                        point.
--   sheet_route_targets  split_into = 'sheet': the spreadsheet made for each
--                        group, so a group is only ever created once.
--   sheet_jobs           the queue. 'record' = route this record again;
--                        'append' = a chatbot "Google Sheet" step's row that
--                        Google refused for a moment (rate limit), sent later.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS sheet_route_tables (
  table_id    UUID PRIMARY KEY REFERENCES data_tables(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'first',
  cursor_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cursor_id   UUID,
  last_run_at TIMESTAMPTZ,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sheet_route_tables_mode_check CHECK (mode IN ('first', 'all'))
);
CREATE INDEX IF NOT EXISTS sheet_route_tables_account_idx ON sheet_route_tables (account_id);

CREATE TABLE IF NOT EXISTS sheet_routes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  table_id          UUID NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  position          INT NOT NULL DEFAULT 0,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  is_fallback       BOOLEAN NOT NULL DEFAULT false,
  match             TEXT NOT NULL DEFAULT 'all',
  conditions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  spreadsheet_id    TEXT NOT NULL,
  spreadsheet_name  TEXT,
  tab_title         TEXT NOT NULL DEFAULT 'Sheet1',
  split_template    TEXT,
  split_into        TEXT NOT NULL DEFAULT 'tab',
  columns           JSONB NOT NULL DEFAULT '[]'::jsonb,
  move_on_edit      BOOLEAN NOT NULL DEFAULT true,
  delivered_count   INT NOT NULL DEFAULT 0,
  last_delivered_at TIMESTAMPTZ,
  last_error        TEXT,
  last_error_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sheet_routes_match_check CHECK (match IN ('all', 'any')),
  CONSTRAINT sheet_routes_split_into_check CHECK (split_into IN ('tab', 'sheet'))
);
CREATE INDEX IF NOT EXISTS sheet_routes_table_idx ON sheet_routes (table_id, position);
CREATE INDEX IF NOT EXISTS sheet_routes_account_idx ON sheet_routes (account_id);

CREATE TABLE IF NOT EXISTS sheet_route_rows (
  route_id       UUID NOT NULL REFERENCES sheet_routes(id) ON DELETE CASCADE,
  record_id      UUID NOT NULL,
  account_id     UUID NOT NULL,
  table_id       UUID NOT NULL,
  spreadsheet_id TEXT NOT NULL,
  tab_title      TEXT NOT NULL,
  row_hash       TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (route_id, record_id)
);
CREATE INDEX IF NOT EXISTS sheet_route_rows_record_idx ON sheet_route_rows (table_id, record_id);

CREATE TABLE IF NOT EXISTS sheet_route_targets (
  route_id         UUID NOT NULL REFERENCES sheet_routes(id) ON DELETE CASCADE,
  group_key        TEXT NOT NULL,
  spreadsheet_id   TEXT NOT NULL,
  spreadsheet_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (route_id, group_key)
);

CREATE TABLE IF NOT EXISTS sheet_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  table_id   UUID,
  record_id  UUID,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status     TEXT NOT NULL DEFAULT 'pending',
  attempts   INT NOT NULL DEFAULT 0,
  run_after  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sheet_jobs_kind_check CHECK (kind IN ('record', 'append')),
  CONSTRAINT sheet_jobs_status_check CHECK (status IN ('pending', 'running', 'failed'))
);
-- One waiting job per record: a burst of edits is routed once.
CREATE UNIQUE INDEX IF NOT EXISTS sheet_jobs_record_pending_uq
  ON sheet_jobs (record_id) WHERE kind = 'record' AND status = 'pending';
CREATE INDEX IF NOT EXISTS sheet_jobs_due_idx ON sheet_jobs (status, run_after);
CREATE INDEX IF NOT EXISTS sheet_jobs_table_idx ON sheet_jobs (table_id, status);
