-- Meta's webhook payload always includes a real MIME type for every media
-- message, and a filename for documents specifically — both were being
-- parsed and then discarded (no column to store them in). Needed to
-- reliably show a PDF thumbnail vs. a generic file chip, and to show a
-- document's actual filename separately from its caption.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mime_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_filename TEXT;
