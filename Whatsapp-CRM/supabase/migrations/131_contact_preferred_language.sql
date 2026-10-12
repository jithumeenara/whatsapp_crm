-- The language a customer chose — a chatbot's language buttons write it
-- through "Update contact → Language". The assistant then answers in it,
-- unless the customer's latest message is plainly in another language.
--
-- Free text ("Malayalam", "English", "Hindi"), like detected_language;
-- null when they never chose. Separate from detected_language, which the
-- translation feature overwrites on every translated message.
--
-- Safe to run again.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_language TEXT;
