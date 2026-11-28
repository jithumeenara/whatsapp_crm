-- The two-step verification PIN Quick Connect sets when it registers a
-- number (src/lib/whatsapp/two-step-pin.ts), kept encrypted. Without it a
-- second Quick Connect of the same number generated a new PIN and Meta
-- refused the registration ("PIN mismatch", 133005). Read with plain SQL
-- so a database without the column keeps working. Safe to run twice.
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS two_step_pin TEXT;
