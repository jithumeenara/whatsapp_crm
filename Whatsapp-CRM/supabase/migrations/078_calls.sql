-- Voice calls: history, per-account settings, and the fields SIP will
-- need when it arrives.
--
-- Scope note, so the shape makes sense: WhatsApp calling is the route
-- being built (it runs on the Cloud API this app already uses, and an
-- inbound call costs nothing). SIP is deliberately modelled now and
-- implemented later — the columns exist so call history does not have to
-- be migrated again when it lands, and every one of them is nullable.
--
-- The one thing this migration does NOT cover is the live audio path.
-- Signalling, history and routing are ordinary webhook-and-row work; the
-- media bridge is a persistent real-time connection and a different kind
-- of problem. Rows here are written by whatever ends up carrying it.

CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Nullable: a call can arrive from a number that has never messaged,
  -- so there may be no conversation and no contact to attach it to yet.
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,

  -- 'whatsapp' | 'sip'. Not an enum: the set will grow, and every other
  -- channel column in this schema is text for the same reason.
  channel text NOT NULL DEFAULT 'whatsapp',
  direction text NOT NULL,           -- 'inbound' | 'outbound'

  -- 'ringing' | 'in_progress' | 'completed' | 'missed' | 'rejected' |
  -- 'failed'. 'missed' means it rang and nobody (and no AI) picked up,
  -- which is the state the call list exists to make visible.
  status text NOT NULL DEFAULT 'ringing',

  -- The other party, kept even when contact_id is null so a call from an
  -- unknown number is still identifiable.
  from_number text,
  to_number text,

  -- Who actually handled it: 'ai' | 'agent' | null when nobody did.
  handled_by text,
  agent_id uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Set when the AI passed the call to a person, with the reason, so the
  -- history can show why rather than only that it happened.
  transferred_at timestamptz,
  transfer_reason text,

  started_at timestamptz NOT NULL DEFAULT now(),
  -- Null on a missed call. The gap between started_at and this is how
  -- long the caller waited before giving up.
  answered_at timestamptz,
  ended_at timestamptz,
  -- Talk time, not ring time: answered_at to ended_at. Stored rather
  -- than derived so the list can sort and total without recomputing, and
  -- so a call whose end event never arrives is visibly null instead of
  -- silently zero.
  duration_seconds integer,

  -- What was said, when the AI handled it.
  transcript text,
  recording_url text,
  end_reason text,

  -- The provider's own call id. Unique so a webhook replay — which Meta
  -- does — updates the existing row instead of inserting a duplicate.
  provider_call_id text,
  raw_payload jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS calls_provider_call_id_key
  ON calls (provider_call_id) WHERE provider_call_id IS NOT NULL;

-- The call list's own query: one account, newest first.
CREATE INDEX IF NOT EXISTS calls_account_started_idx ON calls (account_id, started_at DESC);
-- The filters the list offers.
CREATE INDEX IF NOT EXISTS calls_account_status_idx ON calls (account_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS calls_contact_idx ON calls (contact_id, started_at DESC);

-- Per-account call settings. One row per account, created on first save.
CREATE TABLE IF NOT EXISTS call_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,

  -- Off by default. Letting an assistant answer the phone is a decision
  -- somebody makes deliberately, not something a deploy switches on.
  ai_answer_enabled boolean NOT NULL DEFAULT false,
  -- Spoken first. Null falls back to the account's assistant persona.
  ai_greeting text,
  -- Past this, the assistant stops and offers a person.
  ai_max_minutes integer NOT NULL DEFAULT 10,

  -- Transfer to a human. Same vocabulary as the chatbot handoff step:
  -- 'specific' | 'least_busy' | 'round_robin'.
  transfer_strategy text NOT NULL DEFAULT 'least_busy',
  transfer_only_online boolean NOT NULL DEFAULT true,
  transfer_to uuid REFERENCES users(id) ON DELETE SET NULL,
  transfer_fallback_to uuid REFERENCES users(id) ON DELETE SET NULL,
  -- How long the agent's screen rings before it counts as missed.
  ring_seconds integer NOT NULL DEFAULT 30,

  -- Recording is a consent question, not a feature toggle, so it is off
  -- until somebody turns it on knowing that.
  record_calls boolean NOT NULL DEFAULT false,

  -- SIP, for later. Present so history and settings do not need another
  -- migration when it arrives; nothing reads these yet.
  sip_enabled boolean NOT NULL DEFAULT false,
  sip_host text,
  sip_username text,
  sip_password text,            -- encrypted at rest by the app, as with every other credential
  sip_from_number text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
