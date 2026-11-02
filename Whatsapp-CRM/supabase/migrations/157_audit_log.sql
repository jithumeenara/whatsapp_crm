-- 157: audit log — append-only, hash-chained record of who did what
-- (docs/plans/audit-log-plan.md).
--
-- audit_events       one row per event, partitioned by month; rows can be
--                    added, never changed or removed (triggers below)
-- audit_chain_heads  the newest seq/hash of each account's chain; the app
--                    moves it forward when it appends, and it is checked
--                    against the off-server copy, never trusted alone
-- audit_checkpoints  signed summaries of each chain (written by the
--                    crm-audit signer, phase 6); append-only too
--
-- The row hash is computed by the app (src/lib/audit/hash.ts) over every
-- column but row_hash, so this file only stores it.
--
-- Safe to run twice. Needs PostgreSQL 13+ (row triggers on partitions).

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 130000 THEN
    RAISE EXCEPTION 'audit log needs PostgreSQL 13 or newer (found %)', current_setting('server_version');
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS audit_events_id_seq;

CREATE TABLE IF NOT EXISTS audit_events (
  id             bigint      NOT NULL,
  seq            bigint      NOT NULL,
  account_id     uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL,
  ingested_at    timestamptz NOT NULL,
  actor_type     text        NOT NULL CHECK (actor_type IN ('user', 'api_key', 'agent', 'system', 'webhook', 'public')),
  actor_id       text,
  actor_label    text,
  actor_role     text,
  on_behalf_of   uuid,
  action         text        NOT NULL,
  category       text        NOT NULL,
  outcome        text        NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  reason         text,
  target_type    text,
  target_id      text,
  target_label   text,
  changes        jsonb,
  request_id     text,
  correlation_id text,
  source         text        NOT NULL,
  ip             text,
  user_agent     text,
  meta           jsonb,
  prev_hash      text        NOT NULL,
  row_hash       text        NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Indexes on the parent reach every partition, present and future.
CREATE INDEX IF NOT EXISTS audit_events_time_brin ON audit_events USING brin (occurred_at);
CREATE INDEX IF NOT EXISTS audit_events_account_time ON audit_events (account_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_account_seq ON audit_events (account_id, seq);
CREATE INDEX IF NOT EXISTS audit_events_target ON audit_events (account_id, target_type, target_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor ON audit_events (account_id, actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_request ON audit_events (account_id, request_id);
CREATE INDEX IF NOT EXISTS audit_events_correlation ON audit_events (account_id, correlation_id);

CREATE TABLE IF NOT EXISTS audit_chain_heads (
  account_id uuid        PRIMARY KEY,
  last_seq   bigint      NOT NULL,
  last_id    bigint      NOT NULL,
  last_hash  text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_checkpoints (
  id           bigserial   PRIMARY KEY,
  account_id   uuid        NOT NULL,
  through_seq  bigint      NOT NULL,
  through_hash text        NOT NULL,
  row_count    bigint      NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  signature    text        NOT NULL,
  key_id       text        NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_checkpoints_account ON audit_checkpoints (account_id, through_seq DESC);

-- ── Append-only ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only: % on % refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

DO $$
BEGIN
  -- Row triggers on a partitioned table are cloned onto every partition.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_events_no_change' AND tgrelid = 'audit_events'::regclass) THEN
    CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION audit_refuse_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_events_no_truncate' AND tgrelid = 'audit_events'::regclass) THEN
    CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_checkpoints_no_change' AND tgrelid = 'audit_checkpoints'::regclass) THEN
    CREATE TRIGGER audit_checkpoints_no_change BEFORE UPDATE OR DELETE ON audit_checkpoints
      FOR EACH ROW EXECUTE FUNCTION audit_refuse_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_checkpoints_no_truncate' AND tgrelid = 'audit_checkpoints'::regclass) THEN
    CREATE TRIGGER audit_checkpoints_no_truncate BEFORE TRUNCATE ON audit_checkpoints
      FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_change();
  END IF;
END $$;

-- ── Partitions ────────────────────────────────────────────────────────
-- A TRUNCATE aimed at one partition does not fire the parent's trigger,
-- so each partition gets its own. SECURITY DEFINER: once the tables move
-- to a separate owner role (plan §10), the app can still ask for next
-- month's partition without owning anything.

CREATE OR REPLACE FUNCTION audit_ensure_partition(p_month date) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  from_d date := date_trunc('month', p_month)::date;
  to_d   date := (date_trunc('month', p_month) + interval '1 month')::date;
  part   text := format('audit_events_%s', to_char(from_d, 'YYYYMM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)', part, from_d, to_d);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_part_no_truncate' AND tgrelid = part::regclass) THEN
    EXECUTE format('CREATE TRIGGER audit_part_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_change()', part);
  END IF;
  RETURN part;
END $$;

DO $$
BEGIN
  -- A safety net only: rows here mean a month's partition was missing
  -- (the daily check alarms on it).
  IF to_regclass('audit_events_default') IS NULL THEN
    CREATE TABLE audit_events_default PARTITION OF audit_events DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_part_no_truncate' AND tgrelid = 'audit_events_default'::regclass) THEN
    CREATE TRIGGER audit_part_no_truncate BEFORE TRUNCATE ON audit_events_default
      FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_change();
  END IF;
  -- This month and the next three; the app keeps three months ahead daily.
  FOR i IN 0..3 LOOP
    PERFORM audit_ensure_partition((date_trunc('month', now()) + make_interval(months => i))::date);
  END LOOP;
END $$;
