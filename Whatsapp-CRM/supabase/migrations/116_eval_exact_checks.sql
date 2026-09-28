-- Exact checks on an accuracy test (src/lib/ai/eval/runner.ts): phrases a
-- correct reply must contain, and phrases it must not — "all three
-- October programmes", "not the September one". Checked by code, before
-- and independently of the model grader. JSON arrays of strings.
-- Nullable; also added on first use by src/lib/ai/eval/schema.ts.
ALTER TABLE ai_eval_cases ADD COLUMN IF NOT EXISTS must_include JSONB;
ALTER TABLE ai_eval_cases ADD COLUMN IF NOT EXISTS must_not_include JSONB;
