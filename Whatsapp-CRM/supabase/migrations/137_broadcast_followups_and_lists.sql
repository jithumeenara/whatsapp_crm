-- Broadcast follow-ups and contact lists.
--
--   broadcasts.parent_broadcast_id / parent_outcome
--       A follow-up remembers which broadcast and which group of its
--       recipients ("read_no_reply", …) it was sent to, so the report can
--       show the chain, and the send can skip anyone who has since replied.
--   contact_lists / contact_list_members
--       Saved, fixed sets of contacts (from a broadcast group, a CSV, or
--       picked by hand), usable as a broadcast audience. Deleting a list
--       never deletes a contact; deleting a contact only removes it from
--       lists. A list's creator is RESTRICT, like every other link to users
--       (migration 132): removing a member never removes their lists.
--   (broadcast_recipients already has its (broadcast_id, status) index,
--   idx_broadcast_recipients_broadcast_status from migration 003.)
--
-- Safe to run again.

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS parent_broadcast_id UUID;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS parent_outcome TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_parent_broadcast_id_fkey') THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_parent_broadcast_id_fkey
      FOREIGN KEY (parent_broadcast_id) REFERENCES broadcasts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_parent_outcome_check') THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_parent_outcome_check
      CHECK (parent_outcome IS NULL OR parent_outcome IN
        ('replied', 'read_no_reply', 'not_opened', 'not_delivered_yet', 'not_delivered'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS broadcasts_parent_broadcast_id_idx ON broadcasts (parent_broadcast_id);

CREATE TABLE IF NOT EXISTS contact_lists (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description         TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  -- 'broadcast' (a group of a broadcast's recipients) | 'csv' | 'manual'
  source              TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('broadcast', 'csv', 'manual')),
  source_broadcast_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL,
  source_outcome      TEXT,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_lists_account_id_idx ON contact_lists (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS contact_lists_account_name_key ON contact_lists (account_id, lower(name));

CREATE TABLE IF NOT EXISTS contact_list_members (
  list_id    UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);
CREATE INDEX IF NOT EXISTS contact_list_members_contact_id_idx ON contact_list_members (contact_id);
