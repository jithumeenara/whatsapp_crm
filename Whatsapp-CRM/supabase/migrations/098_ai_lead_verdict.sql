-- Letting the assistant mark a lead somebody else already created.
--
-- With auto lead creation on, every new contact becomes a lead before
-- the assistant ever sees the conversation — which is the point: nobody
-- is missed. But it means the pool fills with wrong numbers, suppliers
-- and people who said "hi" and left, and the assistant's suggestion
-- step has nothing to suggest because the row already exists.
--
-- So when a lead is already there, the assistant reads it and records a
-- verdict instead of proposing a second one. Nothing is deleted and
-- nothing is hidden on that verdict: the row keeps its place in the
-- pool with a mark on it, and the agent decides. A model that quietly
-- removed leads would be one bad week away from being switched off.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_verdict text;

-- The lead list filters on it, and only a minority of rows ever carry
-- one, so it is worth the partial index rather than a full one.
CREATE INDEX IF NOT EXISTS leads_ai_verdict_idx
  ON leads (account_id, ai_verdict)
  WHERE ai_verdict IS NOT NULL;
