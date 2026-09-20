-- Semantic search, safe to run on a database in any state.
--
-- ── Why this exists when 064 already did it ───────────────────────
--
-- 064 was written for one database that was known to be without these
-- objects, so it said CREATE TABLE and ADD COLUMN plainly. That is
-- correct exactly once. Every deployment since — a new tenant, a second
-- client's VPS, a rebuilt staging box — has had no safe way to reach
-- the same state: run 064 and it fails on the first object that already
-- exists, skip it and semantic retrieval silently never turns on,
-- because knowledge.ts falls back to keyword overlap whenever no
-- embedding rows are found. A feature that fails by going quiet is one
-- nobody notices is missing.
--
-- So this is 064 restated so that running it changes nothing when the
-- work is already done. It is not a replacement: on a database that has
-- 064, every statement here is a no-op.
--
-- ── If CREATE EXTENSION fails ─────────────────────────────────────
--
-- pgvector is a server-side package, not something Postgres can install
-- for itself. If this file stops on the first line with "could not open
-- extension control file", the extension is not present on the machine
-- and has to be installed there first (on Debian/Ubuntu, the
-- postgresql-<version>-pgvector package), then this file re-run.
--
-- The failure is deliberately left to stop the script rather than being
-- swallowed: without the extension the table below cannot exist, and a
-- half-applied semantic search is worse than none, because it looks
-- installed.
CREATE EXTENSION IF NOT EXISTS vector;

-- 3072 matches gemini-embedding-001's default output dimension. No ANN
-- index is created — every query filters to one ai_config_id first, and
-- at that scale a sequential scan over a handful of rows beats an index
-- that would itself be capped at 2000 dimensions.
CREATE TABLE IF NOT EXISTS ai_knowledge_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_config_id uuid NOT NULL REFERENCES ai_configs(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  kind text NOT NULL,
  embedding_model text NOT NULL,
  embedding vector(3072) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ai_config_id, content_hash, embedding_model)
);

CREATE INDEX IF NOT EXISTS ai_knowledge_embeddings_config_idx
  ON ai_knowledge_embeddings (ai_config_id);

-- Below this retrieval confidence the assistant hands off to a person
-- rather than answering. Off by default on every account: this is a
-- code-enforced behaviour change, not prompt guidance, and an account
-- that has been running without it should not have it appear overnight.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS confidence_threshold double precision NOT NULL DEFAULT 0.35;
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS low_confidence_handoff_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS low_confidence_assign_to uuid;
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS low_confidence_message text;
