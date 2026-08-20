-- Stores the actual per-recipient body text after variable substitution,
-- captured once at send time, so the broadcast report page can show exactly
-- what a given recipient's message said (a "view sent message" preview)
-- without re-deriving it later from contact/custom-field data that may
-- have since changed.
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS rendered_body TEXT;
