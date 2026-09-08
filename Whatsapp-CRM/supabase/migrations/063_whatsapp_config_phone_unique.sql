-- Closes a TOCTOU race in POST /api/whatsapp/config: the app-level
-- "one phone_number_id, one account" check is a read-then-write with no
-- lock, so two concurrent saves for the same phone_number_id under
-- different accounts could both pass it and create duplicate rows. A
-- duplicate silently breaks inbound delivery forever after — the
-- webhook's findMany-by-phone_number_id lookup sees >1 row and drops
-- every message for that number (src/app/api/whatsapp/webhook/route.ts).
-- No existing duplicates as of this migration (verified before writing it).
ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_phone_number_id_key UNIQUE (phone_number_id);
