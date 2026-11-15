-- 163: one row for every time the assistant or a chatbot flow hands a
-- conversation to a person (Reports → AI & Automation, plan §4.7, §6.2).
--
-- Until now a handover was only a free-text note on the thread, so "how
-- many, why, how many outside working hours, and which questions the
-- assistant could not answer" could not be counted. Who took it over and
-- how fast is worked out at report time from the first team reply after
-- created_at, so nothing here is ever updated after it is written.
--
-- Safe to run twice. No user link (deleting a member never touches this).

CREATE TABLE IF NOT EXISTS ai_handovers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid        REFERENCES conversations(id) ON DELETE SET NULL,
  -- 'ai' (the assistant's auto-reply) | 'flow' (a chatbot flow)
  source          text        NOT NULL,
  -- low_confidence | unsupported_details | turn_limit | asked_for_person |
  -- registration | rule | other  (kept as text: new reasons need no migration)
  reason          text        NOT NULL DEFAULT 'other',
  outside_hours   boolean     NOT NULL DEFAULT false,
  -- The customer's last message when the assistant could not answer
  -- (trimmed); shown to supervisors as "questions the AI could not answer".
  question        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_handovers_source_check'
  ) THEN
    ALTER TABLE ai_handovers
      ADD CONSTRAINT ai_handovers_source_check CHECK (source IN ('ai', 'flow'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_handovers_question_len'
  ) THEN
    ALTER TABLE ai_handovers
      ADD CONSTRAINT ai_handovers_question_len CHECK (question IS NULL OR char_length(question) <= 500);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_handovers_account_created_idx ON ai_handovers (account_id, created_at);
CREATE INDEX IF NOT EXISTS ai_handovers_conversation_idx ON ai_handovers (conversation_id);
