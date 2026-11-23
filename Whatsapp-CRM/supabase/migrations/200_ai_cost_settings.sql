-- 200: How AI costs are shown: the tax on the provider's bill.
--
-- Google bills Indian accounts 18% GST on top of the usage price; other
-- countries have their own rate, or none. ai_usage_events keeps the
-- estimated usage price in USD (unchanged); this per-workspace setting is
-- added when the cost is shown (Usage tab) and compared with the monthly
-- AI limit, so both read like the bill. No row = 0%.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS ai_cost_settings (
  account_id   UUID         PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  tax_percent  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_percent >= 0 AND tax_percent <= 100),
  updated_by   UUID         REFERENCES users(id) ON DELETE RESTRICT,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
