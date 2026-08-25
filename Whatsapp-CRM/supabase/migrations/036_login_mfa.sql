-- Login MFA: SMS OTP, WhatsApp OTP, or a Google-Authenticator-style TOTP
-- app. Defaults to 'disabled' for every existing user -- zero behavior
-- change until a user explicitly opts in from Settings > Profile > Security.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method TEXT NOT NULL DEFAULT 'disabled';
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose        TEXT NOT NULL,
  method         TEXT NOT NULL,
  code_hash      TEXT,
  pending_phone  TEXT,
  verified       BOOLEAN NOT NULL DEFAULT false,
  consumed_at    TIMESTAMPTZ,
  attempts       INTEGER NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user_id ON mfa_challenges (user_id);
