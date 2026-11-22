-- 181: The Instagram / Messenger webhook verify token lives in the database
-- (Settings → Embedded Signup), sealed like the App Secret — not in .env.
--
-- One token per server's Meta App: Meta sends it once when the server owner
-- presses "Verify and save" on the Instagram or Page webhook. Each
-- workspace's own token (instagram_config / facebook_config .verify_token,
-- for a pasted-token connection) still works as before.
--
-- (180 is reserved by another session.) Adds a column only. Safe to run twice.

ALTER TABLE IF EXISTS meta_platform_config ADD COLUMN IF NOT EXISTS webhook_verify_token TEXT;
