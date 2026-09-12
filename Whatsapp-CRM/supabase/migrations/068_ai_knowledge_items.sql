-- The knowledge base becomes real rows instead of two JSON blobs on
-- ai_configs (training_data = Q&A pairs, knowledge_documents = free
-- text). The rebuilt AI Training tab needs per-entry state a blob can't
-- carry: where each entry came from, when it last synced, whether its
-- embedding is current, and which single entry failed.
--
-- Additive and reversible: ai_configs.training_data and
-- knowledge_documents are left exactly as they are, unread by new code,
-- as a one-release rollback net — the same treatment the legacy
-- single-provider api_key/model columns already get.

CREATE TABLE ai_knowledge_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_config_id   uuid NOT NULL REFERENCES ai_configs(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  name           text NOT NULL,
  source         text NOT NULL DEFAULT 'manual',
  question       text,
  answer         text,
  content        text,
  source_url     text,
  source_ref     uuid,
  status         text NOT NULL DEFAULT 'pending',
  last_error     text,
  last_synced_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_knowledge_items_config_status_idx ON ai_knowledge_items (ai_config_id, status);
CREATE INDEX ai_knowledge_items_account_kind_idx  ON ai_knowledge_items (account_id, kind);

-- Backfill 1: every existing Q&A pair. Entries missing either half are
-- skipped — they were never usable for retrieval anyway (knowledge.ts
-- filters them out at read time today).
INSERT INTO ai_knowledge_items (ai_config_id, account_id, kind, name, source, question, answer, status, created_at)
SELECT
  c.id,
  c.account_id,
  'qa',
  -- The question doubles as the display name; trimmed so the table
  -- column stays readable for long ones.
  CASE WHEN length(pair->>'question') > 80
       THEN left(pair->>'question', 77) || '...'
       ELSE pair->>'question' END,
  'manual',
  pair->>'question',
  pair->>'answer',
  'pending',
  c.created_at
FROM ai_configs c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.training_data::jsonb) = 'array' THEN c.training_data::jsonb ELSE '[]'::jsonb END
) AS pair
WHERE coalesce(pair->>'question', '') <> ''
  AND coalesce(pair->>'answer', '') <> '';

-- Backfill 2: every existing free-text document.
INSERT INTO ai_knowledge_items (ai_config_id, account_id, kind, name, source, content, status, created_at)
SELECT
  c.id,
  c.account_id,
  'text',
  coalesce(nullif(doc->>'title', ''), 'Untitled document'),
  'manual',
  doc->>'content',
  'pending',
  c.created_at
FROM ai_configs c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.knowledge_documents::jsonb) = 'array' THEN c.knowledge_documents::jsonb ELSE '[]'::jsonb END
) AS doc
WHERE coalesce(doc->>'content', '') <> '';

-- Everything backfilled starts 'pending': the embedding rows keyed to
-- the old JSON text are still valid (same text, same content hash), but
-- status is only flipped to 'trained' by an actual sync run, so it is
-- never claiming a state nothing verified.

-- Training-tab controls that had no home in the schema. Defaults match
-- the behavior that was previously hardcoded in knowledge.ts, so no
-- existing account changes behavior on deploy.
ALTER TABLE ai_configs ADD COLUMN knowledge_base_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE ai_configs ADD COLUMN retrieval_mode text NOT NULL DEFAULT 'auto';
ALTER TABLE ai_configs ADD COLUMN max_context_results integer NOT NULL DEFAULT 5;
ALTER TABLE ai_configs ADD COLUMN auto_sync_website boolean NOT NULL DEFAULT false;
