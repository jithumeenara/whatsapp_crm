-- Letting the assistant take a registration.
--
-- Two columns, and the design falls out of what the Data Store already
-- is. An account defines a table — "Programme Registrations", "Service
-- Bookings", "Job Applications", whatever their business actually takes
-- — marks which of its fields are required, and the assistant reads that
-- definition rather than anything written for one industry.

-- Which tables the assistant may write into.
--
-- Off for every existing table, and off for every new one. An assistant
-- that can create rows is a different proposition from one that answers
-- questions, and nobody should discover they had turned it on.
ALTER TABLE data_tables
  ADD COLUMN IF NOT EXISTS ai_can_register boolean NOT NULL DEFAULT false;

-- What the assistant says after a registration lands.
--
-- Per table, because "You're registered — we'll email your joining
-- instructions" is right for a training institute and wrong for a garage.
-- Null falls back to a plain confirmation.
ALTER TABLE data_tables
  ADD COLUMN IF NOT EXISTS ai_success_message text;

-- Who a row belongs to.
--
-- Without it the assistant can create a registration and then never find
-- it again — "what did I sign up for?" and "change my phone number on
-- that booking" both need to know which rows are this person's. Nullable
-- because the overwhelming majority of Data Store rows have no customer
-- behind them at all: imported price lists, course catalogues, stock.
ALTER TABLE data_records
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;

-- Partial, because only rows a customer created are ever looked up this
-- way, and those are a small minority of the table.
CREATE INDEX IF NOT EXISTS idx_data_records_contact
  ON data_records (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;
