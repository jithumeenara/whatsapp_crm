-- 193: Each WhatsApp number uses its own catalog.
--
-- Meta allows ONE catalog per WhatsApp Business Account (WABA), shared by
-- every number under it. waba_catalogs remembers which connected catalog
-- each of this workspace's WABAs uses (and whether the catalog / cart are
-- shown on its numbers). Sending a catalog or product message picks the
-- catalog of the number it is sent from; with no row, the default catalog
-- is used, exactly as before.
--
-- Products may now share an SKU across two catalogs: the unique key grows
-- from (account_id, retailer_id) to (account_id, catalog_id, retailer_id).
-- Only the uniqueness rule changes — no row is changed or removed (every
-- existing pair is still unique under the wider key).
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS waba_catalogs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  waba_id         TEXT        NOT NULL CHECK (waba_id ~ '^[0-9]{1,30}$'),
  catalog_id      TEXT        NOT NULL CHECK (catalog_id ~ '^[0-9]{1,30}$'),
  catalog_visible BOOLEAN     NOT NULL DEFAULT true,
  cart_enabled    BOOLEAN     NOT NULL DEFAULT true,
  linked_by       UUID        REFERENCES users(id) ON DELETE RESTRICT,
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  UNIQUE (account_id, waba_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_products_account_catalog_retailer_key
  ON catalog_products (account_id, catalog_id, retailer_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_products_account_id_retailer_id_key') THEN
    ALTER TABLE catalog_products DROP CONSTRAINT catalog_products_account_id_retailer_id_key;
  END IF;
END $$;
