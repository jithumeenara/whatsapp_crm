-- 160: the business's country, logo, tax number and report language, for the
-- Spending report and the report PDF's header.
--
-- A table of its own on purpose. company_profiles and accounts are read whole
-- by Prisma in dozens of places (every AI reply loads the company profile), so
-- a new column there would break all of them on any server where this file has
-- not been applied yet. A new table is read only by the code that needs it.
--
-- One row per business. The currency itself stays in accounts.default_currency
-- (what deals and reports already use); this table only records WHEN it last
-- changed, so history is shown in the currency it was made in.
--
-- Safe to run twice. Additive only: no column, row or table is removed.

CREATE TABLE IF NOT EXISTS account_report_profile (
  account_id              uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- ISO 3166-1 alpha-2, upper case: the country picked in Settings.
  country_iso             text,
  -- A file in file_uploads (PNG, JPEG or WebP, never SVG) shown in report headers.
  logo_file_id            uuid,
  -- GST / tax number, printed under the business name.
  tax_id                  text,
  -- Language of the report text. English unless the business chooses otherwise.
  report_language         text NOT NULL DEFAULT 'en',
  -- When accounts.default_currency last changed. Null: never changed.
  currency_effective_from timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_report_profile_country_iso_format') THEN
    ALTER TABLE account_report_profile ADD CONSTRAINT account_report_profile_country_iso_format
      CHECK (country_iso IS NULL OR country_iso ~ '^[A-Z]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_report_profile_language_format') THEN
    ALTER TABLE account_report_profile ADD CONSTRAINT account_report_profile_language_format
      CHECK (report_language ~ '^[a-z]{2,3}$');
  END IF;
  -- A removed logo file leaves the profile; it just loses the logo.
  IF to_regclass('file_uploads') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_report_profile_logo_file_id_fkey') THEN
    ALTER TABLE account_report_profile ADD CONSTRAINT account_report_profile_logo_file_id_fkey
      FOREIGN KEY (logo_file_id) REFERENCES file_uploads (id) ON DELETE SET NULL;
  END IF;
END $$;
