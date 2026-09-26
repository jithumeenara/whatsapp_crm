-- "Connect with Microsoft": one Microsoft 365 / Outlook mailbox per account.
-- Safe to run more than once. The app also creates this table itself on
-- first use (src/lib/email/microsoft/store.ts), so a missed run is not fatal.
CREATE TABLE IF NOT EXISTS microsoft_mailboxes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL,
  tenant_id               TEXT NOT NULL,
  client_id               TEXT NOT NULL,
  client_secret           TEXT NOT NULL,
  mailbox_email           TEXT,
  mailbox_name            TEXT,
  refresh_token           TEXT,
  access_token            TEXT,
  access_expires_at       TIMESTAMPTZ,
  subscription_id         TEXT UNIQUE,
  notification_url        TEXT,
  subscription_expires_at TIMESTAMPTZ,
  client_state            TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'not_connected',
  last_error              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
