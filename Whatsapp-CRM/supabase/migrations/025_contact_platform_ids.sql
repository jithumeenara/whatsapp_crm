-- Dedicated per-platform identity columns for Contact. Instagram/Facebook
-- platform IDs (IGSID/PSID) were previously stored in the shared `phone`
-- column and matched via the same fuzzy last-8-digit suffix logic used for
-- real phone numbers (src/lib/contacts/dedupe.ts) — a real, if currently
-- low-probability, cross-channel identity collision risk. These columns let
-- webhook code match Instagram/Facebook contacts by exact equality instead.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS facebook_id TEXT;

-- Postgres unique indexes treat NULL as distinct, so a plain unique
-- constraint is safe here (mirrors the existing phone_normalized constraint's
-- behavior) — no partial-index workaround needed.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_account_instagram_id
  ON contacts (account_id, instagram_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_account_facebook_id
  ON contacts (account_id, facebook_id);

-- Backfill: only for contacts whose conversations are ALL on that one
-- channel. A contact with conversations on more than one channel is exactly
-- the ambiguous case the pre-existing conversation-merge bug could have
-- produced — leave those NULL rather than guess. Once the webhook code
-- switches to exact-match lookups on these columns, any future message for
-- such a contact naturally creates a fresh, correctly-scoped contact instead
-- of perpetuating a prior bad merge.
UPDATE contacts c
SET instagram_id = c.phone
WHERE c.instagram_id IS NULL
  AND EXISTS (
    SELECT 1 FROM conversations conv
    WHERE conv.contact_id = c.id AND conv.channel = 'instagram'
  )
  AND NOT EXISTS (
    SELECT 1 FROM conversations conv2
    WHERE conv2.contact_id = c.id AND conv2.channel <> 'instagram'
  );

UPDATE contacts c
SET facebook_id = c.phone
WHERE c.facebook_id IS NULL
  AND EXISTS (
    SELECT 1 FROM conversations conv
    WHERE conv.contact_id = c.id AND conv.channel = 'facebook'
  )
  AND NOT EXISTS (
    SELECT 1 FROM conversations conv2
    WHERE conv2.contact_id = c.id AND conv2.channel <> 'facebook'
  );
