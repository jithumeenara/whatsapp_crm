-- 198: The AI spending limit in the business's own currency.
--
-- AI providers bill in USD and ai_usage_events records USD. A business
-- thinks in its own currency (accounts.default_currency), so the limit is
-- now entered and shown in it:
--   currency      ISO code the limit was set in (the business currency then)
--   usd_rate      how many of that currency one USD is worth, as the admin
--                 confirmed it (a suggested rate is pre-filled; they can edit)
--   monthly_limit_usd stays the number the limit is enforced on
--                 (= amount in currency / usd_rate), so enforcement is unchanged.
--
-- Safe to run twice.

ALTER TABLE ai_budgets ADD COLUMN IF NOT EXISTS currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
ALTER TABLE ai_budgets ADD COLUMN IF NOT EXISTS usd_rate NUMERIC(14,6) CHECK (usd_rate IS NULL OR (usd_rate > 0 AND usd_rate < 1000000));
