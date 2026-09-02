-- User-configurable "log me out after N days/hours/minutes of no activity
-- on a device" (Settings > Profile > Sessions > gear icon). Stored in
-- minutes so the UI's day/hour/minute picker can convert freely without
-- ever losing precision. Default matches the previous hardcoded 3-day
-- constant in src/auth.ts, so existing users see no behavior change
-- until they open the new dialog and pick something else.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_inactivity_limit_minutes INTEGER NOT NULL DEFAULT 4320;
