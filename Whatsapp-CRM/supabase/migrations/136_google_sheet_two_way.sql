-- Data Store ⇄ Google Sheet: two-way, near-instant sync.
--
-- A link with direction 'sync' keeps a table and a sheet tab equal in both
-- directions — adds, edits and deletions. Each synced row carries the
-- record's id in a "CRM ID" column; google_sheet_rows remembers what both
-- sides looked like at the last sync, so a change can be told apart from
-- the other side's change (and a field changed on one side only is copied
-- to the other, never overwritten by a stale value).
--
--   sync_token_enc   encrypted secret the optional Apps Script uses to say
--                    "the sheet just changed" (instant updates).
--   instant_ping_at  last time that script called in.
--   held_deletes     records whose rows vanished from the sheet in a bulk
--                    that looked like an accident: kept until someone
--                    confirms in the CRM. Never deleted silently.
--   sync_warning     a non-fatal problem shown on the panel (a renamed
--                    column that is no longer synced, …).
--   sync_stats       what the last run did.
--
-- Safe to run again.

-- 'sync' joins 'export' and 'import'. Replaced only while it still lacks
-- 'sync', so a second run changes nothing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'google_sheet_links_direction_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%sync%'
  ) THEN
    ALTER TABLE google_sheet_links DROP CONSTRAINT google_sheet_links_direction_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_sheet_links_direction_check') THEN
    ALTER TABLE google_sheet_links
      ADD CONSTRAINT google_sheet_links_direction_check CHECK (direction IN ('export', 'import', 'sync'));
  END IF;
END $$;

ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS sync_token_enc TEXT;
ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS instant_ping_at TIMESTAMPTZ;
ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS held_deletes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS sync_warning TEXT;
ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS sync_stats JSONB;

CREATE TABLE IF NOT EXISTS google_sheet_rows (
  link_id    UUID NOT NULL REFERENCES google_sheet_links(id) ON DELETE CASCADE,
  record_id  UUID NOT NULL,
  snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, record_id)
);
