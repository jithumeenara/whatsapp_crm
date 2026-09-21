-- What the assistant decided, and whether it was right.
--
-- ── Why one table and not five ──────────────────────────────────────
--
-- Five things get decided the moment the assistant cannot answer a
-- message: is this a real enquiry, what is it about, can this business
-- help at all, how urgent is it, and did the customer name a time to be
-- called back. The obvious build is five features, each with its own
-- record, its own review screen and its own accuracy figure.
--
-- They are one decision. They come out of one model call, about one
-- conversation, at one moment — so they are one row. A sixth question
-- added next year needs a column here and nothing else: no new table,
-- no new review screen, no second accuracy number that disagrees with
-- the first.
--
-- ── Why the human's answer lives in the same row ────────────────────
--
-- Accuracy is the only honest way to answer "does this work for my
-- business", and it is a comparison: what the assistant said against
-- what a person decided. Keeping both halves in one row means the
-- comparison cannot go missing — no join that might not match, no
-- second table that could be pruned separately and quietly turn every
-- figure into 100%.
--
-- ── Why `acted` exists ──────────────────────────────────────────────
--
-- A judgement is recorded whether or not the app was allowed to act on
-- it. That is what makes this safe to switch on: it runs beside the
-- existing behaviour for a week changing nothing, while the owner
-- compares what it *would* have done against what people actually did.
-- Nobody has to take anyone's word for the accuracy on their own
-- messages, because the figure is computed from their own.

CREATE TABLE IF NOT EXISTS ai_judgements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,

  -- Filled in later, if acting on this judgement produced a lead. Null
  -- while in observe-only mode, and null forever for the judgements
  -- that correctly decided there was no lead to make.
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,

  -- ── What the assistant said ──────────────────────────────────────
  is_lead             boolean NOT NULL,
  not_lead_reason     text,
  category            text,
  category_confidence text NOT NULL DEFAULT 'unsure',
  priority            text NOT NULL DEFAULT 'normal',
  out_of_scope_key    text,
  -- The customer's own words, not a timestamp: turning "after my exam
  -- on the 15th" into a date needs the business's calendar and time
  -- zone, and storing the phrase keeps the reason visible to whoever
  -- reads the follow-up later.
  follow_up_phrase    text,
  reason              text NOT NULL DEFAULT '',

  -- ── What actually happened ───────────────────────────────────────
  -- false = recorded but nothing was done. See the note above.
  acted           boolean NOT NULL DEFAULT false,

  -- ── What a person said about it ──────────────────────────────────
  -- Null until somebody reviews it, which is most rows: agreeing by
  -- doing nothing is not evidence of anything, so an unreviewed row
  -- counts in neither half of the accuracy figure.
  human_verdict   text,        -- 'agreed' | 'corrected'
  human_is_lead   boolean,
  human_category  text,
  reviewed_at     timestamptz,
  reviewed_by     uuid REFERENCES users(id) ON DELETE SET NULL,

  model           text NOT NULL DEFAULT '',
  latency_ms      integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The review queue: this account's judgements nobody has answered yet,
-- newest first. The one query this table exists to serve quickly.
CREATE INDEX IF NOT EXISTS ai_judgements_review_idx
  ON ai_judgements (account_id, reviewed_at, created_at DESC);

-- "What did the assistant decide about this chat?" — asked whenever a
-- conversation is opened, and used to avoid judging the same one twice
-- in a row.
CREATE INDEX IF NOT EXISTS ai_judgements_conversation_idx
  ON ai_judgements (conversation_id, created_at DESC);

COMMENT ON TABLE ai_judgements IS
  'One row per decision the assistant made about a conversation it could not answer, plus what a person said about that decision. Drives the review queue, the accuracy figure and the examples fed back into the prompt. See src/lib/ai/judgement.ts.';

COMMENT ON COLUMN ai_judgements.acted IS
  'false = recorded only, nothing was done. Lets the whole system run beside the existing behaviour before anyone trusts it.';

-- ── The switch ──────────────────────────────────────────────────────
--
-- Three positions, and the middle one is the reason this exists:
--
--   off      nothing happens. Every account starts here, including
--            every account that already exists when this ships.
--   observe  the assistant judges every handover and writes it down,
--            and nothing else changes. Costs a fraction of a rupee per
--            handover and buys a real accuracy figure on this
--            business's own messages.
--   act      the judgement decides what happens: whether a lead
--            appears, who is alerted, how loudly, what the customer is
--            told.
--
-- Nobody should reach 'act' without having spent time in 'observe'.
-- Skipping it means trusting a number nobody has seen.
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_judgement_mode text NOT NULL DEFAULT 'off';

COMMENT ON COLUMN lead_settings.ai_judgement_mode IS
  'off | observe | act. observe records judgements without acting on them, so accuracy can be measured before anything irreversible is switched on.';
