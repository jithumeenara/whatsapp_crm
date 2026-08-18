-- Per-conversation scheduled/recurring messages (text, media, or interactive
-- buttons mirroring the chatbot's Send Buttons node). Distinct from
-- broadcasts (fan-out to many contacts once) and automations (event-
-- triggered) -- this is a single conversation, time/interval-triggered send,
-- e.g. "remind this customer every 2 days until they reply, up to 5 times."

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id       UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_by       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  content_text     TEXT,
  media_url        TEXT,
  media_type       TEXT,
  buttons          JSONB,

  schedule_type    TEXT        NOT NULL DEFAULT 'once',
  interval_value   INT,
  interval_unit    TEXT,
  stop_on_reply    BOOLEAN     NOT NULL DEFAULT true,
  max_sends        INT         NOT NULL DEFAULT 1,
  sends_count      INT         NOT NULL DEFAULT 0,

  status           TEXT        NOT NULL DEFAULT 'active',
  next_send_at     TIMESTAMPTZ NOT NULL,
  last_sent_at     TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_messages_status_next_send_idx
  ON scheduled_messages (status, next_send_at);
