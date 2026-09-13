-- Restore the database-level id defaults these tables were meant to have.
--
-- Production was failing every embedding insert with Postgres 23502,
-- not_null_violation, on a row whose id was null. The table is declared
--
--     id String @id @default(uuid()) @db.Uuid
--
-- in schema.prisma, and 064_ai_knowledge_embeddings.sql does create it
-- with DEFAULT gen_random_uuid(). But Prisma's @default(uuid()) is
-- generated in the *client*, not the database, so a table created by
-- `prisma db push` instead of by that SQL file has no DEFAULT on the
-- column at all — and these three tables are written through raw SQL
-- (pgvector has no Prisma type, and the config tables predate their
-- models), which never passes through the client-side generator.
--
-- The application no longer depends on this: every one of those inserts
-- now supplies its own id. This migration repairs the schema anyway, so
-- the next raw insert written against these tables cannot rediscover the
-- same failure.
--
-- Idempotent and safe to re-run: setting a default that is already set
-- changes nothing, and an existing row is never touched.

-- gen_random_uuid() is built in from PostgreSQL 13. On an older server
-- it lives in pgcrypto, so make sure it is available before relying on
-- it. IF NOT EXISTS means this is a no-op where it is already built in.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['ai_knowledge_embeddings', 'facebook_config', 'instagram_config']
  LOOP
    -- Only touch tables that actually exist on this deployment: the Meta
    -- config tables are created lazily by the app on first connect, so a
    -- deployment that has never linked a Facebook or Instagram page will
    -- not have them yet.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target AND column_name = 'id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()', target);
    END IF;
  END LOOP;
END $$;
