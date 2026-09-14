-- Which bot sent a message.
--
-- Every automated message in this app is stored with sender_type 'bot':
-- chatbot steps, automation actions and the AI assistant's own replies
-- are indistinguishable once written. The AI's per-conversation reply
-- limit counted all of them, so a customer walking through a chatbot
-- menu — a welcome, a list, a few buttons, a "looks like you are busy"
-- timeout — spent the assistant's entire allowance before it had said
-- anything, and it then refused to answer them at all.
--
-- Nullable and additive. Existing rows stay NULL, which reads as "some
-- bot, before this was recorded" and is deliberately not counted: the
-- limit is about one ongoing exchange, and every historical row belongs
-- to an exchange that has long since ended.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS bot_source TEXT;

-- The limit's own query: one conversation, the assistant's own replies,
-- recent ones only.
CREATE INDEX IF NOT EXISTS messages_bot_source_idx
  ON messages (conversation_id, bot_source, created_at)
  WHERE bot_source IS NOT NULL;
