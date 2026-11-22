-- 178: Several people on one phone number (a family at a clinic, a parent
-- booking for two children, a company number for several staff).
--
-- The contact stays the NUMBER (its WhatsApp chat, its owner). Each person
-- booked through that number is a row here, and a lead can point at one
-- person (leads.person_id). A lead with no person behaves exactly as before:
-- nothing existing is moved or changed by this migration.
--
-- created_by links to users ON DELETE RESTRICT, like every link from
-- business data to users (migration 132). Removing a person is refused by
-- the app while a lead points at them; if a row is ever removed anyway,
-- the lead just loses its person (ON DELETE SET NULL), never the lead.
--
-- Safe to run twice. (Planned as 168, which Meta's work took first.)

CREATE TABLE IF NOT EXISTS contact_people (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  age         INTEGER     CHECK (age IS NULL OR (age >= 0 AND age <= 120)),
  gender      TEXT,
  address     TEXT,
  relation    TEXT,
  created_by  UUID        REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_people_account_contact_idx
  ON contact_people (account_id, contact_id);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS person_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_person_id_fkey') THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_person_id_fkey FOREIGN KEY (person_id)
      REFERENCES contact_people(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leads_person_id_idx ON leads (person_id) WHERE person_id IS NOT NULL;
