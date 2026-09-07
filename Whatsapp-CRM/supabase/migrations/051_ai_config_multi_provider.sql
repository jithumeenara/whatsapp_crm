-- Multi-provider AI config: Settings > AI Config was hardcoded to Gemini
-- everywhere (schema had a `provider` field but the API route always wrote
-- 'gemini' regardless). This adds real per-provider storage plus the new
-- "AI training" grounding/guardrail fields, without dropping the legacy
-- single-provider columns (kept as a rollback safety net for one release).
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS active_provider TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS fallback_provider TEXT;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS provider_keys JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS knowledge_documents JSONB NOT NULL DEFAULT '[]';
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS fallback_answer TEXT;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS escalation_topics JSONB NOT NULL DEFAULT '[]';
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS history_depth_default INT NOT NULL DEFAULT 6;

-- Backfill: copy any already-configured Gemini key into the new shape so no
-- existing customer silently loses their setup. The ciphertext format is
-- unchanged (same AES-256-GCM scheme via src/lib/whatsapp/encryption.ts),
-- so the existing encrypted value can be copied as-is.
UPDATE ai_configs
SET provider_keys = jsonb_build_object(
  'gemini', jsonb_build_object('api_key', api_key, 'model', model)
)
WHERE api_key IS NOT NULL AND provider_keys = '{}'::jsonb;
