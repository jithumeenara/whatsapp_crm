-- A sheet imported into a Data Store table remembers how its columns map
-- to the table's fields: header → field key, or skipped. Chosen once in
-- the import screen (where missing fields can be created from the sheet),
-- then used by every later "Import now" and the 15-minute sync.
--
-- Safe to run again.

ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS column_map JSONB;
