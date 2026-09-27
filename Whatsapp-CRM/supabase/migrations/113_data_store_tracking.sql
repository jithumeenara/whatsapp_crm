-- Data Store: where each row came from, new-row alerts, and the public
-- "Get Data" form.
--
-- All additions are nullable (or index-only), so no table is rewritten
-- and the app keeps working on a database that has not run this yet —
-- src/lib/data-store/schema.ts applies the same statements at start-up.

-- manual | api | import | whatsapp_ai | chatbot | whatsapp_flow |
-- integration | payment | web_form. Null for rows written before this.
ALTER TABLE data_records ADD COLUMN IF NOT EXISTS source TEXT;

-- Who hears about a new row, and how (in-app, email, WhatsApp).
ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS alert_config JSONB;

-- The public form's settings, and the unguessable part of its link.
-- Regenerating the token is how a leaked link is shut.
ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS form_config JSONB;
ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS form_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS data_tables_form_token_key ON data_tables (form_token);

-- Newest-first listing, and "has this person already answered".
CREATE INDEX IF NOT EXISTS data_records_table_created_idx ON data_records (table_id, created_at DESC);
CREATE INDEX IF NOT EXISTS data_records_table_contact_idx ON data_records (table_id, contact_id);
