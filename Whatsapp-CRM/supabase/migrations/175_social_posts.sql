-- 175: Posts published (now or at a set time) to the workspace's Instagram
-- account and Facebook Page from the Social screen.
--
-- The minute job claims due rows with FOR UPDATE SKIP LOCKED, so one post is
-- never published twice; results keeps each channel's outcome, so a retry
-- skips a channel that already went out. client_key makes a double-clicked
-- "Publish" one post. created_by links to users ON DELETE RESTRICT (like all
-- links from business data to users, migration 132).
--
-- Safe to run twice. (173 is lead summaries on another branch.)

CREATE TABLE IF NOT EXISTS social_posts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    UUID        REFERENCES users(id) ON DELETE RESTRICT,
  client_key    TEXT        NOT NULL,
  channels      TEXT[]      NOT NULL,
  post_type     TEXT        NOT NULL DEFAULT 'feed' CHECK (post_type IN ('feed', 'reel', 'story')),
  caption       TEXT,
  media         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT        NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled')),
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at     TIMESTAMPTZ,
  attempts      INTEGER     NOT NULL DEFAULT 0,
  results       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_posts_one_per_click UNIQUE (account_id, client_key)
);

CREATE INDEX IF NOT EXISTS social_posts_due_idx
  ON social_posts (scheduled_at)
  WHERE status IN ('scheduled', 'publishing');

CREATE INDEX IF NOT EXISTS social_posts_account_idx
  ON social_posts (account_id, scheduled_at DESC);
