-- Which pages a particular person may open.
--
-- ── Why this is per person and not per role ─────────────────────────
--
-- Roles already decide what somebody may *do* — see src/lib/auth/roles.ts,
-- where five ranks gate every write in the application. This is a
-- different question: which screens they are given at all, decided by
-- the admin for each member individually rather than for a whole rank.
--
-- ── Why it may be null, and what null means ─────────────────────────
--
-- NULL is "nobody has decided for this person", and it falls back to the
-- default for their role — exactly what they see today. That matters
-- twice over: every existing member keeps working unchanged until an
-- admin touches them, and a member invited next month starts with a
-- sensible set rather than an empty one. An empty array is a real
-- answer and a different one: it means somebody deliberately took every
-- page away.
--
-- ── What is deliberately not stored here ────────────────────────────
--
-- Owners and admins never get a row's worth of restriction. Letting
-- their pages be switched off means one wrong click can remove the only
-- account that could put it back, and the way out is a database
-- console. That rule lives in code (src/lib/auth/page-access.ts) rather
-- than here, so it cannot be worked around by writing the column
-- directly from a migration or a script.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS page_access jsonb;

COMMENT ON COLUMN profiles.page_access IS
  'Array of nav hrefs this member may open, e.g. ["/dashboard","/leads"]. NULL = use the default for their role. Ignored for owner/admin, who always have every page.';
