-- 176: Messenger utility templates — the way to message a customer on
-- Messenger after the 24-hour window (order updates, reminders,
-- confirmations). They replace the message tags Meta retired on 27 Apr 2026.
-- Created at Meta from the CRM; Meta approves them (usually in seconds).
--
-- body keeps {{1}}, {{2}}… placeholders; param_count is how many a send must
-- fill. created_by links to users ON DELETE RESTRICT (migration 132).
-- Safe to run twice. (173 is lead summaries on another branch.)

CREATE TABLE IF NOT EXISTS messenger_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  language     TEXT        NOT NULL DEFAULT 'en_US',
  body         TEXT        NOT NULL,
  param_count  INTEGER     NOT NULL DEFAULT 0,
  status       TEXT        NOT NULL DEFAULT 'pending',
  meta_id      TEXT,
  reject_reason TEXT,
  created_by   UUID        REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT messenger_templates_one_name UNIQUE (account_id, name, language)
);
