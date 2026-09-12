-- Records one row per AI API call, so the Usage tab has a real source.
-- Before this, nothing in the app measured AI usage at all — not
-- requests, not tokens, not cost.
--
-- Token counts come from the provider's own response (Gemini's
-- usageMetadata), so they match what the vendor billed. cost_usd is an
-- estimate from a local price table, which is why every surface that
-- shows it says "estimated".
--
-- Writes are best-effort and off the request's critical path: failing to
-- record usage must never cost a customer their reply.

CREATE TABLE ai_usage_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  model         text NOT NULL,
  feature       text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens  integer NOT NULL DEFAULT 0,
  -- 6dp, not 2: one Flash call costs a small fraction of a cent, and
  -- rounding to cents would store every single call as zero.
  cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'success',
  error         text,
  latency_ms    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The two shapes the Usage tab actually queries: a time window for the
-- totals and trend chart, and a window split by feature for the
-- breakdown.
CREATE INDEX ai_usage_events_account_created_idx ON ai_usage_events (account_id, created_at DESC);
CREATE INDEX ai_usage_events_account_feature_created_idx ON ai_usage_events (account_id, feature, created_at DESC);
