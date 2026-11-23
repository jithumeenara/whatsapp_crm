-- 195: Errors somebody can see.
--
-- Until now an error went to the pm2 log and nowhere else: nobody reads
-- it, and a browser error went nowhere at all. app_errors keeps one row
-- per distinct error (a fingerprint of where it happened and what it
-- said, with numbers and ids taken out), counting repeats instead of
-- storing every one. A sweep alerts owners and admins when a new error
-- repeats or errors suddenly spike.
--
-- Messages are stored with secrets, tokens and long numbers removed
-- (src/lib/errors/redact.ts) and cut to 500 characters.
--   account_id  the workspace it happened in, when known (NULL = server-wide)
--   source      'server' | 'browser'
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS app_errors (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint   TEXT        NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{40}$'),
  account_id    UUID        REFERENCES accounts(id) ON DELETE CASCADE,
  source        TEXT        NOT NULL CHECK (source IN ('server', 'browser')),
  where_at      TEXT        NOT NULL DEFAULT '' CHECK (char_length(where_at) <= 200),
  message       TEXT        NOT NULL CHECK (char_length(message) <= 500),
  count         INTEGER     NOT NULL DEFAULT 1 CHECK (count >= 1),
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  alerted_at    TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS app_errors_last_seen_idx ON app_errors (last_seen DESC);
CREATE INDEX IF NOT EXISTS app_errors_account_last_seen_idx ON app_errors (account_id, last_seen DESC);
