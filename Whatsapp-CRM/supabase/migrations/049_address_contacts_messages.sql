-- Widen messages.content_type to allow 'address' and 'contacts' — both are
-- standard, no-approval WhatsApp message types (a customer sharing a
-- delivery address or a vCard-style contact card) that were previously
-- falling into the "[Unsupported message type: X]" default branch.
-- Same drop/re-add idiom as migration 010_flows.sql when 'interactive' was
-- added.
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'address', 'contacts'
  ));
