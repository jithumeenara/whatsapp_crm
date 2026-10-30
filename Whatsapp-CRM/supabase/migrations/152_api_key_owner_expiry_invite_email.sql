-- 152: API keys answer to whoever made them; invitations name who they are for.
--
-- api_keys
--   created_by_user_id  who minted the key. Every request made with it
--                       re-checks that person is still a member of the
--                       key's account at no less than the key's own rank
--                       (supervisor), so removing or demoting a member ends
--                       their keys. NULL = a key minted before this column:
--                       it belongs to the account owner and keeps working.
--                       ON DELETE RESTRICT, like every link to users since
--                       migration 132: people are switched off, not deleted.
--   expires_at          optional end of life, set when the key is minted.
--   revoked_at          soft revocation (set when the creator is removed),
--                       kept for the audit trail; refused like a deleted key.
--
-- account_invitations
--   email               who the invitation is for, trimmed and lowercased.
--                       Redeeming it needs a login with that address. NULL =
--                       a link made before this column (or without an
--                       address): it works as before, once, for anyone.
--
-- Nothing is deleted or rewritten; every existing row keeps working.
-- Safe to run twice.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS created_by_user_id uuid;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'api_keys_created_by_user_id_fkey'
       AND conrelid = 'public.api_keys'::regclass
  ) THEN
    ALTER TABLE api_keys
      ADD CONSTRAINT api_keys_created_by_user_id_fkey
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS api_keys_created_by_user_id_idx ON api_keys (created_by_user_id);

ALTER TABLE account_invitations ADD COLUMN IF NOT EXISTS email text;

-- An address is stored already normalised; refuse anything that is not,
-- so a row written by a script cannot silently never match.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'account_invitations_email_normalised'
       AND conrelid = 'public.account_invitations'::regclass
  ) THEN
    ALTER TABLE account_invitations
      ADD CONSTRAINT account_invitations_email_normalised
      CHECK (email IS NULL OR email = lower(btrim(email))) NOT VALID;
    ALTER TABLE account_invitations VALIDATE CONSTRAINT account_invitations_email_normalised;
  END IF;
END $$;

-- ROLLBACK (run by hand, inside BEGIN … COMMIT, only if this must be undone;
-- it drops only what this file added — the data in these columns is lost,
-- everything else is untouched):
--
--   BEGIN;
--   ALTER TABLE account_invitations DROP CONSTRAINT IF EXISTS account_invitations_email_normalised;
--   ALTER TABLE account_invitations DROP COLUMN IF EXISTS email;
--   DROP INDEX IF EXISTS api_keys_created_by_user_id_idx;
--   ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_created_by_user_id_fkey;
--   ALTER TABLE api_keys DROP COLUMN IF EXISTS revoked_at;
--   ALTER TABLE api_keys DROP COLUMN IF EXISTS expires_at;
--   ALTER TABLE api_keys DROP COLUMN IF EXISTS created_by_user_id;
--   COMMIT;
--
-- Roll the app back first: code from this change selects these columns.
