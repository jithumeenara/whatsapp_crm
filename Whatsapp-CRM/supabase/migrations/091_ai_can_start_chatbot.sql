-- Letting the assistant start a chatbot the business already built.
--
-- A customer asks where the campus is. The business has a Location
-- Guide bot that answers exactly that, with the buttons, the map link
-- and the photo — and until now the assistant could only paraphrase it,
-- because the bot only ran when somebody typed its trigger word.
--
-- Off by default, and that is not caution for its own sake. Starting a
-- bot takes the conversation over: the next thing the customer says
-- goes to the bot's menu, not to the assistant. That is right for a
-- bot the account chose to expose and wrong for every other one, so it
-- is granted per bot, deliberately, rather than inferred.
ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS ai_can_start boolean NOT NULL DEFAULT false;

-- Only chatbots are ever startable this way, and only a handful per
-- account will be. A partial index keeps the assistant's lookup off a
-- full scan of every flow the account has ever built.
CREATE INDEX IF NOT EXISTS flows_ai_can_start_idx
  ON flows (account_id)
  WHERE ai_can_start = true;
