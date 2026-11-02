-- Audit log role split (docs/plans/audit-log-plan.md §10 phase 6, §20a).
--
-- Run ONCE per server by the server owner, from the admin connection the
-- app never holds — never from a migration the app could replay:
--
--   sudo -u postgres psql -d <database> -v app_role=<app db role> -f docs/deploy/audit-role-split.sql
--     ACSTI:    -d <acsti db>    -v app_role=acsti_data
--     Hospital: -d <hospital db> -v app_role=db_spfort
--
-- Afterwards:
--   crm_audit_owner (NOLOGIN) owns audit_events (+ every partition),
--     audit_chain_heads, audit_checkpoints, the id sequence and the two
--     audit functions. Nobody logs in as it.
--   the app role can SELECT + INSERT events, read/insert/update the chain
--     heads, ask for a new month's partition (SECURITY DEFINER function)
--     and read checkpoints. It can no longer UPDATE, DELETE, TRUNCATE,
--     DROP, ALTER, DETACH or disable a trigger on any audit table.
--   schema public is owned by postgres (not by the app role / the
--     database owner), so the app can drop only what it owns itself; it
--     keeps USAGE + CREATE on public for its own tables.
--   crm_audit_reader (LOGIN) — the crm-audit signer: read the audit
--     tables, INSERT checkpoints. Its password is set by audit-setup.sh
--     (or by hand: sudo -u postgres psql -c '\password crm_audit_reader').
--
-- Safe to run again (guarded blocks; ownership and grants are re-applied
-- to the same end state). Changes nothing if a precondition fails.
--
-- RESTORE CAVEAT: a dump restored by the app role makes the app role the
-- owner again. After any restore (always into a NEW database first), run
-- this file again on the restored database, then the chain check against
-- the newest off-server checkpoint (plan §10/§13).
-- MIGRATION CAVEAT: after this, migration 157 must not be re-run by the
-- app role (it is not the owner of the functions any more); a future
-- migration that changes audit tables is run as:
--   sudo -u postgres psql -d <db> -c 'SET ROLE crm_audit_owner' -f <file>

\set ON_ERROR_STOP on
\if :{?app_role}
\else
  \echo 'usage: sudo -u postgres psql -d <db> -v app_role=<app db role> -f docs/deploy/audit-role-split.sql'
  \quit
\endif

BEGIN;
-- Session-wide (false): the pass/fail table after COMMIT reads it too.
SELECT set_config('audit.app_role', :'app_role', false);

-- ── Preconditions (plan §10) ───────────────────────────────────────────
DO $$
DECLARE
  app text := current_setting('audit.app_role');
  r   record;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'run this as the postgres superuser (sudo -u postgres psql ...), not as %', current_user;
  END IF;
  SELECT rolsuper, rolcreaterole, rolbypassrls INTO r FROM pg_roles WHERE rolname = app;
  IF NOT FOUND THEN RAISE EXCEPTION 'app role "%" does not exist', app; END IF;
  IF r.rolsuper THEN RAISE EXCEPTION 'app role "%" is a SUPERUSER — the split cannot protect anything; stop (plan §10)', app; END IF;
  IF r.rolcreaterole THEN RAISE EXCEPTION 'app role "%" has CREATEROLE — it could join the owner role; stop (plan §10)', app; END IF;
  IF app IN ('crm_audit_owner', 'crm_audit_reader', 'postgres') THEN RAISE EXCEPTION 'app_role cannot be %', app; END IF;
  IF to_regclass('public.audit_events') IS NULL OR to_regclass('public.audit_chain_heads') IS NULL OR to_regclass('public.audit_checkpoints') IS NULL THEN
    RAISE EXCEPTION 'audit tables not found in database % — apply migration 157 first', current_database();
  END IF;
  IF to_regprocedure('public.audit_ensure_partition(date)') IS NULL OR to_regprocedure('public.audit_refuse_change()') IS NULL THEN
    RAISE EXCEPTION 'audit functions not found — apply migration 157 first';
  END IF;
END $$;

-- ── Roles ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  app text := current_setting('audit.app_role');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_audit_owner') THEN
    CREATE ROLE crm_audit_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  ALTER ROLE crm_audit_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_audit_reader') THEN
    -- No password yet: it cannot log in until audit-setup.sh sets one.
    CREATE ROLE crm_audit_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
  END IF;
  ALTER ROLE crm_audit_reader NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

  -- Nobody may act as the owner: neither the app nor the signer.
  IF pg_has_role(app, 'crm_audit_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'app role "%" is a member of crm_audit_owner — remove that membership first (REVOKE crm_audit_owner FROM %)', app, app;
  END IF;
  IF pg_has_role('crm_audit_reader', 'crm_audit_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'crm_audit_reader is a member of crm_audit_owner — remove that membership first';
  END IF;
  IF pg_has_role(app, 'crm_audit_reader', 'MEMBER') THEN
    RAISE EXCEPTION 'app role "%" is a member of crm_audit_reader — remove that membership first', app;
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO crm_audit_reader', current_database());
END $$;

-- ── Schema public ──────────────────────────────────────────────────────
-- Whoever owns a schema may DROP anything inside it, whoever owns the
-- object. The app role usually owns the database, and since PostgreSQL 15
-- schema public belongs to pg_database_owner — i.e. to the app role — so
-- without this the app could still DROP audit_events, a partition or the
-- audit functions. The schema goes to the superuser running this file
-- (postgres); the app keeps USAGE + CREATE, so it still creates, alters and
-- drops ITS OWN tables (migrations, runtime schema patches) but nothing it
-- does not own.
DO $$
DECLARE
  app text := current_setting('audit.app_role');
BEGIN
  IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') IS DISTINCT FROM current_user THEN
    EXECUTE format('ALTER SCHEMA public OWNER TO %I', current_user);
  END IF;
  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', app);
END $$;

-- The owner creates next month's partition inside audit_ensure_partition;
-- since PostgreSQL 15 PUBLIC has no CREATE on schema public.
GRANT USAGE, CREATE ON SCHEMA public TO crm_audit_owner;
GRANT USAGE ON SCHEMA public TO crm_audit_reader;

-- ── Ownership ──────────────────────────────────────────────────────────
DO $$
DECLARE
  p record;
BEGIN
  ALTER TABLE public.audit_events OWNER TO crm_audit_owner;
  -- ALTER TABLE ... OWNER on the parent does not reach its partitions.
  FOR p IN SELECT c.oid::regclass AS rel FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
            WHERE i.inhparent = 'public.audit_events'::regclass LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO crm_audit_owner', p.rel);
  END LOOP;
  ALTER TABLE public.audit_chain_heads OWNER TO crm_audit_owner;
  -- audit_checkpoints_id_seq is owned by its column and follows the table.
  ALTER TABLE public.audit_checkpoints OWNER TO crm_audit_owner;
  ALTER SEQUENCE public.audit_events_id_seq OWNER TO crm_audit_owner;
  ALTER FUNCTION public.audit_ensure_partition(date) OWNER TO crm_audit_owner;
  ALTER FUNCTION public.audit_refuse_change() OWNER TO crm_audit_owner;
END $$;

-- ── Privileges ─────────────────────────────────────────────────────────
DO $$
DECLARE
  app text := current_setting('audit.app_role');
  p   record;
BEGIN
  -- Start from nothing, then grant exactly what each role needs.
  EXECUTE format('REVOKE ALL ON public.audit_events, public.audit_chain_heads, public.audit_checkpoints FROM PUBLIC, %I, crm_audit_reader', app);
  EXECUTE format('REVOKE ALL ON SEQUENCE public.audit_events_id_seq, public.audit_checkpoints_id_seq FROM PUBLIC, %I, crm_audit_reader', app);

  -- App: append events (Prisma's INSERT ... RETURNING needs SELECT too) and move the head.
  EXECUTE format('GRANT SELECT, INSERT ON public.audit_events TO %I', app);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.audit_chain_heads TO %I', app);
  EXECUTE format('GRANT SELECT ON public.audit_checkpoints TO %I', app);
  -- nextval needs USAGE; pg_dump (nightly backup, run as the app role) needs SELECT.
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.audit_events_id_seq TO %I', app);
  EXECUTE format('GRANT SELECT ON SEQUENCE public.audit_checkpoints_id_seq TO %I', app);

  -- Signer: read everything, add checkpoints, nothing else.
  GRANT SELECT ON public.audit_events, public.audit_chain_heads TO crm_audit_reader;
  GRANT SELECT, INSERT ON public.audit_checkpoints TO crm_audit_reader;
  GRANT USAGE, SELECT ON SEQUENCE public.audit_checkpoints_id_seq TO crm_audit_reader;

  -- Partitions: pg_dump copies each partition on its own and the app
  -- counts the default partition directly, so both need SELECT on each.
  FOR p IN SELECT c.oid::regclass AS rel FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
            WHERE i.inhparent = 'public.audit_events'::regclass LOOP
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, %I, crm_audit_reader', p.rel, app);
    EXECUTE format('GRANT SELECT ON %s TO %I, crm_audit_reader', p.rel, app);
  END LOOP;
  -- ...and on every partition the owner creates later.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE crm_audit_owner IN SCHEMA public GRANT SELECT ON TABLES TO %I, crm_audit_reader', app);

  -- Functions: only the app may ask for a partition.
  REVOKE ALL ON FUNCTION public.audit_ensure_partition(date) FROM PUBLIC;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.audit_ensure_partition(date) TO %I', app);
END $$;

COMMIT;

-- ── Pass / fail table ──────────────────────────────────────────────────
-- "can drop": PostgreSQL lets the object's owner OR the schema's owner
-- (or anyone who is a member of either) drop it.
WITH app AS (SELECT current_setting('audit.app_role', true) AS r),
nsp AS (SELECT nspowner FROM pg_namespace WHERE nspname = 'public'),
parts AS (
  SELECT c.oid::regclass::text AS rel, pg_get_userbyid(c.relowner) AS owner, c.relowner
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = 'public.audit_events'::regclass
),
can_drop AS (
  SELECT 'table audit_events' AS obj, (pg_has_role(app.r, c.relowner, 'MEMBER') OR pg_has_role(app.r, nsp.nspowner, 'MEMBER')) AS yes
    FROM pg_class c, app, nsp WHERE c.oid = 'public.audit_events'::regclass
  UNION ALL SELECT 'a partition', bool_or(pg_has_role(app.r, p.relowner, 'MEMBER') OR pg_has_role(app.r, nsp.nspowner, 'MEMBER'))
    FROM parts p, app, nsp
  UNION ALL SELECT 'function audit_refuse_change()', pg_has_role(app.r, p.proowner, 'MEMBER') OR pg_has_role(app.r, nsp.nspowner, 'MEMBER')
    FROM pg_proc p, app, nsp WHERE p.oid = 'public.audit_refuse_change()'::regprocedure
  UNION ALL SELECT 'function audit_ensure_partition(date)', pg_has_role(app.r, p.proowner, 'MEMBER') OR pg_has_role(app.r, nsp.nspowner, 'MEMBER')
    FROM pg_proc p, app, nsp WHERE p.oid = 'public.audit_ensure_partition(date)'::regprocedure
),
checks(check_name, ok) AS (
  SELECT 'app role is not superuser', NOT rolsuper FROM pg_roles, app WHERE rolname = app.r
  UNION ALL SELECT 'app role has no CREATEROLE', NOT rolcreaterole FROM pg_roles, app WHERE rolname = app.r
  UNION ALL SELECT 'app role is not a member of crm_audit_owner', NOT pg_has_role(app.r, 'crm_audit_owner', 'MEMBER') FROM app
  UNION ALL SELECT 'crm_audit_owner cannot log in', NOT rolcanlogin FROM pg_roles WHERE rolname = 'crm_audit_owner'
  UNION ALL SELECT 'audit_events owned by crm_audit_owner', pg_get_userbyid(relowner) = 'crm_audit_owner' FROM pg_class WHERE oid = 'public.audit_events'::regclass
  UNION ALL SELECT 'every partition owned by crm_audit_owner (' || count(*) || ')', bool_and(owner = 'crm_audit_owner') FROM parts
  UNION ALL SELECT 'audit_chain_heads owned by crm_audit_owner', pg_get_userbyid(relowner) = 'crm_audit_owner' FROM pg_class WHERE oid = 'public.audit_chain_heads'::regclass
  UNION ALL SELECT 'audit_checkpoints owned by crm_audit_owner', pg_get_userbyid(relowner) = 'crm_audit_owner' FROM pg_class WHERE oid = 'public.audit_checkpoints'::regclass
  UNION ALL SELECT 'audit functions owned by crm_audit_owner', bool_and(pg_get_userbyid(proowner) = 'crm_audit_owner') FROM pg_proc WHERE proname IN ('audit_ensure_partition', 'audit_refuse_change')
  UNION ALL SELECT 'app can INSERT + SELECT events', has_table_privilege(app.r, 'public.audit_events', 'INSERT') AND has_table_privilege(app.r, 'public.audit_events', 'SELECT') FROM app
  UNION ALL SELECT 'app cannot UPDATE/DELETE/TRUNCATE events', NOT (has_table_privilege(app.r, 'public.audit_events', 'UPDATE') OR has_table_privilege(app.r, 'public.audit_events', 'DELETE') OR has_table_privilege(app.r, 'public.audit_events', 'TRUNCATE')) FROM app
  UNION ALL SELECT 'app cannot UPDATE/DELETE/TRUNCATE any partition', bool_and(NOT (has_table_privilege(app.r, rel, 'UPDATE') OR has_table_privilege(app.r, rel, 'DELETE') OR has_table_privilege(app.r, rel, 'TRUNCATE'))) FROM parts, app
  UNION ALL SELECT 'app cannot UPDATE/DELETE/TRUNCATE checkpoints', NOT (has_table_privilege(app.r, 'public.audit_checkpoints', 'UPDATE') OR has_table_privilege(app.r, 'public.audit_checkpoints', 'DELETE') OR has_table_privilege(app.r, 'public.audit_checkpoints', 'TRUNCATE') OR has_table_privilege(app.r, 'public.audit_checkpoints', 'INSERT')) FROM app
  UNION ALL SELECT 'app can move the chain head', has_table_privilege(app.r, 'public.audit_chain_heads', 'UPDATE') AND has_table_privilege(app.r, 'public.audit_chain_heads', 'INSERT') FROM app
  UNION ALL SELECT 'app can create partitions (EXECUTE audit_ensure_partition)', has_function_privilege(app.r, 'public.audit_ensure_partition(date)', 'EXECUTE') FROM app
  UNION ALL SELECT 'reader can INSERT checkpoints only', has_table_privilege('crm_audit_reader', 'public.audit_checkpoints', 'INSERT') AND NOT has_table_privilege('crm_audit_reader', 'public.audit_events', 'INSERT') AND NOT has_table_privilege('crm_audit_reader', 'public.audit_chain_heads', 'UPDATE')
  UNION ALL SELECT 'reader cannot create partitions', NOT has_function_privilege('crm_audit_reader', 'public.audit_ensure_partition(date)', 'EXECUTE')
  UNION ALL SELECT 'app role is not owner of schema public (owner: ' || pg_get_userbyid(nsp.nspowner) || ')', NOT pg_has_role(app.r, nsp.nspowner, 'MEMBER') FROM app, nsp
  UNION ALL SELECT 'app role can still CREATE its own tables in public', has_schema_privilege(app.r, 'public', 'CREATE') AND has_schema_privilege(app.r, 'public', 'USAGE') FROM app
  UNION ALL SELECT 'app role cannot DROP ' || obj, NOT coalesce(yes, false) FROM can_drop
  -- ALTER SCHEMA ... OWNER needs to own the schema (or be a member of its owner).
  UNION ALL SELECT 'app role cannot ALTER SCHEMA public OWNER', NOT pg_has_role(app.r, nsp.nspowner, 'MEMBER') FROM app, nsp
),
info(result, check_name) AS (
  -- Not a failure: the database owner can still DROP DATABASE (it cannot
  -- touch the audit rows inside it). The nightly backup and the R2 copy of
  -- every event and checkpoint cover that case (docs/deploy/audit-setup.md).
  SELECT 'INFO', CASE WHEN pg_has_role(app.r, d.datdba, 'MEMBER')
                      THEN 'app role owns database ' || d.datname || ' — it could DROP DATABASE; backups + R2 cover that'
                      ELSE 'app role does not own database ' || d.datname || ' (owner: ' || pg_get_userbyid(d.datdba) || ')' END
    FROM pg_database d, app WHERE d.datname = current_database()
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, check_name FROM checks
UNION ALL SELECT result, check_name FROM info;
