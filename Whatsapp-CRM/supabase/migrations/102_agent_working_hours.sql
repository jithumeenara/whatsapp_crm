-- When each agent is supposed to be working.
--
-- A week of shifts per person: for each of Monday to Sunday, either a
-- day off or a pair of times, with working days marked full or half. A
-- half day is a working day with shorter hours — the word is a label
-- people use, not a second rule, and nothing in the code branches on it.
--
-- ── Why the time zone is inside this column ─────────────────────────
--
-- Nothing in this schema stored a time zone before now, so "09:00"
-- would have meant nine o'clock on whichever machine asked.
--
-- On the machine this was written for that happens to be right: it is
-- set to Asia/Kolkata, and so is its Postgres. Said plainly because the
-- risk is easy to overstate. It is still the wrong way to do it — a
-- server left on UTC, which is the default nearly everywhere, would put
-- every agent's nine-to-six between half two in the afternoon and half
-- eleven at night for the whole shift every day, with nothing on screen
-- to suggest it. And one system clock cannot serve two accounts in two
-- countries however it is set.
--
-- Keeping the zone inside the schedule makes it correct by construction:
-- a schedule without a zone does not parse, so there is no path that
-- stores times nobody has pinned to a clock.
--
-- ── Why JSON ────────────────────────────────────────────────────────
--
-- Seven fixed days, read and written whole, never queried across rows —
-- nothing here wants a column each, and fourteen columns would make
-- adding a second shift per day a migration instead of an edit. The
-- shape is validated in TypeScript on the way in and on the way out
-- (src/lib/agents/working-hours.ts), and anything unreadable is treated
-- as "no hours set", which means always available. That is the safe
-- direction: a row nobody can parse must not silently take an agent off
-- the rota.
--
-- NULL means no hours have been set, which is every existing row, and
-- which behaves exactly as the app did before this column existed.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS working_hours jsonb;

COMMENT ON COLUMN profiles.working_hours IS
  'Weekly shift schedule with its IANA time zone: {timezone, week:{mon..sun:{mode:full|half|off, from:"HH:MM", to:"HH:MM"}}}. NULL = no hours set = always available. See src/lib/agents/working-hours.ts.';
