-- How long the assistant is allowed to think before it answers.
--
-- Gemini 3 reasons before it replies, and it does so by default: Flash
-- sits at "medium" (the preview sat at "high") unless the request says
-- otherwise. That deliberation is where a WhatsApp reply's seconds
-- actually go. It is worth paying for a hard question; it buys nothing
-- a customer can perceive when the answer is a fee table that was
-- already retrieved and handed to the model.
--
-- So the default here is 'low', not the provider's own default. An
-- account that wants the longer deliberation back can say so in
-- Settings > AI; nobody has to know the word "thinking" to get a fast
-- reply.
--
-- Values: 'minimal' | 'low' | 'balanced' | 'thorough'. Translated to
-- each provider's own vocabulary in src/lib/ai/reasoning.ts, and sent
-- only to models documented to accept it.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS reasoning_effort text NOT NULL DEFAULT 'low';

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_reasoning_effort_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_reasoning_effort_check
  CHECK (reasoning_effort IN ('minimal', 'low', 'balanced', 'thorough'));
