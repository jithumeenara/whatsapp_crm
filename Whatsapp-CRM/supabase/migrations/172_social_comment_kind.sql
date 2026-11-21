-- 172: Instagram @mentions on the Comments screen.
-- kind = 'comment' (on the workspace's own post) or 'mention' (someone
-- mentioned the account in their own caption or comment). A mention can be
-- answered publicly but not hidden, deleted or answered privately — it is
-- on someone else's post. Safe to run twice; runs only when the table exists.

DO $$
BEGIN
  IF to_regclass('public.social_comments') IS NOT NULL THEN
    ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_comments_kind_check') THEN
      ALTER TABLE social_comments ADD CONSTRAINT social_comments_kind_check CHECK (kind IN ('comment', 'mention'));
    END IF;
  END IF;
END $$;
