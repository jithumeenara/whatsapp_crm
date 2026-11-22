-- 190: "Connect Ads" and "Connect Catalog" — several ad accounts and several
-- catalogs per workspace, each connected with its own one-click Meta login.
--
--   meta_asset_connections  one per Meta login (kind ads | catalog): the
--                           sealed token, its business and granted scopes.
--   meta_ad_accounts        one per ad account   (unique per workspace)
--   meta_catalogs           one per catalog      (unique per workspace)
--
-- One row per workspace may be the default (partial unique index). The
-- existing single-row meta_ads_config / catalog_config keep working: the
-- app mirrors the default ad account / catalog into them, and this file
-- copies what they hold today into the new tables. Nothing is removed.
--
-- Also adds the two Facebook Login for Business configuration ids.
-- Safe to run twice (IF NOT EXISTS, guarded copies).

ALTER TABLE IF EXISTS meta_platform_config ADD COLUMN IF NOT EXISTS ads_config_id TEXT;
ALTER TABLE IF EXISTS meta_platform_config ADD COLUMN IF NOT EXISTS catalog_config_id TEXT;

CREATE TABLE IF NOT EXISTS meta_asset_connections (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL CHECK (kind IN ('ads', 'catalog')),
  business_id   TEXT,
  access_token  TEXT        NOT NULL,
  scopes        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT        NOT NULL DEFAULT 'connected',
  last_error    TEXT,
  connected_by  UUID        REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_asset_connections_account_kind_idx ON meta_asset_connections (account_id, kind);

CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id   UUID        NOT NULL REFERENCES meta_asset_connections(id) ON DELETE CASCADE,
  ad_account_id   TEXT        NOT NULL CHECK (ad_account_id ~ '^[0-9]{1,30}$'),
  name            TEXT,
  currency        TEXT,
  timezone_name   TEXT,
  account_status  INTEGER,
  is_default      BOOLEAN     NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  last_synced_at  TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, ad_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS meta_ad_accounts_one_default ON meta_ad_accounts (account_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS meta_catalogs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id   UUID        NOT NULL REFERENCES meta_asset_connections(id) ON DELETE CASCADE,
  catalog_id      TEXT        NOT NULL CHECK (catalog_id ~ '^[0-9]{1,30}$'),
  name            TEXT,
  product_count   INTEGER,
  is_default      BOOLEAN     NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  last_synced_at  TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, catalog_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS meta_catalogs_one_default ON meta_catalogs (account_id) WHERE is_default;

-- Copy today's single ad account / catalog into the new tables (once).
DO $$
DECLARE
  r   RECORD;
  cid UUID;
  aid TEXT;
BEGIN
  IF to_regclass('meta_ads_config') IS NOT NULL THEN
    FOR r IN SELECT account_id, user_id, ad_account_id, business_id, access_token FROM meta_ads_config
             WHERE ad_account_id IS NOT NULL AND access_token IS NOT NULL AND access_token <> '' LOOP
      aid := regexp_replace(btrim(r.ad_account_id), '^act_', '');
      CONTINUE WHEN aid !~ '^[0-9]{1,30}$';
      CONTINUE WHEN EXISTS (SELECT 1 FROM meta_ad_accounts WHERE account_id = r.account_id AND ad_account_id = aid);
      INSERT INTO meta_asset_connections (account_id, kind, business_id, access_token, connected_by)
        VALUES (r.account_id, 'ads', r.business_id, r.access_token, r.user_id) RETURNING id INTO cid;
      INSERT INTO meta_ad_accounts (account_id, connection_id, ad_account_id, is_default)
        VALUES (r.account_id, cid, aid, NOT EXISTS (SELECT 1 FROM meta_ad_accounts WHERE account_id = r.account_id AND is_default));
    END LOOP;
  END IF;

  IF to_regclass('catalog_config') IS NOT NULL THEN
    FOR r IN SELECT account_id, user_id, catalog_id, business_id, access_token FROM catalog_config
             WHERE catalog_id IS NOT NULL AND access_token IS NOT NULL AND access_token <> '' LOOP
      aid := btrim(r.catalog_id);
      CONTINUE WHEN aid !~ '^[0-9]{1,30}$';
      CONTINUE WHEN EXISTS (SELECT 1 FROM meta_catalogs WHERE account_id = r.account_id AND catalog_id = aid);
      INSERT INTO meta_asset_connections (account_id, kind, business_id, access_token, connected_by)
        VALUES (r.account_id, 'catalog', r.business_id, r.access_token, r.user_id) RETURNING id INTO cid;
      INSERT INTO meta_catalogs (account_id, connection_id, catalog_id, is_default)
        VALUES (r.account_id, cid, aid, NOT EXISTS (SELECT 1 FROM meta_catalogs WHERE account_id = r.account_id AND is_default));
    END LOOP;
  END IF;
END $$;
