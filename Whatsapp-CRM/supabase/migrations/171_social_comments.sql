-- 171: Comments on the workspace's Instagram posts and Facebook Page posts,
-- kept so the team can answer them from one Comments screen (public reply,
-- one private reply by DM within 7 days, hide, delete).
--
-- Filled by the Instagram / Facebook webhooks. One row per Meta comment per
-- workspace (the unique key makes a resent webhook harmless). Nothing here
-- is deleted when a comment is removed at Meta: deleted_at is set instead.
--
-- private_reply_by links to the person who sent the private reply; like
-- every link from business data to users it is ON DELETE RESTRICT
-- (migration 132) — removed members are switched off, never deleted.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS social_comments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel          TEXT        NOT NULL CHECK (channel IN ('instagram', 'facebook')),
  comment_id       TEXT        NOT NULL,
  parent_id        TEXT,
  post_id          TEXT,
  post_caption     TEXT,
  post_permalink   TEXT,
  from_id          TEXT,
  from_name        TEXT,
  contact_id       UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  text             TEXT,
  commented_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_hidden        BOOLEAN     NOT NULL DEFAULT false,
  deleted_at       TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  private_reply_at TIMESTAMPTZ,
  private_reply_by UUID        REFERENCES users(id) ON DELETE RESTRICT,
  replies          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_comments_one_per_account UNIQUE (account_id, channel, comment_id)
);

CREATE INDEX IF NOT EXISTS social_comments_account_time_idx
  ON social_comments (account_id, commented_at DESC);

CREATE INDEX IF NOT EXISTS social_comments_account_status_idx
  ON social_comments (account_id, status, commented_at DESC)
  WHERE deleted_at IS NULL;
