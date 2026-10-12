-- Website chat: a chat window a business pastes onto its own website.
--
-- A visitor's messages arrive as an ordinary conversation on the
-- 'website' channel, so the Inbox, assignment, chatbots, automations and
-- the assistant all treat them like any other channel.
--
--   web_chat_widgets   one per installed chat window. public_key is what
--                      the install snippet carries; it is not a secret.
--   web_chat_sessions  one per visitor's browser. Only a hash of the
--                      visitor's token is stored, so a database read does
--                      not hand anybody a working session.
--   contacts.web_visitor_id  the visitor's identity, the way instagram_id
--                      is an Instagram customer's.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS web_chat_widgets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Who set it up; new visitor contacts are created under this user.
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key       TEXT NOT NULL UNIQUE,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  name             TEXT NOT NULL DEFAULT 'Website chat',
  -- Shown at the top of the chat window.
  title            TEXT NOT NULL DEFAULT 'Chat with us',
  welcome_message  TEXT NOT NULL DEFAULT 'Hi! How can we help you today?',
  primary_color    TEXT NOT NULL DEFAULT '#4f46e5',
  position         TEXT NOT NULL DEFAULT 'right',
  logo_url         TEXT,
  -- Hostnames the window may appear on. Empty: anywhere (shown as a
  -- warning in Settings).
  allowed_domains  TEXT[] NOT NULL DEFAULT '{}',
  -- A "Talk to a person" button in the window.
  allow_handoff    BOOLEAN NOT NULL DEFAULT true,
  -- Most assistant replies across this account's website chats in one
  -- day. Past it, chats wait for the team instead — a cap on what a
  -- flood of fake visitors can cost.
  daily_ai_limit   INTEGER NOT NULL DEFAULT 300,
  last_seen_at     TIMESTAMPTZ,
  last_seen_origin TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_chat_widgets_account_id_idx ON web_chat_widgets (account_id);

CREATE TABLE IF NOT EXISTS web_chat_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  widget_id       UUID NOT NULL REFERENCES web_chat_widgets(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  visitor_id      TEXT NOT NULL,
  -- Set on the visitor's first message, not on opening the window, so
  -- somebody who only looks does not become a contact.
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ip_hash         TEXT,
  user_agent      TEXT,
  page_url        TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_chat_sessions_conversation_idx ON web_chat_sessions (conversation_id);
CREATE INDEX IF NOT EXISTS web_chat_sessions_widget_created_idx ON web_chat_sessions (widget_id, created_at);
CREATE INDEX IF NOT EXISTS web_chat_sessions_expires_idx ON web_chat_sessions (expires_at);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS web_visitor_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_account_web_visitor_id
  ON contacts (account_id, web_visitor_id);

-- Chatbot buttons, lists and links sent to a website visitor, kept with
-- the message so they are still there when the visitor reloads the page:
-- { buttons?: [{ id, title }], link?: { label, url } }.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS web_meta JSONB;
