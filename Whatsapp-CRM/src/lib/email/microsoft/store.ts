import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'

/**
 * Creates the microsoft_mailboxes table if migration 111 has not been
 * run, once per process. Same statement as the migration.
 */
export function ensureMicrosoftMailboxTable(): Promise<void> {
  return onceSchemaPatch('microsoft_mailboxes', () =>
    prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS microsoft_mailboxes (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id              UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
        user_id                 UUID NOT NULL,
        tenant_id               TEXT NOT NULL,
        client_id               TEXT NOT NULL,
        client_secret           TEXT NOT NULL,
        mailbox_email           TEXT,
        mailbox_name            TEXT,
        refresh_token           TEXT,
        access_token            TEXT,
        access_expires_at       TIMESTAMPTZ,
        subscription_id         TEXT UNIQUE,
        notification_url        TEXT,
        subscription_expires_at TIMESTAMPTZ,
        client_state            TEXT NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'not_connected',
        last_error              TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `),
  )
}
