-- Every pipeline must structurally have a start (open) stage and a close
-- stage split into Won/Lost outcomes. stage_type drives that logic; the
-- stage's display name stays freely editable.
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS stage_type TEXT NOT NULL DEFAULT 'open';

-- Backfill: stages already literally named "Won"/"Lost" get tagged with
-- their matching type so existing pipelines line up without renaming.
UPDATE pipeline_stages SET stage_type = 'won'  WHERE stage_type = 'open' AND lower(name) = 'won';
UPDATE pipeline_stages SET stage_type = 'lost' WHERE stage_type = 'open' AND lower(name) = 'lost';
