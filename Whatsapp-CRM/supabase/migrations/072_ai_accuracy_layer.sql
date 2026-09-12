-- 072 — the accuracy layer.
--
-- Six changes, in dependency order:
--   1. Backfill max_tokens on rows still holding the old 500 ceiling.
--   2. Force reply language back to auto-detect (it is now inferred per
--      message rather than pinned in settings).
--   3. Voice reply settings.
--   4. Response validation + multi-signal confidence settings.
--   5. Knowledge lifecycle columns (effective dates, language, dept).
--   6. The evaluation suite tables.

-- ─────────────────────────────────────────────────────────────
-- 1. max_tokens backfill
--
-- 071 changed the column DEFAULT to 2048, which only applies to rows
-- created afterwards. Every account that existed before kept 500 and
-- carried on truncating replies mid-sentence. This moves them, but only
-- where the value is still exactly the old default — an account that
-- deliberately chose 500, or any other number, is left alone.
-- ─────────────────────────────────────────────────────────────
UPDATE ai_configs SET max_tokens = 2048 WHERE max_tokens = 500;

-- ─────────────────────────────────────────────────────────────
-- 2. Reply language -> auto
--
-- A language pinned during setup is a guess made before a single
-- customer has written in. It then overrides the customer's actual
-- language on every message, which is worse than having no setting at
-- all: someone writing in Malayalam gets answered in English because of
-- a dropdown touched once, months earlier.
--
-- Language is now inferred per message from what the customer actually
-- wrote (see src/lib/ai/language.ts). The column stays — a future
-- "always reply in X" override is a legitimate feature — but nothing
-- writes it today and existing pins are cleared.
-- ─────────────────────────────────────────────────────────────
UPDATE ai_configs SET reply_language = NULL WHERE reply_language IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. Voice replies
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ai_configs
  -- When a customer sends a voice note, answer with one. Default on:
  -- somebody who records a voice message is usually doing it because
  -- typing is inconvenient, and a wall of text back ignores that.
  ADD COLUMN IF NOT EXISTS voice_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Gemini prebuilt voice name. Kore is neutral and clear at speed.
  ADD COLUMN IF NOT EXISTS voice_name TEXT NOT NULL DEFAULT 'Kore',
  -- Voice replies are also capped: a two-minute audio message is worse
  -- than a short one plus a text follow-up.
  ADD COLUMN IF NOT EXISTS voice_max_chars INTEGER NOT NULL DEFAULT 700;

-- ─────────────────────────────────────────────────────────────
-- 4. Validation + composite confidence
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ai_configs
  -- Inspect a reply before it is sent, and hand off rather than send a
  -- figure the retrieved context does not support.
  ADD COLUMN IF NOT EXISTS response_validation_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Blend retrieval similarity with question ambiguity, repetition and
  -- sentiment instead of gating on similarity alone.
  ADD COLUMN IF NOT EXISTS composite_confidence_enabled BOOLEAN NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────────────────────
-- 5. Knowledge lifecycle
--
-- Without effective dates, last term's fee list and this term's are
-- equally retrievable and the model picks whichever embeds closer to
-- the question. That is the single most damaging kind of wrong answer,
-- because it is fluent and specific.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ai_knowledge_items
  ADD COLUMN IF NOT EXISTS effective_from  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effective_until TIMESTAMPTZ,
  -- Free text, not an enum: "Malayalam", "English", "Tamil". NULL means
  -- "applies whatever the customer writes in" — the common case.
  ADD COLUMN IF NOT EXISTS language TEXT,
  -- "Admissions", "Accounts", "Hostel" — surfaces in the handoff note so
  -- the right person picks the conversation up.
  ADD COLUMN IF NOT EXISTS department TEXT,
  -- Tie-breaker when two entries match equally well. Higher wins.
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

-- Partial index: the retrieval filter only ever asks about rows that
-- actually carry a window, and most rows never will.
CREATE INDEX IF NOT EXISTS ai_knowledge_items_effective_idx
  ON ai_knowledge_items (ai_config_id, effective_from, effective_until)
  WHERE effective_from IS NOT NULL OR effective_until IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 6. Evaluation suite
--
-- The point of these two tables is to make "did that prompt change help
-- or hurt?" a question with an answer. Cases are written once; a run
-- replays all of them and stores each outcome so two runs can be
-- compared.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_eval_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_config_id UUID NOT NULL REFERENCES ai_configs(id) ON DELETE CASCADE,

  question     TEXT NOT NULL,
  -- What a correct answer must contain. Graded by a model, not by string
  -- match — "₹45,000" and "forty-five thousand rupees" are both right.
  expected     TEXT,
  -- Cases that SHOULD refuse or hand off. Without these a suite only
  -- measures eagerness: a bot that answers everything confidently scores
  -- perfectly right up until it invents a refund policy.
  expect_handoff BOOLEAN NOT NULL DEFAULT false,
  -- 'fees' | 'admissions' | 'safety' | ... — free text, for reading a
  -- run's failures by area rather than as one number.
  category     TEXT,
  notes        TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT true,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_eval_cases_config_idx ON ai_eval_cases (ai_config_id, enabled);

CREATE TABLE IF NOT EXISTS ai_eval_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_config_id UUID NOT NULL REFERENCES ai_configs(id) ON DELETE CASCADE,

  -- 'running' | 'completed' | 'failed'
  status       TEXT NOT NULL DEFAULT 'running',
  total        INTEGER NOT NULL DEFAULT 0,
  passed       INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  -- A copy of the settings this run was measured under, so a later
  -- comparison can say what actually differed rather than just that the
  -- number moved.
  settings_snapshot JSONB,
  label        TEXT,
  error        TEXT,

  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_eval_runs_config_idx ON ai_eval_runs (ai_config_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_eval_results (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     UUID NOT NULL REFERENCES ai_eval_runs(id) ON DELETE CASCADE,
  case_id    UUID NOT NULL REFERENCES ai_eval_cases(id) ON DELETE CASCADE,

  passed     BOOLEAN NOT NULL,
  reply      TEXT,
  -- Was this a handoff? Compared against the case's expect_handoff.
  handed_off BOOLEAN NOT NULL DEFAULT false,
  confidence DOUBLE PRECISION,
  -- The grader's one-line reason, shown next to a failure so it can be
  -- acted on without re-reading the whole reply.
  verdict    TEXT,
  latency_ms INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_eval_results_run_idx ON ai_eval_results (run_id);
