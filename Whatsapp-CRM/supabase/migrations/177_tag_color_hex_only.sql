-- 177: Tag colours are put straight into CSS on several screens. Until now
-- POST /api/tags stored any text as a colour, so a value such as
-- url(https://evil.example/x) made staff browsers contact an outside
-- server. The route now stores #rrggbb only; this resets any older value
-- that is not a plain #rrggbb colour to the default green.
--
-- Changes only the colour of rows whose colour is invalid. Safe to run twice.

UPDATE tags
SET color = '#10b981'
WHERE color IS NULL OR color !~* '^#[0-9a-f]{6}$';
