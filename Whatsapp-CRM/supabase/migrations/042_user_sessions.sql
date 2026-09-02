-- Real per-device session tracking (Settings > Profile > Sessions).
-- Each row is one login. auth.ts's authorize() creates a row and embeds
-- its id in the JWT (token.sessionId); the jwt callback checks
-- revoked_at on every request and rejects the token if set, so revoking
-- one row here actually forces that one device to sign in again -- not
-- just a UI list. session_invalidated_at (see 041) remains the bulk
-- "sign out everywhere" mechanism and is independent of this table.
CREATE TABLE IF NOT EXISTS user_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label  TEXT NOT NULL,
  user_agent    TEXT,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id);
