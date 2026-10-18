/**
 * "This customer's row" in a Data Store table — found, and changed, for the
 * chatbot's "Update table row" step.
 *
 * A row is the customer's when the bot or the assistant saved it for them
 * (contact_id), or when its phone column holds their number. Rows that came
 * from Excel or a Google Sheet have only the phone column, so both count.
 *
 * Numbers are compared on their last ten digits after dropping everything
 * else: "+91 94950 43668", "09495043668" and "9495043668" are one number.
 * Not eight — two different people's numbers share the last eight digits
 * far too often. A number shorter than ten digits matches nothing.
 *
 * The number always comes from the conversation (WhatsApp tells us who is
 * writing), never from what the customer types, so nobody can change
 * somebody else's row.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type WhichRow = 'latest' | 'oldest' | 'all'
export const MAX_ROWS = 20

/** Field types a step may not write: secrets, files and layout. */
const NOT_WRITABLE = new Set(['password', 'file', 'image', 'signature', 'section_header', 'html_block', 'relation'])

export type SetMode = 'value' | 'today' | 'now' | 'yes' | 'no' | 'clear'
export interface ColumnSet {
  field_key: string
  mode: SetMode
  /** For mode 'value' — already interpolated by the caller. */
  value?: string
}

export interface FieldLite {
  field_key: string
  label: string
  field_type: string
}

/** Last ten digits, or null when there are fewer than ten. */
export function phoneKey(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const digits = String(v).replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

export function samePhone(a: unknown, b: unknown): boolean {
  const ka = phoneKey(a)
  return ka !== null && ka === phoneKey(b)
}

/** From rows newest first, the ones the step changes. */
export function pickRows<T>(newestFirst: readonly T[], which: WhichRow): T[] {
  if (newestFirst.length === 0) return []
  if (which === 'oldest') return [newestFirst[newestFirst.length - 1]]
  if (which === 'all') return newestFirst.slice(0, MAX_ROWS)
  return [newestFirst[0]]
}

/** "2026-10-18" and "2026-10-18T14:30" in the business's own zone. */
function zonedParts(now: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, dateTime: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` }
}

/**
 * The columns to write, checked against the table's own fields. Unknown
 * columns and ones that may not be written are refused, never guessed.
 */
export function buildPatch(
  fields: readonly FieldLite[],
  sets: readonly ColumnSet[],
  now: Date,
  timeZone: string,
): { patch: Record<string, unknown> } | { error: string } {
  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const patch: Record<string, unknown> = {}
  const { date, dateTime } = zonedParts(now, timeZone)
  for (const s of sets) {
    const f = byKey.get(s.field_key)
    if (!f) return { error: `Column "${s.field_key}" is not in this table.` }
    if (NOT_WRITABLE.has(f.field_type)) return { error: `Column "${f.label}" can't be changed by a chatbot.` }
    switch (s.mode) {
      case 'today': patch[f.field_key] = date; break
      case 'now': patch[f.field_key] = f.field_type === 'date' ? date : dateTime; break
      case 'yes': patch[f.field_key] = true; break
      case 'no': patch[f.field_key] = false; break
      case 'clear': patch[f.field_key] = null; break
      default: {
        const v = (s.value ?? '').slice(0, 5000)
        patch[f.field_key] = f.field_type === 'number' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v
      }
    }
  }
  if (Object.keys(patch).length === 0) return { error: 'Choose at least one column to change.' }
  return { patch }
}

export interface FoundRow {
  id: string
  data: Record<string, unknown>
  created_at: Date
}

/**
 * This customer's rows in a table, newest first (at most 200 looked at).
 * `matchField` is the phone column; empty means "rows saved for this
 * contact" only. The table must already be checked against the account.
 */
export async function findContactRows(args: {
  accountId: string
  tableId: string
  contactId: string | null
  contactPhone: string | null
  matchField: string | null
}): Promise<FoundRow[]> {
  const key = phoneKey(args.contactPhone)
  const byContact = args.contactId ? Prisma.sql`contact_id = ${args.contactId}::uuid` : Prisma.sql`false`
  const byPhone =
    args.matchField && key
      ? Prisma.sql`right(regexp_replace(coalesce(data ->> ${args.matchField}, ''), '\\D', '', 'g'), 10) = ${key}`
      : Prisma.sql`false`
  const rows = await prisma.$queryRaw<Array<{ id: string; data: unknown; created_at: Date }>>(Prisma.sql`
    SELECT id, data, created_at
    FROM data_records
    WHERE table_id = ${args.tableId}::uuid
      AND account_id = ${args.accountId}::uuid
      AND (${byContact} OR ${byPhone})
    ORDER BY created_at DESC
    LIMIT 200
  `)
  // A cell with fewer than ten digits never matches: right(…, 10) of it is
  // shorter than the ten-digit key. The SQL above is the whole rule.
  return rows.map((r) => ({
    id: r.id,
    data: (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>,
    created_at: r.created_at,
  }))
}

/** What changed on one row, for the run log: "Status: Pending → Confirmed". */
export function describeChange(before: Record<string, unknown>, patch: Record<string, unknown>, fields: readonly FieldLite[]): string {
  const label = new Map(fields.map((f) => [f.field_key, f.label]))
  return Object.entries(patch)
    .map(([k, v]) => `${label.get(k) ?? k}: ${fmt(before[k])} → ${fmt(v)}`)
    .join(', ')
}
function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)'
  return String(v)
}

export interface UpdateRowsResult {
  /** Rows found for this customer before picking. */
  found: number
  updated: Array<{ id: string; change: string }>
  /** The (first) changed row after the change, for {{vars.row_<column>}}. */
  row: Record<string, unknown> | null
  error?: string
}

/**
 * Finds this customer's row(s) and writes the chosen columns — only those;
 * the rest of the row is left as it is. Writing the same value twice
 * changes nothing, so a customer pressing "Confirm" twice is harmless.
 * Afterwards the same things happen as for an edit by staff: the AI's
 * knowledge refreshes, a two-way Google Sheet follows, and the
 * record.updated webhook fires.
 */
export async function updateContactRows(args: {
  accountId: string
  tableId: string
  contactId: string | null
  contactPhone: string | null
  matchField: string | null
  which: WhichRow
  sets: readonly ColumnSet[]
  timeZone: string
  now?: Date
}): Promise<UpdateRowsResult> {
  const table = await prisma.dataTable.findFirst({
    where: { id: args.tableId, account_id: args.accountId },
    select: { id: true, name: true, fields: { select: { field_key: true, label: true, field_type: true } } },
  })
  if (!table) return { found: 0, updated: [], row: null, error: 'Table not found in this account' }
  if (args.matchField && !table.fields.some((f) => f.field_key === args.matchField)) {
    return { found: 0, updated: [], row: null, error: `Column "${args.matchField}" is not in this table` }
  }
  const built = buildPatch(table.fields, args.sets, args.now ?? new Date(), args.timeZone)
  if ('error' in built) return { found: 0, updated: [], row: null, error: built.error }

  const rows = await findContactRows({
    accountId: args.accountId,
    tableId: table.id,
    contactId: args.contactId,
    contactPhone: args.contactPhone,
    matchField: args.matchField,
  })
  const chosen = pickRows(rows, args.which)
  const updated: UpdateRowsResult['updated'] = []
  let first: Record<string, unknown> | null = null

  for (const r of chosen) {
    const next = { ...r.data, ...built.patch }
    first ??= next
    const changed = Object.keys(built.patch).some((k) => JSON.stringify(r.data[k]) !== JSON.stringify(built.patch[k]))
    if (!changed) continue
    // Conditional on the row still being in this table and account.
    const res = await prisma.dataRecord.updateMany({
      where: { id: r.id, table_id: table.id, account_id: args.accountId },
      data: { data: next as Prisma.InputJsonValue },
    })
    if (res.count === 0) continue
    updated.push({ id: r.id, change: describeChange(r.data, built.patch, table.fields) })
  }

  if (updated.length > 0) {
    const [{ scheduleKnowledgeRefresh }, { afterRecordsChanged }, { dispatchWebhooks }] = await Promise.all([
      import('@/lib/ai/knowledge-refresh'),
      import('./record-events'),
      import('@/lib/webhooks/deliver'),
    ])
    scheduleKnowledgeRefresh(args.accountId, table.id)
    afterRecordsChanged(table.id, args.accountId)
    const at = (args.now ?? new Date()).toISOString()
    for (const u of updated) {
      const r = chosen.find((c) => c.id === u.id)
      dispatchWebhooks(args.accountId, 'record.updated', table.id, {
        id: u.id,
        data: { ...(r?.data ?? {}), ...built.patch },
        created_at: r?.created_at.toISOString() ?? at,
        updated_at: at,
      }, table.name)
    }
  }
  return { found: rows.length, updated, row: first }
}
