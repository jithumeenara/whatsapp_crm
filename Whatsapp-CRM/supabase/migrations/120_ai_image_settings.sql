-- Whether the assistant reads images customers send, and whether it asks
-- them to confirm what it read (src/lib/ai/image-settings.ts):
-- { "read_images": true, "confirm": true }. Read with plain SQL, not
-- through Prisma, so a database without it keeps working; also added when
-- first changed. Safe to run more than once.
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS image_settings JSONB;
