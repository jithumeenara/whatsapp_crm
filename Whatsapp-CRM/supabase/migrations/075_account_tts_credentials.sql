-- 075 — per-account Google Cloud credentials for text-to-speech.
--
-- Until now the service account could only be supplied as an environment
-- variable on the server. That is defensible for a single deployment and
-- useless for the person who actually wants the feature: it cannot be
-- done from the product, it needs shell access, and on a multi-tenant
-- install every account is forced to share one Cloud project.
--
-- Stored encrypted with the same AES-256-GCM helper that already holds
-- this account's WhatsApp access token, its Gemini API key and its
-- payment-gateway secrets. A service-account key is a wider grant than
-- an API key, so it is worth saying plainly why this is acceptable: the
-- alternative was a feature nobody could switch on, and the material
-- sitting beside it in the same row is already enough to send messages
-- as the business and spend its money.
--
-- The environment variable still works and is used when an account has
-- uploaded nothing, so existing deployments are unaffected.

ALTER TABLE ai_configs
  -- Encrypted service-account JSON. Never returned to a client; the API
  -- reports only whether one is present and which project it names.
  ADD COLUMN IF NOT EXISTS google_tts_credentials TEXT,
  -- Shown in Settings so somebody can confirm which key is loaded without
  -- the key being readable. Safe on its own: an email address and a
  -- project id grant nothing.
  ADD COLUMN IF NOT EXISTS google_tts_client_email TEXT,
  ADD COLUMN IF NOT EXISTS google_tts_project_id TEXT,
  ADD COLUMN IF NOT EXISTS google_tts_verified_at TIMESTAMPTZ;
