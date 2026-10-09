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
\echo '=== Migrations 072 and 099 onward, one row each ==='
-- One thing each migration creates, checked for existence. "NO" means
-- that migration has not run here. Every file from 072 on is safe to run
-- again, so scripts/apply-migrations.sh <first NO> 122 brings it up to
-- date; 064–071 are not, and are covered by the sections above.
--
-- A few columns are also added by the app itself at start-up (the
-- ensure* patches in server.ts), so a "yes" there can mean the app
-- patched it rather than that the file ran — harmless, the file is
-- still safe to run.
SELECT m.migration,
       CASE WHEN m.present THEN 'yes' ELSE 'NO' END AS applied
FROM (VALUES
  ('072_ai_accuracy_layer',             to_regclass('ai_eval_cases') IS NOT NULL),
  ('099_semantic_search_catchup',       to_regclass('ai_knowledge_embeddings') IS NOT NULL),
  ('100_agent_presence',                EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users'            AND column_name = 'last_seen_at')),
  ('101_agent_went_offline',            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users'            AND column_name = 'went_offline_at')),
  ('102_agent_working_hours',           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles'         AND column_name = 'working_hours')),
  ('103_business_timezone',             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'company_profiles' AND column_name = 'timezone')),
  ('104_ai_judgements',                 to_regclass('ai_judgements') IS NOT NULL),
  ('105_categories_and_scope',          to_regclass('service_categories') IS NOT NULL),
  ('106_lead_last_customer_at',         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads'            AND column_name = 'last_customer_at')),
  ('107_conversation_offers',           to_regclass('conversation_offers') IS NOT NULL),
  ('108_conversation_offers_one_pending', to_regclass('conversation_offers_one_pending_idx') IS NOT NULL),
  ('109_page_access',                   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles'         AND column_name = 'page_access')),
  ('110_lead_lost_at',                  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads'            AND column_name = 'lost_at')),
  ('111_microsoft_mailbox',             to_regclass('microsoft_mailboxes') IS NOT NULL),
  ('112_email_rich',                    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages'         AND column_name = 'email_meta')),
  ('113_data_store_tracking',           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'data_records'     AND column_name = 'source')),
  ('114_ai_reply_meta',                 EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages'         AND column_name = 'ai_meta')),
  ('115_data_table_ai_search',          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'data_tables'      AND column_name = 'ai_search')),
  ('116_eval_exact_checks',             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_eval_cases'    AND column_name = 'must_include')),
  ('117_ai_embedding_model',            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_configs'       AND column_name = 'embedding_model')),
  ('118_ai_handover_settings',          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_configs'       AND column_name = 'handover_settings')),
  ('119_saved_reports',                 to_regclass('saved_reports') IS NOT NULL),
  ('120_ai_image_settings',             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_configs'       AND column_name = 'image_settings')),
  ('121_registration_drafts',           to_regclass('registration_drafts') IS NOT NULL),
  ('122_users_email_case_insensitive',  to_regclass('users_email_lower_key') IS NOT NULL)
) AS m(migration, present)
ORDER BY m.migration;

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
