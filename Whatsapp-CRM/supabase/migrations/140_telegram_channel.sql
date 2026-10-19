-- Telegram: a business's Telegram bot as one more Inbox channel.
--
-- A customer's messages to the bot arrive as an ordinary conversation on
-- the 'telegram' channel, so the Inbox, assignment, chatbots, automations
-- and the assistant all treat them like any other channel.
--
--   telegram_bots     one per account. token_enc is the BotFather token,
--                     encrypted; webhook_secret is what Telegram sends back
--                     in X-Telegram-Bot-Api-Secret-Token on every update.
--                     business_connections: the Telegram Business accounts
--                     (a business's own number) connected to the bot.
--   contacts.telegram_id   the customer's Telegram user id, the way
--                     instagram_id is an Instagram customer's. Telegram
--                     never gives a phone number unless the customer
--                     shares it.
--   conversations.telegram_business_connection_id  set when the chat came
--                     through a Telegram Business account: replies must go
--                     out through that connection, as the business.
--   messages.telegram_meta  { file_id?, buttons?: [{ id, title, cb }] } —
--                     the file to fetch for the Inbox, and the buttons sent.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS telegram_bots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  -- Who connected it; new Telegram contacts are created under this user.
  -- RESTRICT, like every business table's link to users (migration 132).
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bot_user_id          TEXT NOT NULL,
  username             TEXT NOT NULL,
  display_name         TEXT,
  token_enc            TEXT NOT NULL,
  webhook_secret       TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'connected',
  last_error           TEXT,
  last_update_at       TIMESTAMPTZ,
  business_connections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_bots_status_check CHECK (status IN ('connected', 'error', 'disconnected'))
);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_account_telegram_id ON contacts (account_id, telegram_id);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS telegram_business_connection_id TEXT;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS telegram_meta JSONB;
