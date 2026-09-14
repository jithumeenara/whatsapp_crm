-- Blocking a contact.
--
-- Two ways in, and the difference matters when somebody is reviewing it
-- later: a person decided, or a flood rule fired. An automatic block is
-- a guess and should be easy to overturn; a manual one is a decision and
-- should not be quietly undone by the same rule.
--
-- Nullable timestamp rather than a boolean: "when" answers "is it
-- blocked" as well, and a boolean would have needed a second column to
-- say when it happened anyway.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS block_reason text;
-- 'manual' | 'flood'. Null while not blocked.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS blocked_source text;
-- Who pressed it. Null for an automatic block, which is how the two are
-- told apart without parsing the reason text.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS blocked_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- The check runs on every inbound message, so it must be an index hit
-- rather than a scan. Partial, because the overwhelming majority of
-- contacts are not blocked and do not belong in it.
CREATE INDEX IF NOT EXISTS contacts_blocked_idx
  ON contacts (account_id, blocked_at) WHERE blocked_at IS NOT NULL;
