-- Instagram story replies (Finding IG·02, non-gated half — story replies
-- arrive in the normal `messages` webhook via a reply_to.story object, no
-- new Meta permission needed, purely a parsing gap). Story MENTIONS (the
-- other half of IG·02) need the gated `mentions` webhook field/permission
-- and reuse this same 'story_mention' content_type once that scaffolding
-- lands (Batch 4) — added to the same CHECK list now to avoid a third
-- redundant ALTER TABLE pass on this constraint.
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'address', 'contacts',
    'order', 'catalog', 'single_product', 'multi_product',
    'payment_order_details', 'payment_order_status',
    'story_reply', 'story_mention'
  ));

-- The replied-to story's own media, for display in the inbox thread.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS story_media_url TEXT,
  ADD COLUMN IF NOT EXISTS story_media_id  TEXT;
