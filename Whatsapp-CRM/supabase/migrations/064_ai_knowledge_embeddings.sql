-- Semantic knowledge retrieval + confidence-based handoff for ai_reply.
--
-- Additive only: ai_configs.training_data / knowledge_documents (JSON)
-- stay the source of truth for the knowledge base itself. This migration
-- adds a derived, droppable index table on top of them — dropping
-- ai_knowledge_embeddings is a complete, safe rollback, since
-- src/lib/ai/knowledge.ts falls back to its original keyword-overlap
-- scorer whenever no matching embedding rows exist.
--
-- Vector size (3072) matches gemini-embedding-001's documented default
-- output dimension (verified against ai.google.dev, Sept 2026) — the
-- account's own stored Gemini API key is reused for this, same as it's
-- already used for ai_reply's chat completions.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE ai_knowledge_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_config_id uuid NOT NULL REFERENCES ai_configs(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  kind text NOT NULL,
  embedding_model text NOT NULL,
  embedding vector(3072) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ai_config_id, content_hash, embedding_model)
);

-- Every real query filters to one ai_config_id first — no ANN index
-- (ivfflat/hnsw) needed at this scale; see the model's own schema comment.
CREATE INDEX ai_knowledge_embeddings_config_idx ON ai_knowledge_embeddings (ai_config_id);

-- Below this retrieval confidence, ai_reply hands off to a human instead
-- of answering — see engine.ts's ai_reply node handler. Off by default
-- (low_confidence_handoff_enabled = false): this is a real, code-enforced
-- behavior change, not just prompt guidance, so every existing account
-- keeps its current behavior until the owner opts in from Settings.
ALTER TABLE ai_configs ADD COLUMN confidence_threshold double precision NOT NULL DEFAULT 0.35;
ALTER TABLE ai_configs ADD COLUMN low_confidence_handoff_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE ai_configs ADD COLUMN low_confidence_assign_to uuid;
ALTER TABLE ai_configs ADD COLUMN low_confidence_message text;
