-- In-chat UPI payments scaffolding (audit Finding #09), India-only,
-- gated by a manual Meta support-case approval per WABA plus each
-- tenant's own UPI-enabled payment-gateway account (Razorpay/PayU/
-- Billdesk/Zaakpay — the only four Meta supports). New tables only.

CREATE TABLE IF NOT EXISTS payment_gateway_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  whatsapp_config_id  UUID NOT NULL UNIQUE REFERENCES whatsapp_config(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway             TEXT NOT NULL,
  credentials         JSONB NOT NULL,
  vpa                 TEXT,
  mcc                 TEXT,
  pc                  TEXT,
  status              TEXT NOT NULL DEFAULT 'pending_meta_approval',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_payments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  whatsapp_config_id      UUID NOT NULL,
  conversation_id         UUID,
  contact_id              UUID,
  wa_order_message_id     TEXT NOT NULL UNIQUE,
  reference_id            TEXT NOT NULL,
  amount                  DECIMAL(12, 2) NOT NULL,
  currency                TEXT NOT NULL DEFAULT 'INR',
  status                  TEXT NOT NULL DEFAULT 'pending',
  gateway_transaction_id  TEXT,
  raw_payload             JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_payments_account_created_idx ON whatsapp_payments (account_id, created_at);

-- Widen messages.content_type for the two new outbound message types this
-- feature sends (order_details invoice, order_status update) — learned
-- the hard way earlier this session (migration 054) that forgetting this
-- makes every such Message insert fail at the DB layer despite correct
-- application code, so it's done proactively here rather than as a
-- follow-up fix.
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'address', 'contacts',
    'order', 'catalog', 'single_product', 'multi_product',
    'payment_order_details', 'payment_order_status'
  ));
