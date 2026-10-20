-- Fair assignment, and tags the AI can add by meaning.
--
--   assignment_rotations   whose turn it is, per account and queue (an
--                          automation, a chatbot handoff, a lead rule).
--                          Only the last person given work is stored, so
--                          people joining or leaving never shift the turn;
--                          the next is "the first eligible person after
--                          them". Changed under an advisory lock.
--   assignment_events      every automatic or bulk assignment of a lead or
--                          a chat: who got it, who had it, by what rule,
--                          and WHY (who was skipped and why) — shown on the
--                          lead and the chat.
--   tags.ai_mode           'off' | 'suggest' | 'auto' — may the AI suggest
--                          or add this tag. ai_description says when it
--                          applies, ai_avoid when it does not,
--                          ai_examples are customer phrases (any language).
--   ai_tag_decisions       each time the AI read a conversation: the tag,
--                          confidence, the customer's own words as evidence,
--                          and whether it was added, suggested, accepted or
--                          dismissed. A tag a person removed is never added
--                          again by the AI for that contact.
--   conversations.ai_tagged_at / ai_tag_runs  when it last read the chat,
--                          and how many times (at most 3 per chat).
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS assignment_rotations (
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  last_user_id  UUID,
  turn          INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, scope)
);

CREATE TABLE IF NOT EXISTS assignment_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  record_type     TEXT NOT NULL,
  record_id       UUID NOT NULL,
  previous_user_id UUID,
  new_user_id     UUID,
  actor_user_id   UUID,
  source          TEXT NOT NULL,
  method          TEXT,
  reason          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assignment_events_type_check CHECK (record_type IN ('lead', 'conversation'))
);
CREATE INDEX IF NOT EXISTS assignment_events_record ON assignment_events (record_type, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assignment_events_account ON assignment_events (account_id, created_at DESC);

ALTER TABLE tags ADD COLUMN IF NOT EXISTS ai_mode TEXT NOT NULL DEFAULT 'off';
ALTER TABLE tags ADD COLUMN IF NOT EXISTS ai_description TEXT;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS ai_avoid TEXT;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS ai_examples TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_ai_mode_check') THEN
    ALTER TABLE tags ADD CONSTRAINT tags_ai_mode_check CHECK (ai_mode IN ('off', 'suggest', 'auto'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_tag_decisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  tag_id           UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  confidence       TEXT NOT NULL,
  evidence         TEXT NOT NULL,
  reason           TEXT,
  outcome          TEXT NOT NULL,
  decided_by       UUID REFERENCES users(id) ON DELETE RESTRICT,
  model            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_tag_decisions_confidence_check CHECK (confidence IN ('high', 'medium', 'low')),
  CONSTRAINT ai_tag_decisions_outcome_check CHECK (outcome IN ('applied', 'suggested', 'accepted', 'dismissed', 'removed_by_person'))
);
CREATE INDEX IF NOT EXISTS ai_tag_decisions_contact ON ai_tag_decisions (contact_id, tag_id);
CREATE INDEX IF NOT EXISTS ai_tag_decisions_pending ON ai_tag_decisions (account_id, outcome, created_at DESC);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_tagged_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_tag_runs INTEGER NOT NULL DEFAULT 0;
