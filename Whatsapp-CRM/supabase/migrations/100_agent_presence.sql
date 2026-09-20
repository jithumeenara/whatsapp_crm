-- Knowing which agents are actually at their desks.
--
-- Presence is measured, not declared. Every help desk ships an
-- Online/Away/Busy control people set by hand, and Zendesk's own
-- documentation admits the flaw in passing: "agents must set themselves
-- to Away or Offline whenever they aren't available". They must, and
-- they forget -- and the moments they forget are precisely the moments
-- the queue is handing work to somebody who left an hour ago.
--
-- The signal already existed. The idle timeout posts a heartbeat on
-- real activity, throttled to once a minute; it only re-signed the
-- session cookie. Now it also leaves a timestamp, and nobody has to
-- remember anything.
--
-- Indexed on the timestamp alone. A user belongs to an account through
-- profiles, not directly, so there is no account_id here to lead the
-- index with -- the team lookup joins through profiles and filters on
-- this column.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS users_last_seen_idx
  ON users (last_seen_at);
