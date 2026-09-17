-- Stopping the same person registering twice for the same thing.
--
-- What counts as "twice" is not the same in two businesses, so it cannot
-- be guessed. A training institute wants one registration per person per
-- programme — the same person next term is a new registration, not a
-- duplicate. A clinic wants one appointment per patient per doctor per
-- date. A workshop with one intake wants one per person, full stop.
--
-- So the account names the fields that, together with the customer,
-- identify a duplicate. Empty means no check, which is the existing
-- behaviour and stays the default: switching this on for everybody would
-- start refusing registrations that are perfectly legitimate today.
ALTER TABLE data_tables
  ADD COLUMN IF NOT EXISTS ai_unique_by jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The lookup this drives is "rows in this table belonging to this
-- contact", which the partial index from migration 084 already covers.
-- No further index: the comparison itself is over a handful of a single
-- customer's own rows, in application code, because the fields being
-- compared live inside a jsonb document and differ per table.
