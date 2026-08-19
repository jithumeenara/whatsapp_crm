-- Lets a broadcast campaign override the template's approved sample media
-- for its IMAGE/VIDEO/DOCUMENT header, instead of always reusing whatever
-- media was uploaded when the template was submitted to Meta for approval.
-- NULL means "use the template's own header_media_url" (unchanged behaviour).
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS header_media_url TEXT;
