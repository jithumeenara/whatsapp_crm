-- One Facebook Page / one Instagram account per workspace (A4 handoff).
--
-- facebook_config.page_id and instagram_config.instagram_account_id had no
-- unique constraint, so two workspaces could save the same Page. The
-- Facebook / Instagram webhooks find the workspace by that id
-- (`WHERE page_id = … LIMIT 1`), so a second workspace that claimed a Page
-- could receive — and answer with its own assistant — the first one's
-- customer messages. The settings routes check for a taken id before
-- saving, but that check races, and Quick Connect (embedded-signup) did
-- not check at all. These indexes make the database refuse the second
-- claim. Empty and NULL ids (a channel not yet connected) are left out.
--
-- PRE-CHECK — this migration FAILS (and changes nothing) if two workspaces
-- already hold the same id. Find them first, on crm_prod_copy, and decide
-- with the businesses which workspace keeps the Page; disconnect it in the
-- other one's Settings → Channels (never delete the workspace):
--
--   SELECT page_id, array_agg(account_id) AS accounts, count(*)
--     FROM facebook_config
--    WHERE page_id IS NOT NULL AND page_id <> ''
--    GROUP BY page_id HAVING count(*) > 1;
--
--   SELECT instagram_account_id, array_agg(account_id) AS accounts, count(*)
--     FROM instagram_config
--    WHERE instagram_account_id IS NOT NULL AND instagram_account_id <> ''
--    GROUP BY instagram_account_id HAVING count(*) > 1;
--
-- Both must return no rows.
--
-- Safe to run twice (IF NOT EXISTS). The two tables are created by the app
-- on first use (src/lib/social/ensure-tables.ts), so a deployment that has
-- never connected Facebook / Instagram may not have them: each index is
-- created only when its table exists. Run this file again after the first
-- Facebook / Instagram connection on such a deployment.
--
-- Not mirrored in prisma/schema.prisma: these tables are raw-SQL tables
-- that are not Prisma models, and Prisma cannot express a partial index.

DO $$
BEGIN
  IF to_regclass('public.facebook_config') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS facebook_config_page_id_key
      ON public.facebook_config (page_id)
      WHERE page_id IS NOT NULL AND page_id <> '';
  END IF;

  IF to_regclass('public.instagram_config') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS instagram_config_instagram_account_id_key
      ON public.instagram_config (instagram_account_id)
      WHERE instagram_account_id IS NOT NULL AND instagram_account_id <> '';
  END IF;
END $$;

-- ROLLBACK (run by hand, only if this must be undone; drops only the two
-- indexes this file added, no data is touched):
--
--   BEGIN;
--   DROP INDEX IF EXISTS public.facebook_config_page_id_key;
--   DROP INDEX IF EXISTS public.instagram_config_instagram_account_id_key;
--   COMMIT;
