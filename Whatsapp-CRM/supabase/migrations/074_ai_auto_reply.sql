-- 074 — let the assistant answer when no chatbot claims the message.
--
-- Today an inbound message is offered to the flow runner, then to
-- automations. If neither has a trigger that matches, nothing happens at
-- all: the message sits in the inbox until a person opens it. For an
-- account whose customers ask ordinary questions in their own words —
-- which is most of them — that is the majority of messages, because a
-- keyword list can only ever cover the phrasings somebody thought of.
--
-- Off by default. This is the assistant talking to real customers with
-- no flow around it, which is a genuine behaviour change, so it stays
-- opt-in rather than arriving switched on after a deploy.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS ai_auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,

  -- Which channels the fallback covers. WhatsApp only to begin with:
  -- it is the channel with a real send path, real formatting rules and
  -- real testing behind it.
  ADD COLUMN IF NOT EXISTS ai_auto_reply_channels JSONB NOT NULL DEFAULT '["whatsapp"]'::jsonb,

  -- A ceiling on how many times the assistant will answer one
  -- conversation before it stops and waits for a person.
  --
  -- Two customers going back and forth with a bot that cannot help them
  -- is worse than silence, and this is the cheapest guard against it.
  -- Counted per conversation, not per day: the point is the length of
  -- one unresolved exchange.
  ADD COLUMN IF NOT EXISTS ai_auto_reply_max_turns INTEGER NOT NULL DEFAULT 8,

  -- Stop replying once a human has joined the conversation. Nothing is
  -- more damaging to trust than an agent typing an answer while a bot
  -- talks over them in the same thread.
  ADD COLUMN IF NOT EXISTS ai_auto_reply_pause_on_agent BOOLEAN NOT NULL DEFAULT true;
