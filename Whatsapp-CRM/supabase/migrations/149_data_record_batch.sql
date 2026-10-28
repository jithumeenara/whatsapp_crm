-- 149: several people in one public-form submission.
--
-- A form can ask some questions once (programme, month, district) and the
-- rest per person ("Add participant"). Each person is still one row of the
-- table, with the asked-once answers copied in; these columns tie the rows
-- of one submission together.
--
--   batch_id     the submission (null for every other row)
--   batch_index  1, 2, 3… — the person's place in it
--
-- The unique index makes a double-tapped submit save the batch once.
-- Safe to run twice.

ALTER TABLE data_records ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE data_records ADD COLUMN IF NOT EXISTS batch_index smallint;

CREATE UNIQUE INDEX IF NOT EXISTS data_records_batch_key
  ON data_records (table_id, batch_id, batch_index)
  WHERE batch_id IS NOT NULL;
