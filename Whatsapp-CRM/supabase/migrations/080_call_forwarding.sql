-- Where call webhooks are forwarded to.
--
-- Meta posts to exactly one URL per app, and this app's is the CRM —
-- which must stay that way, because messages are production and a voice
-- agent under development is not. So the CRM stays the front door and
-- passes call events on.
--
-- Null means forward nowhere, which is today's behaviour exactly. Until
-- somebody fills this in, nothing changes.
ALTER TABLE call_configs ADD COLUMN IF NOT EXISTS call_forward_url text;
