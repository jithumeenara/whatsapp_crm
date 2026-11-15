/**
 * Reading a photo registration's draft — the light half of
 * registration-draft.ts, so the assistant can ask "is a registration under
 * way here?" on every customer message without loading what sending,
 * saving and alerting need (the AI SDK, Data Store record events, every
 * alert channel: 4.5 seconds on a cold start, measured).
 *
 * registration-draft.ts uses this for its own storage and re-exports
 * activeDraftWaitingFor, so callers did not change.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'
import { decrypt } from '@/lib/whatsapp/encryption'
import { listRegistrationForms } from './registration'
import { allFields, nextMissing, type Lang, type Step } from './registration-draft-core'

export function ensureTable(): Promise<void> {
  return onceSchemaPatch('registration_drafts', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS registration_drafts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        table_id uuid NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
        values_enc text NOT NULL,
        step text NOT NULL,
        field_key text,
        month text,
        page integer NOT NULL DEFAULT 0,
        lang text NOT NULL DEFAULT 'en',
        edits integer NOT NULL DEFAULT 0,
        source_message_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      )`)
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_registration_drafts_conversation ON registration_drafts (conversation_id)',
    )
  })
}

export interface Draft {
  id: string
  accountId: string
  conversationId: string
  contactId: string
  tableId: string
  values: Record<string, string>
  step: Step
  fieldKey: string | null
  month: string | null
  page: number
  lang: Lang
  edits: number
}

interface DraftRow {
  id: string
  account_id: string
  conversation_id: string
  contact_id: string
  table_id: string
  values_enc: string
  step: string
  field_key: string | null
  month: string | null
  page: number
  lang: string
  edits: number
}

export async function loadDraft(accountId: string, conversationId: string): Promise<Draft | null> {
  await ensureTable()
  const rows = await prisma.$queryRaw<DraftRow[]>(Prisma.sql`
    SELECT id, account_id, conversation_id, contact_id, table_id, values_enc, step, field_key, month, page, lang, edits
    FROM registration_drafts
    WHERE conversation_id = ${conversationId}::uuid AND account_id = ${accountId}::uuid AND expires_at > now()`)
  const r = rows[0]
  if (!r) return null
  let values: Record<string, string> = {}
  try {
    values = JSON.parse(decrypt(r.values_enc)) as Record<string, string>
  } catch {
    return null
  }
  return {
    id: r.id,
    accountId: r.account_id,
    conversationId: r.conversation_id,
    contactId: r.contact_id,
    tableId: r.table_id,
    values,
    step: r.step as Step,
    fieldKey: r.field_key,
    month: r.month,
    page: r.page,
    lang: r.lang === 'ml' ? 'ml' : 'en',
    edits: r.edits,
  }
}

/** True while a photo registration is under way in this conversation —
 *  the assistant is told, so it answers questions without starting a
 *  registration of its own on top. */
export async function activeDraftWaitingFor(accountId: string, conversationId: string): Promise<string | null> {
  try {
    const d = await loadDraft(accountId, conversationId)
    if (!d) return null
    const form = (await listRegistrationForms(accountId)).find((f) => f.table_id === d.tableId)
    if (!form) return null
    if (d.step === 'confirm') return 'their Yes / No on the summary of their details'
    const field = allFields(form).find((f) => f.key === d.fieldKey) ?? nextMissing(form, d.values)
    return field ? `their ${field.label}` : 'their answer'
  } catch {
    return null
  }
}
