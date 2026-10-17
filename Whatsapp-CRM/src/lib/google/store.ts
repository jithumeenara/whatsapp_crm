import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'

/**
 * Creates the two Google tables if migration 123 has not been run, once
 * per process. Same statements as the migration, so a server that was
 * deployed without running it still works rather than 500ing on the
 * first visit to Settings → Google.
 */
export function ensureGoogleTables(): Promise<void> {
  return onceSchemaPatch('google_sheets', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS google_connections (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id        UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
        user_id           UUID NOT NULL,
        client_id         TEXT NOT NULL,
        client_secret     TEXT NOT NULL,
        api_key           TEXT,
        google_email      TEXT,
        refresh_token     TEXT,
        access_token      TEXT,
        access_expires_at TIMESTAMPTZ,
        status            TEXT NOT NULL DEFAULT 'not_connected',
        last_error        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS google_sheet_links (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        table_id         UUID NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
        direction        TEXT NOT NULL CHECK (direction IN ('export', 'import')),
        spreadsheet_id   TEXT NOT NULL,
        spreadsheet_name TEXT,
        sheet_title      TEXT NOT NULL,
        auto_sync        BOOLEAN NOT NULL DEFAULT false,
        imported_keys    TEXT[] NOT NULL DEFAULT '{}',
        last_synced_at   TIMESTAMPTZ,
        last_error       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS google_sheet_links_table_id_direction_key ON google_sheet_links (table_id, direction)`,
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS google_sheet_links_account_id_idx ON google_sheet_links (account_id)`,
    )
    // Migration 124 — the services hub.
    for (const sql of [
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS granted_scopes TEXT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS enabled_services TEXT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS config_check JSONB`,
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS config_checked_at TIMESTAMPTZ`,
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ`,
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS last_health_at TIMESTAMPTZ`,
      `UPDATE google_connections
         SET granted_scopes = ARRAY['openid', 'email', 'https://www.googleapis.com/auth/drive.file'],
             enabled_services = ARRAY['sheets', 'drive'],
             connected_at = COALESCE(connected_at, updated_at)
       WHERE refresh_token IS NOT NULL AND cardinality(granted_scopes) = 0`,
      `CREATE TABLE IF NOT EXISTS google_activity (
         id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
         user_id    UUID,
         action     TEXT NOT NULL,
         detail     TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS google_activity_account_created_idx ON google_activity (account_id, created_at DESC)`,
      // Migration 125 — Gmail inbox.
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS gmail_history_id TEXT`,
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS gmail_polled_at TIMESTAMPTZ`,
      // Migration 126 — Calendar.
      `ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS calendar_settings JSONB`,
      `ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS google_event_id TEXT`,
      `ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS google_meet_link TEXT`,
      `ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ`,
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT`,
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ`,
      // Migration 127 — Forms.
      `CREATE TABLE IF NOT EXISTS google_form_links (
         id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
         table_id       UUID NOT NULL UNIQUE REFERENCES data_tables(id) ON DELETE CASCADE,
         form_id        TEXT NOT NULL,
         form_title     TEXT,
         responder_url  TEXT,
         question_map   JSONB NOT NULL DEFAULT '{}',
         auto_sync      BOOLEAN NOT NULL DEFAULT true,
         imported_ids   TEXT[] NOT NULL DEFAULT '{}',
         last_synced_at TIMESTAMPTZ,
         last_error     TEXT,
         created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS google_form_links_account_id_idx ON google_form_links (account_id)`,
      // Migration 129 — a sheet's column mapping.
      `ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS column_map JSONB`,
      // Migration 136 — two-way sync ('sync' links, snapshots per row).
      `DO $$
       BEGIN
         IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_sheet_links_direction_check'
                    AND pg_get_constraintdef(oid) NOT LIKE '%sync%') THEN
           ALTER TABLE google_sheet_links DROP CONSTRAINT google_sheet_links_direction_check;
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_sheet_links_direction_check') THEN
           ALTER TABLE google_sheet_links ADD CONSTRAINT google_sheet_links_direction_check
             CHECK (direction IN ('export', 'import', 'sync'));
         END IF;
       END $$`,
      `ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS sync_token_enc TEXT`,
      `ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS instant_ping_at TIMESTAMPTZ`,
      `ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS held_deletes TEXT[] NOT NULL DEFAULT '{}'`,
      `ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS sync_warning TEXT`,
      `ALTER TABLE google_sheet_links ADD COLUMN IF NOT EXISTS sync_stats JSONB`,
      `CREATE TABLE IF NOT EXISTS google_sheet_rows (
         link_id    UUID NOT NULL REFERENCES google_sheet_links(id) ON DELETE CASCADE,
         record_id  UUID NOT NULL,
         snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (link_id, record_id)
       )`,
    ]) {
      await prisma.$executeRawUnsafe(sql)
    }
  })
}
