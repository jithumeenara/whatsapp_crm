-- 196: Evaluation checks that the right knowledge was found.
--
-- A wrong answer has two possible causes: the right knowledge was never
-- retrieved, or it was retrieved and the reply got it wrong. A test case
-- can now name the knowledge source it should come from; each result
-- records which sources the reply used and whether the expected one was
-- among them, so a run says which half to fix.
--   ai_eval_cases.expected_source   a knowledge source title (or part of one)
--   ai_eval_results.sources_used    JSON array of source titles the reply used
--   ai_eval_results.retrieval_hit   true / false when the case names a
--                                   source, NULL when it does not
--
-- Safe to run twice.

ALTER TABLE ai_eval_cases   ADD COLUMN IF NOT EXISTS expected_source TEXT CHECK (expected_source IS NULL OR char_length(expected_source) <= 200);
ALTER TABLE ai_eval_results ADD COLUMN IF NOT EXISTS sources_used JSONB;
ALTER TABLE ai_eval_results ADD COLUMN IF NOT EXISTS retrieval_hit BOOLEAN;
