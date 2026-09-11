-- Chat translation (agent-facing) — see src/lib/ai/translate.ts for the
-- Gemini call, src/components/inbox/message-bubble.tsx / message-composer.tsx
-- for the UI. All additive; every new column is nullable and defaults to
-- "feature off" for existing rows.
ALTER TABLE profiles ADD COLUMN preferred_language text;
ALTER TABLE contacts ADD COLUMN detected_language text;
ALTER TABLE messages ADD COLUMN detected_lang text;
ALTER TABLE messages ADD COLUMN translated_text text;
ALTER TABLE messages ADD COLUMN translated_lang text;
