-- 148: a contact's age and address, beside its gender.
--
-- "New lead" first kept these as the custom fields "Age" and "Address",
-- which showed only under the contact's Fields tab. They are now the
-- contact's own columns, shown in Details, New contact and the lead page.
-- Values already saved as those custom fields are copied across (only
-- into an empty column, only when they fit); the custom fields stay.
-- Safe to run twice.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS age smallint;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_age_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_age_check CHECK (age IS NULL OR age BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_address_length_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_address_length_check CHECK (address IS NULL OR char_length(address) <= 500);
  END IF;
END $$;

UPDATE contacts c
SET age = trim(v.value)::smallint
FROM contact_custom_values v
JOIN custom_fields f ON f.id = v.custom_field_id
WHERE v.contact_id = c.id
  AND f.account_id = c.account_id
  AND lower(f.field_name) = 'age'
  AND c.age IS NULL
  -- CASE, so the number is read only from text that is one.
  AND CASE WHEN v.value ~ '^\s*\d{1,3}\s*$' THEN trim(v.value)::int BETWEEN 0 AND 120 ELSE false END;

UPDATE contacts c
SET address = trim(v.value)
FROM contact_custom_values v
JOIN custom_fields f ON f.id = v.custom_field_id
WHERE v.contact_id = c.id
  AND f.account_id = c.account_id
  AND lower(f.field_name) = 'address'
  AND c.address IS NULL
  AND trim(coalesce(v.value, '')) <> ''
  AND char_length(trim(v.value)) <= 500;
