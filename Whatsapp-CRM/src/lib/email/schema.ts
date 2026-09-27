import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'
import { ensureMicrosoftMailboxTable } from './microsoft/store'

/**
 * The columns migration 112 adds, applied once per process in case the
 * migration has not been run — nullable additions, so no table rewrite.
 */
export function ensureEmailColumns(): Promise<void> {
  return onceSchemaPatch('email_rich_columns', async () => {
    await ensureMicrosoftMailboxTable()
    await prisma.$executeRawUnsafe('ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_meta JSONB')
    await prisma.$executeRawUnsafe('ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS email_meta JSONB')
    await prisma.$executeRawUnsafe('ALTER TABLE microsoft_mailboxes ADD COLUMN IF NOT EXISTS signature TEXT')
  })
}
