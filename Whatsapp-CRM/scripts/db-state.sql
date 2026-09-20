-- What is actually in this database?
--
-- Run before deploying to a machine whose migration history is not
-- certain. Reads only — it changes nothing, so it is safe against a
-- live production database.
--
--   psql "$DATABASE_URL" -f scripts/db-state.sql
--
-- Every row answers one question with yes or no. Anything that says no
-- is a migration that has not been applied, whatever the code says.

\echo ''
\echo '=== Postgres ==='
SELECT version();

\echo ''
\echo '=== pgvector ==='
-- installed: the extension is active in this database.
-- available: the server has the package and CREATE EXTENSION would work.
-- If available is empty, pgvector must be installed on the machine first
-- (Debian/Ubuntu: postgresql-<version>-pgvector).
SELECT
  EXISTS (SELECT 1 FROM pg_extension           WHERE extname = 'vector') AS installed,
  EXISTS (SELECT 1 FROM pg_available_extensions WHERE name    = 'vector') AS available;

\echo ''
\echo '=== Tables ==='
SELECT
  to_regclass('ai_knowledge_embeddings') IS NOT NULL AS embeddings_064,
  to_regclass('lead_views')              IS NOT NULL AS lead_views_096,
  to_regclass('ai_lead_reviews')         IS NOT NULL AS lead_reviews_097;

\echo ''
\echo '=== Columns ==='
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_configs'    AND column_name = 'confidence_threshold') AS handoff_064,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'lead_settings' AND column_name = 'sla_warn_hours')       AS sla_095,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'lead_settings' AND column_name = 'ai_lead_enabled')      AS lead_ai_097,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'conversations' AND column_name = 'ai_lead_checked_at')   AS conv_checked_097,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'leads'         AND column_name = 'ai_verdict')           AS verdict_098;

\echo ''
\echo '=== How much is trained ==='
-- Zero rows with the extension installed means nothing has been
-- embedded yet: the assistant is answering from keyword overlap, which
-- works but is the weaker half of what this app can do.
--
-- Wrapped, because naming a table that does not exist is a parse error
-- and would end the report on the one machine that most needs it.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('ai_knowledge_embeddings') IS NULL THEN
    RAISE NOTICE 'embedding_rows: table does not exist yet';
  ELSE
    EXECUTE 'SELECT count(*) FROM ai_knowledge_embeddings' INTO n;
    RAISE NOTICE 'embedding_rows: %', n;
  END IF;
END $$;
