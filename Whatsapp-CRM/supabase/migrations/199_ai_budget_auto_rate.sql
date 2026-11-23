-- 199: The AI limit's USD rate can follow the market automatically.
--
--   limit_amount  the limit as the admin entered it, in ai_budgets.currency.
--                 With an automatic rate the limit stays this amount in the
--                 business's money while its USD equivalent moves.
--   rate_auto     true = the USD rate is fetched once a day
--                 (src/lib/ai/fx-live.ts) instead of the saved usd_rate.
-- A row saved before this keeps working: no limit_amount, rate_auto false.
--
-- Safe to run twice.

ALTER TABLE ai_budgets ADD COLUMN IF NOT EXISTS limit_amount NUMERIC(14,2) CHECK (limit_amount IS NULL OR limit_amount > 0);
ALTER TABLE ai_budgets ADD COLUMN IF NOT EXISTS rate_auto BOOLEAN NOT NULL DEFAULT false;
