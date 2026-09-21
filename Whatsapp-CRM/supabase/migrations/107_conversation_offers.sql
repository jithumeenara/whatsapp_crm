-- Offering a waiting customer to one agent at a time.
--
-- ── Why a row and not a timer ───────────────────────────────────────
--
-- The obvious build is a setTimeout: offer it, wait a minute, move on.
-- That timer lives in one process's memory and dies with it, and a
-- conversation whose timer died would wait forever with nothing on any
-- screen to say so — the worst failure this feature could have, because
-- it looks exactly like nothing happening.
--
-- An offer that is a row with an expiry is true whoever asks, survives
-- a restart, and can be swept by anything. The countdown an agent sees
-- is computed from it rather than driving it.
--
-- ── Why offers are kept after they end ──────────────────────────────
--
-- A conversation that took nine minutes to reach somebody looks
-- identical afterwards to one answered instantly. These rows are the
-- only record of who was asked, in what order, and how long each one
-- sat — which is the difference between "the team is too small" and
-- "one person is never accepting".

CREATE TABLE IF NOT EXISTS conversation_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- pending | accepted | declined | expired | cancelled
  --
  -- 'cancelled' is its own state rather than 'expired': an offer that
  -- ended because somebody else picked the conversation up says
  -- something good about the team, and folding it into the timeout
  -- count would make a healthy account look like a slow one.
  status          text NOT NULL DEFAULT 'pending',

  -- Copied onto the row rather than read from settings when it is
  -- checked. The window an offer was made under is a fact about that
  -- offer, and changing the setting must not retroactively expire
  -- offers that are still live.
  window_seconds  integer NOT NULL DEFAULT 60,

  -- Why this person. Written for whoever reads the thread later, and
  -- shown to the agent when the answer is "nobody free knows this
  -- subject" so they understand why a Dental question reached them.
  reason          text NOT NULL DEFAULT '',
  outside_speciality boolean NOT NULL DEFAULT false,

  offered_at      timestamptz NOT NULL DEFAULT now(),
  answered_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- "Is anything being offered to me right now?" — asked by every open
-- browser, so it is the one that has to be quick.
CREATE INDEX IF NOT EXISTS conversation_offers_pending_idx
  ON conversation_offers (user_id, status, offered_at DESC);

-- "Who has this conversation already been offered to?" — the rotation's
-- own question, and what stops it returning to somebody at lunch.
CREATE INDEX IF NOT EXISTS conversation_offers_conversation_idx
  ON conversation_offers (conversation_id, created_at);

-- The sweep that expires them looks only at live ones.
CREATE INDEX IF NOT EXISTS conversation_offers_sweep_idx
  ON conversation_offers (status, offered_at);

COMMENT ON TABLE conversation_offers IS
  'One row per agent a waiting conversation was offered to. Expiry is a stored timestamp rather than an in-memory timer, so an offer cannot be lost with the process that made it. See src/lib/agents/offer.ts.';

-- ── What each agent handles ─────────────────────────────────────────
--
-- Category keys from service_categories, as a list. Empty or null means
-- "anything", which is both the sensible default and the correct answer
-- for a business that has not set categories up at all.
--
-- A list rather than a join table because it is read whole, written
-- whole, and never queried across accounts — and because a join table
-- would need its own screen to be worth the extra shape.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS handles_categories jsonb;

COMMENT ON COLUMN profiles.handles_categories IS
  'Category keys this agent handles, from service_categories. Null or empty = anything. A preference in routing, never a wall — see src/lib/agents/offer.ts.';

-- ── The settings that govern all of it ──────────────────────────────
--
-- On lead_settings beside the judgement switch, because the judgement
-- is what decides the category and the urgency these act on.
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS offer_enabled boolean NOT NULL DEFAULT false;

-- Sixty seconds. Webex defaults to 30 for chat and 18 for a call;
-- WhatsApp is neither, because the customer is not watching a widget
-- and the agent is usually mid-sentence with somebody else.
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS offer_seconds integer NOT NULL DEFAULT 60;

-- Three is where the live-chat research lands for an experienced agent.
ALTER TABLE lead_settings
  ADD COLUMN IF NOT EXISTS max_concurrent_chats integer NOT NULL DEFAULT 3;

COMMENT ON COLUMN lead_settings.offer_enabled IS
  'Whether a conversation the assistant hands over is offered to a specific agent with a timer. Off by default; independent of ai_judgement_mode, which decides what the offer knows about the conversation.';
