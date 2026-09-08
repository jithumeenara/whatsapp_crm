-- IG·04 — Merge contacts across channels. Deliberately manual (a "Merge
-- with…" action, never automatic fuzzy-matching) and soft-delete-only:
-- the absorbed contact row stays in the DB (flagged via
-- merged_into_contact_id) rather than being hard-deleted, so every
-- existing FK pointing at it (conversations, deals, leads, tags, etc.)
-- stays valid with zero risk of orphaning data this migration didn't
-- anticipate.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS merged_into_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_merged_into ON contacts(merged_into_contact_id) WHERE merged_into_contact_id IS NOT NULL;

-- Audit trail — who merged what into what, and when. No undo in v1; this
-- row is what lets support/an admin manually reconstruct what happened.
CREATE TABLE IF NOT EXISTS contact_merges (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  survivor_contact_id     UUID NOT NULL,
  merged_contact_id       UUID NOT NULL,
  merged_contact_snapshot JSONB NOT NULL,
  performed_by_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_merges_account ON contact_merges(account_id, created_at);
