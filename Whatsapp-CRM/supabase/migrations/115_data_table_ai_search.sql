-- How the customer-facing assistant searches a Data Store table
-- (src/lib/ai/table-search.ts): which column to ask the customer for
-- first, and which date column decides what is upcoming.
-- { "ask_first": "<field_key>" | null, "upcoming_by": "<field_key>" | null }
-- Nullable; also added at start-up by src/lib/data-store/schema.ts.
ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS ai_search JSONB;
