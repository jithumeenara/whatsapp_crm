-- ============================================================
-- 023_flow_runs_pending_flow_token
--
-- The chatbot's "Send Flow" node fires-and-continues today: it never
-- waits for the customer to actually submit the WhatsApp Flow, so a
-- later chatbot step can't reference what they entered.
--
-- This adds a correlation token on flow_runs: when send_flow suspends
-- the run (mirroring collect_input), it mints a random flow_token,
-- sends it to WhatsApp as part of the Flow message, and stores it
-- here. When the customer completes the Flow, WhatsApp echoes that
-- same token back in the completed message (interactive.nfm_reply);
-- the main webhook uses it to find and resume this exact paused run.
-- ============================================================

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS pending_flow_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_runs_pending_flow_token
  ON flow_runs (pending_flow_token)
  WHERE pending_flow_token IS NOT NULL;
