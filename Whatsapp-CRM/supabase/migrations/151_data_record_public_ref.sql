-- 151: a reference a person can quote for their form submission.
--
-- Until now the reference shown after submitting was the first 8 hex
-- characters of the row's (or the batch's) id: 32 bits, guessable, and
-- tied to an internal id. Each new web-form row now gets its own random
-- reference (12 characters, Crockford base32, 60 bits); every row of a
-- group submission carries the same one. The business may show it with a
-- prefix of its own (form settings), which is not stored here.
--
-- Older rows keep no reference here; their old one still finds them by id.
-- Safe to run twice.

ALTER TABLE data_records ADD COLUMN IF NOT EXISTS public_ref text;

CREATE INDEX IF NOT EXISTS data_records_public_ref_idx
  ON data_records (table_id, public_ref)
  WHERE public_ref IS NOT NULL;
