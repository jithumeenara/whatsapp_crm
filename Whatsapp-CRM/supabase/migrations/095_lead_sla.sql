-- Saying out loud when a lead has been sitting.
--
-- A lead nobody has touched for four days looks exactly like one
-- claimed an hour ago: same row, same colour, same position once the
-- list is sorted by anything other than age. The ones going cold are
-- the ones worth seeing first, and they were the hardest to find.
--
-- Two thresholds rather than one, because "slipping" and "neglected"
-- want different reactions and a single number cannot say both. Hours
-- rather than days, because an inside-sales team measures this in hours
-- and a training institute in days, and hours can express both.
--
-- Defaults are a day and three days. Zero turns the marking off for an
-- account that does not work this way.
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS sla_warn_hours integer NOT NULL DEFAULT 24;

ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS sla_breach_hours integer NOT NULL DEFAULT 72;
