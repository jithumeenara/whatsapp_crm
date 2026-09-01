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
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
}
