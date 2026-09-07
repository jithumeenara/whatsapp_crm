-- WhatsApp Catalogs — products, carts, orders (Finding #07).
-- Additive only: new tables + two nullable columns on existing tables.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS order_snapshot JSONB;

CREATE TABLE IF NOT EXISTS catalog_config (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id           TEXT NOT NULL,
  business_id          TEXT,
  access_token         TEXT NOT NULL,
  default_pipeline_id  UUID,
  default_stage_id     UUID,
  status               TEXT NOT NULL DEFAULT 'disconnected',
  connected_at         TIMESTAMPTZ,
  last_synced_at       TIMESTAMPTZ,
  last_tested_at       TIMESTAMPTZ,
  test_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  catalog_id         TEXT NOT NULL,
  retailer_id        TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  price              DECIMAL(12, 2),
  currency           TEXT,
  image_url          TEXT,
  availability       TEXT NOT NULL DEFAULT 'in stock',
  category           TEXT,
  brand              TEXT,
  sync_status        TEXT NOT NULL DEFAULT 'pending',
  raw_meta_response  JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, retailer_id)
);
CREATE INDEX IF NOT EXISTS catalog_products_account_catalog_idx ON catalog_products (account_id, catalog_id);

CREATE TABLE IF NOT EXISTS catalog_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  wa_message_id    TEXT NOT NULL UNIQUE,
  message_id       UUID,
  contact_id       UUID,
  conversation_id  UUID,
  catalog_id       TEXT NOT NULL,
  currency         TEXT,
  items            JSONB NOT NULL,
  subtotal         DECIMAL(12, 2),
  deal_id          UUID,
  status           TEXT NOT NULL DEFAULT 'received',
  raw_payload      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_orders_account_created_idx ON catalog_orders (account_id, created_at);
