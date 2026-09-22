-- When a lead was lost.
--
-- ── Why a column and not updated_at ─────────────────────────────────
--
-- A won lead has converted_at: an exact moment, which is why "how many
-- did we win last week" is answerable. A lost one had only lost_reason,
-- which is text and carries no time, so the same question about losses
-- had to lean on updated_at — and updated_at moves whenever anything on
-- the row is touched.
--
-- That made a lead lost in March, reopened and edited today, count as
-- today's loss. On a seven-day dashboard that is not a rounding error:
-- it moves the denominator of every conversion rate an agent is read
-- on.
--
-- The alternative was to stop reporting losses, which would have been
-- worse in a quieter way. Every conversion rate would then be wins over
-- wins, which is to say one hundred per cent, forever.
--
-- ── The backfill, and what it can and cannot know ───────────────────
--
-- Existing lost leads get updated_at as their lost_at. That is the same
-- approximation the dashboard was already making, so nothing gets worse
-- — but it is frozen at the moment of this migration instead of
-- drifting forward every time somebody opens the record. From here on
-- the value is written when the loss is recorded and is exact.
--
-- Rows are only touched where lost_reason is set, so a lead still being
-- worked keeps a null lost_at and is not counted as anything.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lost_at timestamptz;

UPDATE leads
   SET lost_at = updated_at
 WHERE lost_reason IS NOT NULL
   AND lost_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lost_at
  ON leads (account_id, lost_at)
  WHERE lost_at IS NOT NULL;

COMMENT ON COLUMN leads.lost_at IS
  'When this lead was recorded as lost. Set alongside lost_reason and cleared when the lead is reopened or won. The mirror of converted_at.';
