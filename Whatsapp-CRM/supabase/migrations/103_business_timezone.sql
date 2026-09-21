-- The clock this business runs on.
--
-- Until now nothing in this schema stored a time zone at all, so every
-- time the app had to turn an instant into "what day is it" or "what
-- time is it", it used whatever clock the server happened to be set to.
--
-- On the first machine this ran on that clock is Asia/Kolkata, so the
-- dates customers were told were right. They were right by luck: the
-- code never asked, and nothing in the repository decides it. A second
-- machine left on UTC — the default nearly everywhere — would have had
-- the assistant naming the wrong day for anything after half past five
-- in the evening, with nothing on any screen to show it. And a system
-- clock is one setting, while accounts can be in two countries.
--
-- One zone per account, chosen by the owner from the full IANA list
-- (Settings > Business profile), and used wherever an absolute instant
-- has to become a local one. Agent shift schedules keep their own copy
-- in profiles.working_hours, because an agent can work in a different
-- city from the business that employs them; this is the default those
-- start from.
--
-- An IANA name ("Asia/Kolkata"), never an offset. Half the world changes
-- offset twice a year, so a stored "+05:30" is a value that is right for
-- six months and silently wrong for the other six. The name survives
-- those changes; the offset is computed fresh every time it is shown.
--
-- NULL means nobody has chosen, which behaves exactly as the app did
-- before this column existed.

ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN company_profiles.timezone IS
  'IANA time zone name for this business, e.g. "Asia/Kolkata". Never an offset — offsets change twice a year. NULL = not chosen. See src/lib/agents/timezones.ts.';
