-- When somebody left, as opposed to when they were last seen.
--
-- Presence could already work out that a person had gone, by waiting for
-- their session to time out. What it could not do was notice them
-- leaving. Pressing Log out and closing the last window are both
-- ordinary, both deliberate, and both were invisible: the agent stayed
-- green for three minutes and stayed in the flow routing pool for
-- fifteen, and a live customer could be handed to somebody who had
-- walked out of the building.
--
-- This column holds that moment. It is written by the sign-out event in
-- src/auth.ts and by the browser on its way out (POST /api/presence/leave),
-- and it is read by src/lib/agents/presence.ts, which treats a person as
-- offline when the last thing that happened to them was leaving.
--
-- It is compared against last_seen_at rather than cleared, so coming
-- back costs nothing: the next heartbeat writes a newer last_seen_at,
-- which is then the later of the two, and the person is present again.
-- Nothing has to remember to undo this.
--
-- Nullable: NULL means "has never left", which is the correct and
-- harmless state for every existing row.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS went_offline_at timestamptz;

-- No index. Every query that reads this column already has the row in
-- hand — presence is looked up per user, or for the handful of people on
-- one account — so an index would cost writes on every sign-out and buy
-- nothing back.

COMMENT ON COLUMN users.went_offline_at IS
  'Last explicit departure (sign-out, or the last browser window closing). Offline when this is newer than last_seen_at. See src/lib/agents/presence.ts.';
