-- One platform-wide Meta App's credentials for WhatsApp Embedded Signup —
-- NOT per-tenant like whatsapp_config. Enforced as a singleton via a fixed
-- id ("singleton"); the operator sets this once from Settings, and every
-- tenant's Embedded Signup popup uses this one Meta "Tech Provider" App.
CREATE TABLE IF NOT EXISTS meta_platform_config (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  app_id     TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  config_id  TEXT NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
