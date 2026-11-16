-- 167: districts / areas are the business's own list (Settings → Leads),
-- not a list fixed in the code. A business anywhere can set its own areas,
-- or none (then the lead form takes the area as free text).
--
-- Businesses already running keep the list they had: rows that exist now
-- get the districts the screens used to show. A server installed later
-- has no rows here yet, so it starts empty. Safe to run twice: the column
-- is added only if missing and only empty (NULL) rows are filled.

ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS districts JSONB;

UPDATE lead_settings
SET    districts = '[{"icon":"","label":"Thiruvananthapuram"},{"icon":"","label":"Kollam"},{"icon":"","label":"Pathanamthitta"},{"icon":"","label":"Alappuzha"},{"icon":"","label":"Kottayam"},{"icon":"","label":"Idukki"},{"icon":"","label":"Ernakulam"},{"icon":"","label":"Thrissur"},{"icon":"","label":"Palakkad"},{"icon":"","label":"Malappuram"},{"icon":"","label":"Kozhikode"},{"icon":"","label":"Wayanad"},{"icon":"","label":"Kannur"},{"icon":"","label":"Kasaragod"}]'::jsonb
WHERE  districts IS NULL;
