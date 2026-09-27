import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'

/**
 * The columns migration 113 adds, applied once per process in case the
 * migration has not been run.
 *
 * Called at start-up from server.ts as well as from the routes that use
 * them: every `dataRecord` query names `source` now, so on a database
 * without it the whole Data Store — and the assistant's registrations —
 * would fail, not just the new screens. Nullable additions and indexes
 * only; nothing is rewritten.
 */
export function ensureDataStoreColumns(): Promise<void> {
  return onceSchemaPatch('data_store_tracking', async () => {
    await prisma.$executeRawUnsafe('ALTER TABLE data_records ADD COLUMN IF NOT EXISTS source TEXT')
    await prisma.$executeRawUnsafe('ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS alert_config JSONB')
    await prisma.$executeRawUnsafe('ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS form_config JSONB')
    await prisma.$executeRawUnsafe('ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS form_token TEXT')
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS data_tables_form_token_key ON data_tables (form_token)',
    )
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS data_records_table_created_idx ON data_records (table_id, created_at DESC)',
    )
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS data_records_table_contact_idx ON data_records (table_id, contact_id)',
    )
  })
}
