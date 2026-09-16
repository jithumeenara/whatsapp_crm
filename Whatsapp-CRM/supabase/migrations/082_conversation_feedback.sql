-- Did we actually help?
--
-- The app could say how many conversations the bot handled without a
-- person, and nothing at all about whether the people on the other end
-- were satisfied. Containment without satisfaction is a number that
-- rewards a bot for being hard to escape — which is the opposite of the
-- point.
--
-- One row per ask, written when the question goes out and updated when
-- an answer comes back. A row with a null rating is a real result: it
-- says somebody was asked and did not reply, and the share of those is
-- worth as much as the average score.
CREATE TABLE IF NOT EXISTS conversation_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id)      ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id      uuid          REFERENCES contacts(id)      ON DELETE SET NULL,
  -- 5 good, 3 all right, 1 poor. A 1-5 CSAT scale folded into the three
  -- buttons WhatsApp allows, so the figure stays comparable with how
  -- every other platform reports it.
  rating          integer CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  asked_at        timestamptz NOT NULL DEFAULT now(),
  answered_at     timestamptz
);

-- The dashboard reads a date range for one account.
CREATE INDEX IF NOT EXISTS idx_conversation_feedback_account_asked
  ON conversation_feedback (account_id, asked_at DESC);

-- An incoming rating has to find the open ask for its conversation, and
-- the "have we already asked recently?" check reads the same way.
CREATE INDEX IF NOT EXISTS idx_conversation_feedback_conversation
  ON conversation_feedback (conversation_id, asked_at DESC);

ALTER TABLE conversation_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_feedback_select ON conversation_feedback;
CREATE POLICY conversation_feedback_select ON conversation_feedback FOR SELECT
  USING (is_account_member(account_id));
