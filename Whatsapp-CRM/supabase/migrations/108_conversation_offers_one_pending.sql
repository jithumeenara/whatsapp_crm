-- A conversation can be offered to only one agent at a time.
-- The application lookup remains useful for the normal path, but this
-- index is the backstop for concurrent offer attempts.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_offers_one_pending_idx
  ON conversation_offers (conversation_id)
  WHERE status = 'pending';