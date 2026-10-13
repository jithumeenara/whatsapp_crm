-- Rules the database itself keeps, so a bug in the app cannot put bad
-- data in or make a page crawl once real data grows.
--
-- 1. Indexes on the links and filters the busy pages use. Postgres does
--    not index a foreign key by itself; with 50 rows nobody notices, with
--    50,000 the Leads and Follow-ups pages read every row.
-- 2. Foreign keys for id columns that pointed at nothing in particular.
-- 3. Fixed lists for status columns the app writes (src/lib/status-lists.ts).
--
-- Constraints are added NOT VALID: every new or changed row is checked,
-- existing rows are left exactly as they are. Nothing is rewritten.
-- Small tables, so plain CREATE INDEX is fine; on a very large table run
-- the same statement by hand with CONCURRENTLY first.
--
-- Safe to run again.

-- ── 1. Indexes ─────────────────────────────────────────────────────────
DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['leads', 'account_id, status'], ARRAY['leads', 'contact_id'], ARRAY['leads', 'assigned_to'], ARRAY['leads', 'user_id'],
    ARRAY['follow_ups', 'account_id, due_at'], ARRAY['follow_ups', 'contact_id'], ARRAY['follow_ups', 'lead_id'],
    ARRAY['follow_ups', 'assigned_to'], ARRAY['follow_ups', 'user_id'],
    ARRAY['tasks', 'account_id, due_date'], ARRAY['tasks', 'contact_id'], ARRAY['tasks', 'lead_id'],
    ARRAY['tasks', 'assigned_to'], ARRAY['tasks', 'user_id'],
    ARRAY['deals', 'account_id'], ARRAY['deals', 'contact_id'], ARRAY['deals', 'lead_id'], ARRAY['deals', 'stage_id'],
    ARRAY['contacts', 'user_id'],
    ARRAY['contact_notes', 'contact_id'], ARRAY['contact_tags', 'tag_id'], ARRAY['contact_custom_values', 'custom_field_id'],
    ARRAY['conversations', 'contact_id'], ARRAY['conversations', 'assigned_agent_id'], ARRAY['conversations', 'user_id'],
    ARRAY['scheduled_messages', 'account_id'], ARRAY['scheduled_messages', 'contact_id'], ARRAY['scheduled_messages', 'conversation_id'],
    ARRAY['broadcast_recipients', 'broadcast_id'], ARRAY['broadcast_recipients', 'contact_id'], ARRAY['broadcasts', 'account_id'],
    ARRAY['automation_logs', 'automation_id'], ARRAY['automation_pending_executions', 'automation_id'], ARRAY['automations', 'account_id'],
    ARRAY['flow_runs', 'contact_id'], ARRAY['flow_runs', 'conversation_id'], ARRAY['flow_run_events', 'flow_run_id'],
    ARRAY['lead_activities', 'lead_id'], ARRAY['lead_activities', 'contact_id'],
    ARRAY['calls', 'conversation_id'], ARRAY['file_uploads', 'account_id'],
    ARRAY['pipelines', 'account_id'], ARRAY['pipeline_stages', 'pipeline_id'],
    ARRAY['segments', 'account_id'], ARRAY['tags', 'account_id'], ARRAY['custom_fields', 'account_id'],
    ARRAY['webhooks', 'table_id'], ARRAY['integrations', 'account_id'], ARRAY['integration_syncs', 'integration_id'],
    ARRAY['profiles', 'account_id']
  ];
  col text;
  ok boolean;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    IF to_regclass('public.' || spec[1]) IS NULL THEN CONTINUE; END IF;
    ok := true;
    FOREACH col IN ARRAY string_to_array(replace(spec[2], ' ', ''), ',') LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = spec[1] AND column_name = col) THEN
        ok := false;
      END IF;
    END LOOP;
    IF ok THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
        spec[1] || '_' || replace(replace(spec[2], ' ', ''), ',', '_') || '_idx', spec[1], spec[2]);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS contacts_merged_into_contact_id_idx ON contacts (merged_into_contact_id) WHERE merged_into_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_reply_to_message_id_idx ON messages (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

-- ── 2. Links that pointed at nothing in particular ──────────────────────
DO $$
DECLARE
  fk text[];
  fks text[][] := ARRAY[
    -- child table, column, parent table, on delete
    ARRAY['broadcasts', 'whatsapp_config_id', 'whatsapp_config', 'SET NULL'],
    ARRAY['catalog_config', 'default_pipeline_id', 'pipelines', 'SET NULL'],
    ARRAY['catalog_config', 'default_stage_id', 'pipeline_stages', 'SET NULL'],
    ARRAY['catalog_orders', 'contact_id', 'contacts', 'SET NULL'],
    ARRAY['catalog_orders', 'conversation_id', 'conversations', 'SET NULL'],
    ARRAY['catalog_orders', 'deal_id', 'deals', 'SET NULL'],
    ARRAY['catalog_orders', 'message_id', 'messages', 'SET NULL'],
    ARRAY['whatsapp_payments', 'contact_id', 'contacts', 'SET NULL'],
    ARRAY['whatsapp_payments', 'conversation_id', 'conversations', 'SET NULL'],
    ARRAY['data_fields', 'account_id', 'accounts', 'CASCADE'],
    ARRAY['data_records', 'account_id', 'accounts', 'CASCADE'],
    ARRAY['microsoft_mailboxes', 'user_id', 'users', 'RESTRICT']
  ];
  cname text;
BEGIN
  FOREACH fk SLICE 1 IN ARRAY fks LOOP
    IF to_regclass('public.' || fk[1]) IS NULL OR to_regclass('public.' || fk[3]) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = fk[1] AND column_name = fk[2]) THEN CONTINUE; END IF;
    cname := fk[1] || '_' || fk[2] || '_fkey';
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I (id) ON DELETE %s NOT VALID',
      fk[1], cname, fk[2], fk[3], fk[4]);
  END LOOP;
END $$;

-- ── 3. Fixed lists ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('low', 'medium', 'high', 'urgent')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_status_check') THEN
    ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_status_check CHECK (status IN ('pending', 'done', 'skipped')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_status_check') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_status_check CHECK (status IN ('open', 'pending', 'closed')) NOT VALID;
  END IF;
END $$;
