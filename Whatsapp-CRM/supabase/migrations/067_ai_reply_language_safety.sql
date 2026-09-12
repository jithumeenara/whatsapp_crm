-- Two settings the rebuilt AI Config screen surfaces (Overview's Model
-- Details card, and step 2 of the Configure wizard), both of which had
-- no home in the schema before.
--
-- reply_language: plain language name ("Malayalam", "English", …), null
-- meaning auto-detect — reply in whatever language the customer wrote
-- in. Applied as a system-prompt instruction (no provider exposes a hard
-- output-language switch), see src/lib/ai/knowledge.ts.
--
-- safety_filter: 'strict' | 'balanced' | 'relaxed', mapped onto Gemini's
-- HarmBlockThreshold for all four harm categories in
-- src/lib/ai/providers/gemini.ts. 'balanced' matches Gemini's own
-- default, so every existing account keeps its current behavior.
ALTER TABLE ai_configs ADD COLUMN reply_language text;
ALTER TABLE ai_configs ADD COLUMN safety_filter text NOT NULL DEFAULT 'balanced';
