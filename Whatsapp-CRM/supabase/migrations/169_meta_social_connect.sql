-- 169: one-click "Connect Facebook & Instagram" (plan phase 2,
-- docs/plans/meta-messenger-instagram-plan.md).
--
--  meta_platform_config.social_config_id
--      The Facebook Login for Business configuration (system-user token)
--      used for Messenger + Instagram. The server owner sets it with the
--      app id / secret already kept here; a shared SaaS app later only
--      changes these values.
--
--  meta_connect_sessions
--      Between Meta's redirect and the owner choosing a Page / Instagram
--      account: the token sealed by the app, the choices, 15 minutes, one
--      use. Rows are removed once used or expired.
--
-- Safe to run twice.

ALTER TABLE meta_platform_config ADD COLUMN IF NOT EXISTS social_config_id TEXT;

CREATE TABLE IF NOT EXISTS meta_connect_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL,
  token       text        NOT NULL,
  options     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_connect_sessions_account_idx ON meta_connect_sessions (account_id, expires_at);
