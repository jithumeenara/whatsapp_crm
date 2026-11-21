-- 174: One row per day per connected Instagram account / Facebook Page with
-- its follower count, so the Social screen can draw follower growth (Meta
-- gives only today's number; history has to be kept by us).
--
-- Written by the connection sweep (server.ts, at most once per day per
-- channel). Numbers only — no personal data. Safe to run twice.
-- (173 is taken by lead summaries on another branch.)

CREATE TABLE IF NOT EXISTS social_account_snapshots (
  account_id   UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel      TEXT        NOT NULL CHECK (channel IN ('instagram', 'facebook')),
  day          DATE        NOT NULL,
  followers    INTEGER,
  follows      INTEGER,
  media_count  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, channel, day)
);
