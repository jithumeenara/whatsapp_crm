-- The two lists every business needs, and neither of them is in code.
--
-- ── Why nothing here ships with a default list ──────────────────────
--
-- A hospital's list is Ortho, Dental, ENT. A coaching institute's is
-- LGS, LDC, Bank. A jeweller's is gold, silver, repairs. Writing any of
-- those into the application would be writing one customer's business
-- into a product sold to all of them, and the fourth customer would be
-- one nobody thought of.
--
-- So the rows live here, per account, and the application knows nothing
-- about any industry.
--
-- ── The two lists fill up in completely different ways ──────────────
--
-- Categories are DERIVABLE. The business has already told us who it is:
-- its industry and section on the company profile, its own words in the
-- About and Services boxes, every entry in its knowledge base, and its
-- last few hundred real conversations. One button reads all of that and
-- proposes the list; the owner edits and approves. Nobody stares at an
-- empty box, which is the only reason a box like this ever gets filled.
--
-- Scope answers are NOT derivable, and guessing would be dangerous.
-- Nothing in a knowledge base distinguishes "we have no hostel" from
-- "nobody has written the hostel page yet", and an assistant that
-- guessed would tell a customer a real service does not exist. So this
-- list starts empty and grows from what actually happens: when the same
-- question keeps arriving and keeps being closed as "we don't do that",
-- the app notices and offers to add it, with the answer written by the
-- person who kept typing it.

-- ── What this business handles ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Stable, lowercase, never shown. The label can be renamed without
  -- orphaning every judgement and agent skill that points at it.
  key         text NOT NULL,
  label       text NOT NULL,
  -- One line telling the model where this ends and the next begins.
  -- The single most useful field here: research on classification into
  -- fine-grained labels is consistent that overlapping categories are
  -- where accuracy goes, and this is the only place to say "Ortho is
  -- bones and joints, Physio is rehabilitation after them".
  hint        text,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS service_categories_account_idx
  ON service_categories (account_id, active, sort_order);

COMMENT ON TABLE service_categories IS
  'What this business handles — departments, course streams, product lines. Per account, never in code. Proposed from the company profile and knowledge base, then edited by the owner. See src/lib/ai/judgement.ts.';

-- ── What this business does NOT do, and what to say about it ────────
CREATE TABLE IF NOT EXISTS out_of_scope_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key         text NOT NULL,
  -- What people ask for, in the words they ask it in.
  question    text NOT NULL,
  -- What to tell them. This column is the whole point of the table.
  --
  -- Without it the assistant knows only that it has no answer, so it
  -- wakes somebody up, who types "no we don't have a hostel" and goes
  -- back to what they were doing. With it the customer is answered in
  -- two seconds and nobody is interrupted at all.
  answer      text NOT NULL,
  -- How many times this was confirmed before it was added. Kept so the
  -- suggestion that created it can show its own evidence.
  seen_count  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS out_of_scope_answers_account_idx
  ON out_of_scope_answers (account_id, active);

COMMENT ON TABLE out_of_scope_answers IS
  'Things this business does not offer, paired with what to tell people who ask. Cannot be derived — an absent knowledge entry does not mean the service is absent — so it starts empty and grows from repeated real questions. See src/lib/ai/judgement.ts.';
