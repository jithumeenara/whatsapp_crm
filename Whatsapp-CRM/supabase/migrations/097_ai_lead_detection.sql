-- Letting the assistant say "this one looks like a real enquiry".
--
-- The switch that exists today creates a lead for every new contact on
-- their first message: the person who says "hi", the wrong number, the
-- supplier chasing an invoice and the person who actually wants to
-- enrol all become the same row. That is why the list fills with work
-- nobody can act on.
--
-- ── Why "suggest" is the default ──────────────────────────────────
--
-- Published false-positive rates for conversational lead scoring run
-- 15-30% in the first ninety days while a model calibrates, and about
-- half of these deployments produce no measurable lift at all. A wrong
-- lead is not free — somebody reads it, decides, and moves on. So the
-- assistant proposes and a person accepts, and the accept/reject
-- becomes a number the account can see. An account that comes to trust
-- it can switch to creating directly.
--
-- ── Why every rule is the account's own ───────────────────────────
--
-- "A lead" means something different in a training institute, a clinic
-- and a hardware shop. A fixed definition would be wrong for two of
-- those three, so the signals are a list, the rules are free text, and
-- the exclusions — the half that keeps the list clean — are free text
-- too.
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_lead_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_lead_signals jsonb;
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_lead_rules text;
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_lead_exclusions text;
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_lead_threshold text NOT NULL DEFAULT 'balanced';
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_lead_mode text NOT NULL DEFAULT 'suggest';
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_lead_min_messages integer NOT NULL DEFAULT 2;
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS ai_lead_recheck_hours integer NOT NULL DEFAULT 6;

-- A suggested lead stays out of the working lists until accepted.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_suggested boolean NOT NULL DEFAULT false;
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_reason text;
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_confidence text;
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz;
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_review_result text;

-- The Suggested tab's only query, and the accuracy figure's.
CREATE INDEX IF NOT EXISTS leads_ai_suggested_idx
  ON leads (account_id, ai_suggested)
  WHERE ai_suggested = true;

-- When this thread was last looked at, whichever way the answer went.
--
-- On the conversation rather than the lead, because the "no" answers
-- never write a lead row and those are exactly the ones worth not
-- paying to re-ask. One column, both outcomes.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_lead_checked_at timestamptz;

-- What a person decided about a suggestion.
--
-- Its own table because a rejected suggestion's lead row is deleted: it
-- was never a lead, and left in place it would drag every conversion
-- figure down and turn up in every duplicate check. Deleting it would
-- take the evidence with it, and an accuracy figure that can only count
-- the accepts reads as 100% forever.
--
-- Keyed by contact as well as counted, so the detector can see that
-- this person was already turned down once and not offer them again.
CREATE TABLE IF NOT EXISTS ai_lead_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  decision    text NOT NULL,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_lead_reviews_decision_idx
  ON ai_lead_reviews (account_id, decision);
CREATE INDEX IF NOT EXISTS ai_lead_reviews_contact_idx
  ON ai_lead_reviews (account_id, contact_id);
