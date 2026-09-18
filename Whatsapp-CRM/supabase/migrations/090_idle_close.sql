-- Closing a chat the customer has walked away from.
--
-- A conversation where the assistant answered and the customer never
-- wrote back stays Open forever. It is not open in any useful sense —
-- nobody owes anybody anything — but it sits in the Inbox looking like
-- work, and after a few hundred of them the Open list stops meaning
-- anything at all.
--
-- Off by default, and deliberately narrow when on. It only ever touches
-- a conversation that is Open, unassigned, and where *we* spoke last:
--
--   - Pending is never touched. That is where a handover leaves a
--     conversation, and it means a person here still owes the customer
--     an answer. Auto-closing it would bury exactly the work this app
--     exists to surface.
--   - An assigned conversation is never touched. Somebody has it.
--   - A conversation whose last message is from the customer is never
--     touched. They asked something and got nothing; closing it would
--     hide a failure rather than tidy a finished chat.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS idle_close_enabled boolean NOT NULL DEFAULT false;

-- How long the silence has to last. Minutes rather than hours because
-- the useful range genuinely spans both: a shop wants thirty minutes, an
-- institute taking admissions wants two days.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS idle_close_after_minutes integer NOT NULL DEFAULT 1440;

-- An optional last word to the customer before it closes.
--
-- Null means close quietly, which is the right default: most of these
-- conversations ended because the customer got their answer and had
-- nothing more to say, and a "we're closing this chat" to someone who
-- considers it finished is a notification nobody asked for.
--
-- When set, it is only sent while Meta's 24-hour service window is still
-- open — outside it a free-form message is not delivered and not
-- rejected either, so sending one would look like it worked.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS idle_close_message text;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_idle_close_after_minutes_check;

-- Five minutes is the shortest that is not an accident; 30 days is past
-- the point where anything is still a conversation.
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_idle_close_after_minutes_check
  CHECK (idle_close_after_minutes BETWEEN 5 AND 43200);
