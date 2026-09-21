-- When the customer last said something.
--
-- ── Why this is not updated_at ──────────────────────────────────────
--
-- The app already tracks when anybody last touched a lead, in
-- updated_at, and marks the neglected ones on the list. That is our
-- activity, and it answers a different question from this one.
--
-- An agent can work a lead hard — call, log the outcome, write a note,
-- change the status — while the customer says nothing at all. On
-- updated_at that lead looks fresh every single day. It is cooling the
-- whole time, and nothing on the screen says so.
--
-- So: two clocks, deliberately. "Has anybody here done anything" is
-- updated_at. "Is this person still interested" is this column. A lead
-- can be worked hard and still going cold, and being able to see that
-- is the point.
--
-- ── What reads it ───────────────────────────────────────────────────
--
-- src/lib/leads/score-decay.ts, which fades a score one rung down the
-- account's own ladder after a month of silence, two after two months,
-- and stops at the bottom. Nothing is written back: the stored score
-- keeps saying what a person decided, and the faded one is computed
-- when it is shown. So this column can be wrong, or absent, and the
-- worst case is that a score simply does not fade.
--
-- NULL means nobody knows — which is the honest state for a lead that
-- existed before this column did and whose contact has no conversation
-- to read a date off.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_customer_at timestamptz;

-- ── Backfill ────────────────────────────────────────────────────────
--
-- Without this every existing lead reads as "nobody knows", and the
-- fading does nothing at all until each customer happens to write
-- again — which for the cold ones is never, so the leads that most need
-- fading would be exactly the ones that never fade.
--
-- The best available date is the last message on that contact's newest
-- conversation. It counts our messages as well as theirs, so it is
-- generous rather than exact — and generous is the right direction for
-- a one-off guess, because it errs toward leaving a score alone rather
-- than demoting one wrongly on day one.
UPDATE leads l
SET    last_customer_at = c.last_message_at
FROM   (
  SELECT DISTINCT ON (contact_id) contact_id, last_message_at
  FROM   conversations
  WHERE  contact_id IS NOT NULL AND last_message_at IS NOT NULL
  ORDER  BY contact_id, last_message_at DESC
) c
WHERE  l.contact_id = c.contact_id
  AND  l.last_customer_at IS NULL;

-- Leads with no conversation to read from fall back to their own
-- creation date. An enquiry is at least as old as the row recording it,
-- and this is the last chance to say anything true about it.
UPDATE leads
SET    last_customer_at = created_at
WHERE  last_customer_at IS NULL;

COMMENT ON COLUMN leads.last_customer_at IS
  'When the customer last sent a message. Separate from updated_at, which is when anyone here last touched the lead — an agent can work a lead daily while the customer stays silent. Read by src/lib/leads/score-decay.ts; never written back to by it.';
