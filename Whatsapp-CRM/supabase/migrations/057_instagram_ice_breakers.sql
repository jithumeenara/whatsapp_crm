-- Instagram Ice Breakers / Persistent Menu (Finding IG·03 — small, no new
-- Meta permission needed, a single POST /me/messenger_profile call).
--
-- Also adds comment_dm_status, scaffolding for Finding IG·01 (comment-to-DM)
-- which IS gated on a new Meta permission (instagram_business_manage_comments)
-- — this column just tracks that gate; it stays 'pending_meta_approval'
-- forever until a human manually flips it, nothing in this app can set it
-- to 'approved' itself. Added here (not a later migration) since it's the
-- same table and avoids a third ALTER TABLE pass on instagram_config.
ALTER TABLE instagram_config
  ADD COLUMN IF NOT EXISTS ice_breakers      JSONB,
  ADD COLUMN IF NOT EXISTS persistent_menu   JSONB,
  ADD COLUMN IF NOT EXISTS profile_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comment_dm_status TEXT NOT NULL DEFAULT 'pending_meta_approval';
