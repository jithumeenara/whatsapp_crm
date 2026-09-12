-- Three things the rebuilt AI section needs and the schema had no home for.

-- 1. The Admin assistant gets its own instructions. Customer tone and
--    internal analytics behaviour are different jobs; sharing one prompt
--    meant a tweak aimed at customers silently changed data answers too.
ALTER TABLE ai_configs ADD COLUMN admin_system_prompt text;

-- 2. Whether a customer reply may include that contact's own CRM
--    context (lead stage, recent activity, where they came from), so the
--    same person is understood across WhatsApp/Instagram/Messenger
--    instead of being a stranger on each channel. On by default: it is
--    the behaviour that makes replies feel like they know the customer.
ALTER TABLE ai_configs ADD COLUMN customer_context_enabled boolean NOT NULL DEFAULT true;

-- 3. What a knowledge entry is FOR, in the account's own words. This is
--    prepended to the entry's text in the prompt, so the model is told
--    what a chunk is rather than inferring it from a fragment.
ALTER TABLE ai_knowledge_items ADD COLUMN description text;

-- The business itself, structured. Previously the AI knew nothing about
-- the company unless someone hand-wrote it all into the system prompt,
-- which is why untouched accounts sounded generic.
CREATE TABLE company_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  legal_name     text,
  display_name   text,
  -- Category/section each carry an "other" escape hatch: the picker
  -- lists what most accounts are, anything else is typed rather than
  -- forced into a wrong bucket.
  category       text,
  category_other text,
  section        text,
  section_other  text,
  about          text,
  services       text,
  website        text,
  email          text,
  phone          text,
  address        text,
  city           text,
  state          text,
  country        text,
  working_hours  text,
  languages      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
