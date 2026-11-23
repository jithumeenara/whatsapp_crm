-- 197: Per-account knowledge-search settings (src/lib/ai/retrieval-settings.ts).
--
-- ai_configs.retrieval_settings JSONB, e.g. {"rerank": true}. Read with
-- plain SQL, never through Prisma, so a database without this column keeps
-- working exactly as before (the image_settings pattern). NULL = defaults
-- (rerank off).
--
-- Safe to run twice.

ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS retrieval_settings JSONB;
