-- Somebody's own shortcuts on the dashboard.
--
-- An ordered list of hrefs, validated against the app's own navigation
-- on the way in and on the way out — a link saved before a page was
-- removed must never render as a row that goes nowhere.
--
-- Per person rather than per account, deliberately: what a sales agent
-- reaches for all day is Inbox and Leads, and what the owner reaches for
-- is Reports and Broadcasts. One shared list would be wrong for both.
--
-- Empty is the starting state and means "has not chosen", not "wants
-- none" — the dashboard shows a sensible default until somebody picks.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS quick_links jsonb NOT NULL DEFAULT '[]'::jsonb;
