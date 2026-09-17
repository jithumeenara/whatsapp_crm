-- How many can be taken before it is full.
--
-- The sibling of 086. That one asks "has this person already booked
-- this?"; this asks "is there room left at all?", which is a different
-- question with a different answer and the one that actually stops an
-- over-booking.
--
-- Same shape for the same reason: what "full" counts over is not the
-- same in two businesses, so the account names the fields.
--
--   A clinic      capacity_by = doctor, date, time   limit 1
--   An institute  capacity_by = programme            limit 40
--   A workshop    capacity_by = date                 limit 12
--
-- Unlike 086 this counts across every customer, not just the one being
-- served: a seat taken by somebody else is still a seat taken. Null
-- limit means no ceiling, which stays the default — an account that has
-- not thought about capacity should not suddenly start turning people
-- away.
ALTER TABLE data_tables
  ADD COLUMN IF NOT EXISTS ai_capacity_by jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE data_tables
  ADD COLUMN IF NOT EXISTS ai_capacity_limit integer;

-- Counting rows for one table is already covered by the table_id index
-- these records carry. The field comparison happens in application code
-- because the values live inside a jsonb document whose shape differs
-- per table, and because it has to match the same forgiving way 086
-- does -- "Sub-staff" and "Sub Staff" are one target group.
