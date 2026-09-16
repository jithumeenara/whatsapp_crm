-- Make the quality report cheap to ask for.
--
-- Two questions run over the whole history: which conversations a human
-- ever replied in, and what the customer said immediately before the AI
-- had to step in. Both walk messages by conversation and then by time.
--
-- messages(conversation_id) already exists, which gets the join to the
-- right conversation but then reads every message in it to filter on
-- date. Carrying created_at in the same index turns that into a range
-- scan, which matters most on exactly the conversations that are long
-- enough to be worth reading about.
--
-- NOTE: CREATE INDEX takes a brief write lock on the table. On a table
-- this size it is a matter of seconds, but run it at a quiet moment
-- rather than mid-campaign.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at);

-- The run tallies — started, completed, handed off, escaped — read one
-- account over one window. flow_runs already has (account_id) and
-- (flow_id, started_at); neither serves this one on its own.
CREATE INDEX IF NOT EXISTS idx_flow_runs_account_started
  ON flow_runs (account_id, started_at DESC);
