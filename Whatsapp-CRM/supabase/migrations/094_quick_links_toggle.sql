-- An off switch for the dashboard's quick-links button.
--
-- Without one the only way to hide it is to empty the list — and an
-- empty list means "has not chosen yet", which brings the default back.
-- Two different intentions cannot share one representation.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS quick_links_enabled boolean NOT NULL DEFAULT true;
