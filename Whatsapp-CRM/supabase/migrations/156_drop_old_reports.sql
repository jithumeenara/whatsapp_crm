-- 156: remove the old Reports section's two tables (from 119).
--
-- The Reports page, its API and src/lib/reports were deleted before the
-- section is rebuilt; nothing reads or writes these tables any more, and
-- no other table points at them (checked: no foreign keys into either).
--
-- saved_reports   saved report questions (never results or customer data)
-- report_exports  who exported which report, when
--
-- This deletes their rows for good. docs/deploy/code-update.sh takes and
-- verifies a pg_dump before running it; keep that dump if the rows matter.
-- Safe to run twice.

DROP TABLE IF EXISTS saved_reports;
DROP TABLE IF EXISTS report_exports;
