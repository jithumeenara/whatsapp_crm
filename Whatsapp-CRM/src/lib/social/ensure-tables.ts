/**
 * facebook_config / instagram_config are raw-SQL tables (not part of
 * schema.prisma — see those routes' own comments), each created on first
 * touch via CREATE TABLE IF NOT EXISTS. Shared here so the definition lives
 * in exactly one place — both the existing manual-entry config routes and
 * the Embedded Signup route (which can now also write to these tables)
 * import from here instead of keeping their own copies in sync by hand.
 */
import { prisma } from "@/lib/db"

export async function ensureFacebookConfigTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS facebook_config (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id   UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      access_token TEXT,
      verify_token TEXT,
      page_id      TEXT,
      app_secret   TEXT,
      status       TEXT        NOT NULL DEFAULT 'disconnected',
      page_name    TEXT,
      last_tested_at TIMESTAMPTZ,
      test_error   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.catch(() => {})
  await addConnectionColumns("facebook_config")
}

export async function ensureInstagramConfigTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS instagram_config (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id           UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      access_token         TEXT,
      verify_token         TEXT,
      instagram_account_id TEXT,
      page_id              TEXT,
      status               TEXT        NOT NULL DEFAULT 'disconnected',
      ig_username          TEXT,
      ig_name              TEXT,
      last_tested_at       TIMESTAMPTZ,
      test_error           TEXT,
      -- Ice breakers / persistent menu (Meta-native, POST /me/messenger_profile)
      ice_breakers         JSONB,
      persistent_menu      JSONB,
      profile_synced_at    TIMESTAMPTZ,
      -- Comment-to-DM scaffolding — stays 'pending_meta_approval' until a
      -- human manually flips it once Meta grants instagram_business_manage_comments;
      -- nothing in this codebase can set it to 'approved' itself.
      comment_dm_status    TEXT        NOT NULL DEFAULT 'pending_meta_approval',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
  await addConnectionColumns("instagram_config")
}

/**
 * Migration 168's columns, also added here so a server that has not run it
 * yet still works. Safe to run every time (IF NOT EXISTS).
 *  - human_agent_enabled: reply up to 7 days with the HUMAN_AGENT tag
 *    (only once Meta approves the Human Agent feature for the app)
 *  - connected_via: 'manual' (pasted token) or 'login' (one-click connect)
 *  - token_kind, token_expires_at, granted_permissions: what the token is
 *    and may do, shown to the owner and used by the health check
 *  - app_secret (Instagram): an own app's secret, sealed, for webhook signatures
 */
async function addConnectionColumns(table: "facebook_config" | "instagram_config") {
  const stmts = table === "facebook_config"
    ? [
        prisma.$executeRaw`ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS human_agent_enabled BOOLEAN NOT NULL DEFAULT false`,
        prisma.$executeRaw`ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS connected_via TEXT NOT NULL DEFAULT 'manual'`,
        prisma.$executeRaw`ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS token_kind TEXT`,
        prisma.$executeRaw`ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ`,
        prisma.$executeRaw`ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS granted_permissions JSONB`,
        // Migration 170: Messenger greeting / Get Started / ice breakers / menu
        prisma.$executeRaw`ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS messenger_profile JSONB`,
        prisma.$executeRaw`ALTER TABLE facebook_config ADD COLUMN IF NOT EXISTS profile_synced_at TIMESTAMPTZ`,
      ]
    : [
        prisma.$executeRaw`ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS human_agent_enabled BOOLEAN NOT NULL DEFAULT false`,
        prisma.$executeRaw`ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS connected_via TEXT NOT NULL DEFAULT 'manual'`,
        prisma.$executeRaw`ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS token_kind TEXT`,
        prisma.$executeRaw`ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ`,
        prisma.$executeRaw`ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS granted_permissions JSONB`,
        prisma.$executeRaw`ALTER TABLE instagram_config ADD COLUMN IF NOT EXISTS app_secret TEXT`,
      ]
  for (const st of stmts) await st.catch((err: unknown) => console.warn(`[${table}] column not added:`, err instanceof Error ? err.message : err))
}
