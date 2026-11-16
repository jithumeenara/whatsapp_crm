-- 168: Messenger and Instagram connection details (plan:
-- docs/plans/meta-messenger-instagram-plan.md, phases 0 and 2).
--
--  human_agent_enabled  reply up to 7 days with Meta's HUMAN_AGENT tag —
--                       only once Meta approves the Human Agent feature;
--                       off by default.
--  connected_via        'manual' (a pasted token) or 'login' (one-click).
--  token_kind           what the token is (instagram_login, page, system_user).
--  token_expires_at     when it stops working (NULL = never expires).
--  granted_permissions  the permissions Meta granted, shown to the owner.
--  app_secret           (Instagram) an own app's secret, sealed by the app.
--
-- These tables are created by the app on first use, so each change runs
-- only where the table already exists. Safe to run twice.

DO $$
BEGIN
  IF to_regclass('public.facebook_config') IS NOT NULL THEN
    ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS human_agent_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS connected_via TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS token_kind TEXT;
    ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
    ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS granted_permissions JSONB;
  END IF;

  IF to_regclass('public.instagram_config') IS NOT NULL THEN
    ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS human_agent_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS connected_via TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS token_kind TEXT;
    ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
    ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS granted_permissions JSONB;
    ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS app_secret TEXT;
  END IF;
END $$;

-- Finding an earlier copy of a Meta message quickly (the webhooks check
-- before saving, because Meta resends notifications for up to 36 hours).
CREATE INDEX IF NOT EXISTS messages_conversation_message_id_idx
  ON messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL;
