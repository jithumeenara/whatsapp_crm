/**
 * Saved reports and the export log (migration 119).
 *
 * A saved report is its sentence (the spec), never its numbers: opening
 * it always runs it again, so nobody is shown last month's figures as
 * today's. The export log answers "who took what data out, and when" —
 * the record the DPDP Act expects a business to be able to show.
 *
 * Raw SQL, like the other tables a lagging server may not have yet; the
 * tables are created here on first use if migration 119 has not run.
 */

import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'
import type { ReportSpec } from './engine'

function ensureTables(): Promise<void> {
  return onceSchemaPatch('reports.saved_and_exports', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS saved_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        name text NOT NULL,
        spec jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_saved_reports_account ON saved_reports (account_id, updated_at DESC)`,
    )
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS report_exports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        format text NOT NULL,
        title text NOT NULL,
        spec jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_report_exports_account ON report_exports (account_id, created_at DESC)`,
    )
  })
}

export interface SavedReport {
  id: string
  name: string
  spec: ReportSpec
  created_at: Date
  updated_at: Date
}

/** At most this many per account: enough for every question a team asks,
 *  not enough for a script to fill the table. */
export const MAX_SAVED = 200

export async function listSaved(accountId: string): Promise<SavedReport[]> {
  await ensureTables()
  return prisma.$queryRaw<SavedReport[]>`
    SELECT id, name, spec, created_at, updated_at
    FROM saved_reports WHERE account_id = ${accountId}::uuid
    ORDER BY updated_at DESC LIMIT ${MAX_SAVED}`
}

export async function countSaved(accountId: string): Promise<number> {
  await ensureTables()
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM saved_reports WHERE account_id = ${accountId}::uuid`
  return Number(rows[0]?.n ?? 0)
}

export async function createSaved(accountId: string, userId: string, name: string, spec: ReportSpec): Promise<string> {
  await ensureTables()
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO saved_reports (account_id, created_by, name, spec)
    VALUES (${accountId}::uuid, ${userId}::uuid, ${name}, ${JSON.stringify(spec)}::jsonb)
    RETURNING id`
  return rows[0].id
}

export async function deleteSaved(accountId: string, id: string): Promise<boolean> {
  await ensureTables()
  const n = await prisma.$executeRaw`
    DELETE FROM saved_reports WHERE id = ${id}::uuid AND account_id = ${accountId}::uuid`
  return n > 0
}

export async function recordExport(
  accountId: string,
  userId: string,
  format: 'xlsx',
  title: string,
  spec: ReportSpec,
): Promise<void> {
  await ensureTables()
  await prisma.$executeRaw`
    INSERT INTO report_exports (account_id, user_id, format, title, spec)
    VALUES (${accountId}::uuid, ${userId}::uuid, ${format}, ${title.slice(0, 300)}, ${JSON.stringify(spec)}::jsonb)`
}
