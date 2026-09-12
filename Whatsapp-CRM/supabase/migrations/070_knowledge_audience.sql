-- The enforced half of the Customer/Admin AI split.
--
-- A knowledge entry now declares who it may be said to. The customer
-- reply path (engine.ts's ai_reply node, and the Customer Test that
-- mirrors it) loads knowledge filtered by this column, so an 'internal'
-- entry is never retrieved, never reaches a customer-facing prompt, and
-- cannot be quoted back to a customer — including when a model is
-- talked into trying. Prompt wording alone is guidance; this is a
-- boundary.
--
-- Defaults to 'customer' so every entry an account has already added
-- keeps behaving exactly as it does today.
ALTER TABLE ai_knowledge_items ADD COLUMN audience text NOT NULL DEFAULT 'customer';

-- Retrieval always filters config + status + audience together.
DROP INDEX IF EXISTS ai_knowledge_items_config_status_idx;
CREATE INDEX ai_knowledge_items_config_status_audience_idx
  ON ai_knowledge_items (ai_config_id, status, audience);
