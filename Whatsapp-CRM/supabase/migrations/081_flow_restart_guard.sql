-- Make the restart guard free.
--
-- Before starting a chatbot the runner now asks one question: did this
-- same flow already end for this same contact a moment ago? That guards
-- the loop where a flow finishing on its first screen re-triggers on the
-- customer's very next message and sends the same greeting again — and
-- again, and again, each run looking perfectly healthy in the logs.
--
-- The question is asked on the inbound path, so it has to cost nothing.
-- Partial, because only ended runs are ever looked at: the index stays
-- small however many conversations are in flight.
CREATE INDEX IF NOT EXISTS idx_flow_runs_restart_guard
  ON flow_runs (flow_id, contact_id, ended_at DESC)
  WHERE ended_at IS NOT NULL;
