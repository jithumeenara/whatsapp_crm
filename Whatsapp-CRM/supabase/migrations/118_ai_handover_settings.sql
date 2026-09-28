-- How the assistant hands a customer to a person (src/lib/ai/
-- handover-settings.ts): { "ask_first": true } asks the customer before
-- connecting them, offers the chat to an agent inside working hours and
-- offers a call back outside them (handover-consent.ts). Read with plain
-- SQL, not through Prisma, so a database without it keeps working; also
-- added when first changed.
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS handover_settings JSONB;
