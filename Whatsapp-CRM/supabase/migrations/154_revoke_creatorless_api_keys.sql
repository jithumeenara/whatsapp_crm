-- 154: turn off API keys that have no recorded creator.
--
-- Why
--   Until the 2026-10 security audit any member of an account — a viewer or
--   an agent included — could mint an API key (finding A2-01), and every key
--   acts at supervisor rank. Migration 152 started recording who mints a key
--   (api_keys.created_by_user_id), but keys made before it have NULL there,
--   and they were treated as the owner's and kept working for ever: they
--   survived the removal or demotion of whoever made them, because
--   deactivateMember revokes only keys WHERE created_by_user_id = that member.
--   (Security review N2.) The owner decided: revoke them at deploy, and have
--   owners create new keys. The app refuses such keys too (verifyApiKey), so
--   the hole is closed even before this runs.
--
-- What
--   1. api_key_revocations_154 records exactly which keys this migration
--      revoked (and for which account), so the rollback below restores only
--      those, and Settings → API keys can tell the owner why their old keys
--      stopped working.
--   2. Every key with created_by_user_id IS NULL and still active is
--      soft-revoked (revoked_at = now()). Nothing is deleted.
--
-- Safe to run twice: the record table is IF NOT EXISTS, the insert skips ids
-- already recorded, and the update touches only active rows it recorded.
-- Dry-run inside BEGIN … ROLLBACK on crm_prod_copy first.

CREATE TABLE IF NOT EXISTS api_key_revocations_154 (
  key_id     uuid PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_key_revocations_154_account_idx ON api_key_revocations_154 (account_id);

INSERT INTO api_key_revocations_154 (key_id, account_id, revoked_at)
SELECT id, account_id, now()
  FROM api_keys
 WHERE created_by_user_id IS NULL
   AND revoked_at IS NULL
ON CONFLICT (key_id) DO NOTHING;

UPDATE api_keys k
   SET revoked_at = r.revoked_at
  FROM api_key_revocations_154 r
 WHERE k.id = r.key_id
   AND k.created_by_user_id IS NULL
   AND k.revoked_at IS NULL;

-- ROLLBACK (run by hand, only if this must be undone). It re-activates only
-- the keys this migration revoked, and only if nothing has revoked them
-- since (their revoked_at is still the one recorded here); then drops the
-- record table. Roll the app back first: current code refuses creatorless
-- keys whatever this table says.
--
--   BEGIN;
--   UPDATE api_keys k
--      SET revoked_at = NULL
--     FROM api_key_revocations_154 r
--    WHERE k.id = r.key_id
--      AND k.revoked_at = r.revoked_at;
--   DROP TABLE IF EXISTS api_key_revocations_154;
--   COMMIT;
