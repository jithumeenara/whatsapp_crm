-- Google Connections Hub.
--
-- One Google connection per account now carries several services
-- (Sheets, Drive, Gmail, Calendar, Contacts…), each switched on by the
-- permissions Google actually granted. Google lets people untick single
-- permissions on its consent screen, so what was granted is stored, not
-- assumed.
--
-- Safe to run again.

ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS granted_scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS enabled_services TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS config_check JSONB;
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS config_checked_at TIMESTAMPTZ;
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS last_health_at TIMESTAMPTZ;

-- Connections made before the hub had only drive.file, used by Sheets.
UPDATE google_connections
SET granted_scopes = ARRAY['openid', 'email', 'https://www.googleapis.com/auth/drive.file'],
    enabled_services = ARRAY['sheets', 'drive'],
    connected_at = COALESCE(connected_at, updated_at)
WHERE refresh_token IS NOT NULL AND cardinality(granted_scopes) = 0;

CREATE TABLE IF NOT EXISTS google_activity (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_activity_account_created_idx ON google_activity (account_id, created_at DESC);
