-- AI accuracy rules, and the business facts customers ask about most.
--
-- company_profiles gains what the assistant was otherwise left to guess:
-- how customers can pay, where the business serves, its policies
-- (refunds, cancellation, booking), and what it does NOT offer — the
-- last is what stops "yes, we do that too".
--
-- ai_configs.accuracy_rules holds the account's rules (answer mode,
-- prices, promises, sensitive topics, blocked phrases, what to do with
-- an unsupported detail). Read with plain SQL (accuracy-rules.ts), so a
-- database without it behaves as before.
--
-- Safe to run again.

ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS payment_methods TEXT;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS service_area TEXT;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS policies TEXT;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS not_offered TEXT;

ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS accuracy_rules JSONB;
