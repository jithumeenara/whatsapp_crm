-- Admin Chat phase 4: actions from the chat, each confirmed.
--
-- The assistant only proposes; nothing changes until the admin replies
-- "YES <code>" with the 4-digit code given for that one action (5 minutes).
-- Small actions (follow-up, tag, assign a chat, lead) then run, and can be
-- undone for 10 minutes. Actions that reach customers (a template to one
-- person, a broadcast draft) also need the web: a one-time link that only
-- opens for a signed-in admin of the account, confirmed with their
-- authenticator code — and a broadcast for more than 50 people needs a
-- different owner/admin to approve it there. A broadcast is only ever
-- created as a draft; sending it stays on the Broadcasts page.
--
--   admin_chat_members.scope gains 'actions' (reports + lookup + actions).
--   admin_chat_actions  one row per proposed action, with its state, the
--                       hashes of its codes, what it did (for undo).
--
-- Safe to run again.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_chat_members_scope_check') THEN
    ALTER TABLE admin_chat_members DROP CONSTRAINT admin_chat_members_scope_check;
  END IF;
  ALTER TABLE admin_chat_members ADD CONSTRAINT admin_chat_members_scope_check CHECK (scope IN ('reports', 'lookup', 'actions'));
END $$;

CREATE TABLE IF NOT EXISTS admin_chat_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_id           UUID NOT NULL REFERENCES admin_chat_members(id) ON DELETE CASCADE,
  session_id          UUID REFERENCES admin_chat_sessions(id) ON DELETE SET NULL,
  requested_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind                TEXT NOT NULL,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'proposed',
  confirm_code_hash   TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  needs_other_approver BOOLEAN NOT NULL DEFAULT false,
  approved_by         UUID REFERENCES users(id) ON DELETE RESTRICT,
  recipients          INTEGER,
  result              JSONB,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at             TIMESTAMPTZ,
  CONSTRAINT admin_chat_actions_kind_check CHECK (kind IN ('add_follow_up', 'add_tag', 'assign_chat', 'create_lead', 'send_template', 'prepare_broadcast')),
  CONSTRAINT admin_chat_actions_status_check CHECK (status IN ('proposed', 'awaiting_web', 'done', 'rejected', 'expired', 'undone', 'failed'))
);
CREATE INDEX IF NOT EXISTS admin_chat_actions_member ON admin_chat_actions (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_chat_actions_account ON admin_chat_actions (account_id, status, created_at DESC);
