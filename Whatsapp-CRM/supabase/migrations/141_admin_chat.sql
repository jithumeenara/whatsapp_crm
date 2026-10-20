-- Admin Chat: a business's own admins ask the CRM assistant about the
-- business from their WhatsApp or Telegram, in short sessions.
--
-- How a session starts: an enrolled admin sends the account's keyword from
-- their verified number / Telegram account → the bot asks for the 6-digit
-- code from their authenticator app (their own login TOTP — never a code
-- sent into the same chat) → a session opens for a few minutes, only on
-- the days and hours, and between the dates, the owner allowed.
--
--   admin_chat_settings   one per account: on/off, keyword, idle and
--                         absolute session length.
--   admin_chat_members    at most 5 per account (checked in code). Each is
--                         a team member on one channel, proved by sending
--                         a one-time code shown on the web from that phone
--                         or Telegram account. scope: 'reports' (counts and
--                         summaries only) or 'lookup' (also find a person,
--                         numbers masked).
--   admin_chat_sessions   awaiting_code → active → ended. history holds
--                         the last few turns, cleared when it ends.
--   admin_chat_seen       inbound message ids, so a re-delivered webhook
--                         is never answered twice.
--   admin_chat_audit      every enrolment, sign-in, question and end;
--                         hash-chained so an edited or deleted row shows.
--
-- user links are RESTRICT, like every business table (migration 132).
-- Safe to run again.

CREATE TABLE IF NOT EXISTS admin_chat_settings (
  account_id    UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  keyword       TEXT NOT NULL DEFAULT 'ADMIN',
  idle_minutes  INTEGER NOT NULL DEFAULT 15,
  max_minutes   INTEGER NOT NULL DEFAULT 60,
  updated_by    UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_chat_settings_idle_check CHECK (idle_minutes BETWEEN 5 AND 60),
  CONSTRAINT admin_chat_settings_max_check CHECK (max_minutes BETWEEN 10 AND 240)
);

CREATE TABLE IF NOT EXISTS admin_chat_members (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel               TEXT NOT NULL,
  -- WhatsApp: the number (digits) the owner entered; it must send the code.
  phone_normalized      TEXT,
  -- Telegram: filled in when the code arrives from that account.
  telegram_id           TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  scope                 TEXT NOT NULL DEFAULT 'reports',
  valid_from            DATE NOT NULL,
  valid_until           DATE NOT NULL,
  -- 'mon'..'sun' in the business's time zone.
  allowed_days          TEXT[] NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri','sat','sun'],
  start_minute          INTEGER NOT NULL DEFAULT 0,
  end_minute            INTEGER NOT NULL DEFAULT 1440,
  verify_code_hash      TEXT,
  verify_expires_at     TIMESTAMPTZ,
  verified_at           TIMESTAMPTZ,
  failed_attempts       INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  -- The authenticator time step last accepted: a code works once.
  last_totp_step        BIGINT,
  created_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_chat_members_channel_check CHECK (channel IN ('whatsapp', 'telegram')),
  CONSTRAINT admin_chat_members_status_check CHECK (status IN ('pending', 'active', 'disabled')),
  CONSTRAINT admin_chat_members_scope_check CHECK (scope IN ('reports', 'lookup')),
  CONSTRAINT admin_chat_members_minutes_check CHECK (start_minute BETWEEN 0 AND 1440 AND end_minute BETWEEN 0 AND 1440 AND start_minute < end_minute),
  CONSTRAINT admin_chat_members_dates_check CHECK (valid_from <= valid_until)
);
CREATE INDEX IF NOT EXISTS admin_chat_members_account ON admin_chat_members (account_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS admin_chat_members_user_channel ON admin_chat_members (account_id, user_id, channel) WHERE status <> 'disabled';
CREATE UNIQUE INDEX IF NOT EXISTS admin_chat_members_phone ON admin_chat_members (account_id, phone_normalized) WHERE status <> 'disabled' AND phone_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admin_chat_members_telegram ON admin_chat_members (account_id, telegram_id) WHERE status <> 'disabled' AND telegram_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_chat_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_id          UUID NOT NULL REFERENCES admin_chat_members(id) ON DELETE CASCADE,
  channel            TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'awaiting_code',
  code_expires_at    TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  last_activity_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  end_reason         TEXT,
  history            JSONB NOT NULL DEFAULT '[]'::jsonb,
  questions          INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_chat_sessions_state_check CHECK (state IN ('awaiting_code', 'active', 'ended'))
);
CREATE INDEX IF NOT EXISTS admin_chat_sessions_open ON admin_chat_sessions (account_id, member_id) WHERE state <> 'ended';

CREATE TABLE IF NOT EXISTS admin_chat_seen (
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_key  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, message_key)
);

CREATE TABLE IF NOT EXISTS admin_chat_audit (
  id           BIGSERIAL PRIMARY KEY,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES admin_chat_members(id) ON DELETE SET NULL,
  session_id   UUID REFERENCES admin_chat_sessions(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  event        TEXT NOT NULL,
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_chat_audit_account ON admin_chat_audit (account_id, id DESC);
