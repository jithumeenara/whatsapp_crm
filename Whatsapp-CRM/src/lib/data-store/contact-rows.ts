/**
 * Find rows in a Data Store table by your own conditions, and change them —
 * the chatbot's "Update table row" step.
 *
 * Everything is the bot builder's choice:
 *   - which rows: conditions on any columns (equals, same phone number,
 *     contains, empty, not empty) — all of them must hold, or any one of
 *     them — and/or "only rows saved for this chat" (contact_id);
 *   - which of them: the latest, the oldest or all (up to 20);
 *   - what to write: any columns, to text, a variable, today, now, yes,
 *     no or empty;
 *   - when nothing matches: the "Not found" path, or a new row.
 *
 * Phone numbers are compared on their last ten digits, so "+91 94950
 * 43668", "09495043668" and "9495043668" are one number — never on eight,
 * which two different people share far too often.
 *
 * A condition's value can come from what the customer typed. That lets a
 * bot find a row by a registration number, and it also means whoever
 * knows that number can change that row; the builder says so when a
 * condition uses a variable. Matching on the chatting number
 * ({{contact.phone}}) or "only rows saved for this chat" cannot be steered
 * by typing.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type WhichRow = 'latest' | 'oldest' | 'all'
export const MAX_ROWS = 20
export const MAX_CONDITIONS = 5

/** Field types a step may not write: secrets, files and layout. */
const NOT_WRITABLE = new Set(['password', 'file', 'image', 'signature', 'section_header', 'html_block', 'relation'])
/** Field types a condition may not read. */
const NOT_SEARCHABLE = new Set(['password', 'file', 'image', 'signature', 'section_header', 'html_block'])

export type SetMode = 'value' | 'today' | 'now' | 'yes' | 'no' | 'clear'
export interface ColumnSet {
  field_key: string
  mode: SetMode
  /** For mode 'value' — already interpolated by the caller. */
  value?: string
}

export type MatchOp = 'equals' | 'phone' | 'contains' | 'empty' | 'not_empty'
export const MATCH_OPS: readonly MatchOp[] = ['equals', 'phone', 'contains', 'empty', 'not_empty']
export interface RowCondition {
  field_key: string
  op: MatchOp
  /** Already interpolated by the caller. Unused for empty / not_empty. */
  value?: string
  /** Set by normaliseConditions: this one can match nothing (its value
   *  came out empty, or a phone with under 10 digits). */
  never?: boolean
}

/** All conditions must hold, or any one is enough. */
export type MatchMode = 'all' | 'any'

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

/**
 * The conditions as they will be searched, checked against the table's
 * fields. A condition whose value came out empty (a variable the customer
 * never filled in) or a phone value with fewer than ten digits matches
 * nothing rather than everything — 'nothing' is reported so the bot takes
 * its "Not found" path.
 */
export function normaliseConditions(
  fields: readonly FieldLite[],
  conditions: readonly RowCondition[],
  onlyThisChat: boolean,
  mode: MatchMode = 'all',
): { conditions: RowCondition[]; nothing: boolean } | { error: string } {
  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const out: RowCondition[] = []
  let nothing = false
  for (const c of conditions.slice(0, MAX_CONDITIONS)) {
    if (!c.field_key) continue
    const f = byKey.get(c.field_key)
    if (!f) return { error: `Column "${c.field_key}" is not in this table.` }
    if (NOT_SEARCHABLE.has(f.field_type)) return { error: `Column "${f.label}" can't be searched.` }
    if (!MATCH_OPS.includes(c.op)) return { error: `Unknown comparison "${c.op}".` }
    const value = (c.value ?? '').trim().slice(0, 500)
    const never = ((c.op === 'equals' || c.op === 'contains') && !value) || (c.op === 'phone' && !phoneKey(value))
    out.push({ field_key: c.field_key, op: c.op, value, ...(never ? { never: true } : {}) })
  }
  // "All": one condition that can match nothing means no row matches.
  // "Any": only when every condition can match nothing.
  nothing = out.length > 0 && (mode === 'all' ? out.some((c) => c.never) : out.every((c) => c.never))
  // With no condition and not limited to this chat, a step would change
  // rows of the whole table — refused.
  if (out.length === 0 && !onlyThisChat) return { error: 'Add a condition, or limit it to rows saved for this chat.' }
  return { conditions: out, nothing }
}

/**
 * "is" with a phone number on both sides compares the numbers, not the
 * text: a sheet's "9947840578" is the chatting number "+919947840578".
 * Choosing "is" instead of "is the same number as" was the easiest way to
 * make a step quietly find nothing. Returns the 10-digit key when the value
 * is plainly a phone number, else null (then "is" stays exact text).
 */
export function equalsAsPhone(value: string | undefined): string | null {
  const v = (value ?? '').trim()
  return /^[+0-9 ()-]+$/.test(v) ? phoneKey(v) : null
}

function likeEscape(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`)
}

function conditionSql(c: RowCondition): Prisma.Sql {
  if (c.never) return Prisma.sql`false`
  const cell = Prisma.sql`coalesce(data ->> ${c.field_key}, '')`
  switch (c.op) {
    case 'equals': {
      const exact = Prisma.sql`lower(btrim(${cell})) = lower(${c.value ?? ''})`
      const key = equalsAsPhone(c.value)
      if (!key) return exact
      return Prisma.sql`(${exact} OR (btrim(${cell}) ~ '^[+0-9 ()-]+$' AND right(regexp_replace(${cell}, '\\D', '', 'g'), 10) = ${key}))`
    }
    case 'contains':
      return Prisma.sql`${cell} ILIKE ${'%' + likeEscape(c.value ?? '') + '%'}`
    case 'phone':
      return Prisma.sql`right(regexp_replace(${cell}, '\\D', '', 'g'), 10) = ${phoneKey(c.value) ?? '-'}`
    case 'empty':
      return Prisma.sql`btrim(${cell}) = ''`
    case 'not_empty':
      return Prisma.sql`btrim(${cell}) <> ''`
  }
}

export interface FoundRow {
  id: string
  data: Record<string, unknown>
  created_at: Date
  /** Set when a chat (bot or AI) saved the row; null for imported rows. */
  contact_id: string | null
}

/**
 * Rows matching every condition (and, when asked, saved for this chat),
 * newest first, at most 200 looked at. Conditions must already be
 * normalised against the table; the table checked against the account.
 */
export async function findRows(args: {
  accountId: string
  tableId: string
  conditions: readonly RowCondition[]
  /** All conditions, or any one of them. */
  mode?: MatchMode
  /** Set to limit to rows saved for this contact (always, whatever the mode). */
  onlyContactId: string | null
}): Promise<FoundRow[]> {
  const parts: Prisma.Sql[] = []
  if (args.conditions.length > 0) {
    const conds = args.conditions.map(conditionSql)
    parts.push(Prisma.sql`(${Prisma.join(conds, args.mode === 'any' ? ' OR ' : ' AND ')})`)
  }
  if (args.onlyContactId) parts.push(Prisma.sql`contact_id = ${args.onlyContactId}::uuid`)
  if (parts.length === 0) return []
  const rows = await prisma.$queryRaw<Array<{ id: string; data: unknown; created_at: Date; contact_id: string | null }>>(Prisma.sql`
    SELECT id, data, created_at, contact_id
    FROM data_records
    WHERE table_id = ${args.tableId}::uuid
      AND account_id = ${args.accountId}::uuid
      AND ${Prisma.join(parts, ' AND ')}
    ORDER BY created_at DESC
    LIMIT 200
  `)
  return rows.map((r) => ({
    id: r.id,
    data: (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>,
    created_at: r.created_at,
    contact_id: r.contact_id ?? null,
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

/** A new row from what the conditions say plus the columns being set:
 *  "Registration ID = R-104" and "Status → Confirmed". */
export function rowForCreate(conditions: readonly RowCondition[], patch: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const c of conditions) {
    if ((c.op === 'equals' || c.op === 'phone') && c.value && !c.never) data[c.field_key] = c.value
  }
  return { ...data, ...patch }
}

/**
 * What to do when no row matched. With "Only rows saved for this chat" on,
 * rows that match the conditions but came from a sheet, Excel or by hand
 * (no chat saved them) are left out — say so, and never create a second
 * row for a person who already has one.
 */
export function notFoundOutcome(args: { onlyThisChat: boolean; matchedIgnoringChat: number; createIfMissing: boolean }): { create: boolean; reason: string | null } {
  if (args.onlyThisChat && args.matchedIgnoringChat > 0) {
    const n = args.matchedIgnoringChat
    return {
      create: false,
      reason: `${n} row${n === 1 ? '' : 's'} matched, but ${n === 1 ? 'it was' : 'they were'} not saved by this chat (imported or added by hand), and “Only rows saved for this chat” is on. Untick it to use ${n === 1 ? 'it' : 'them'}.`,
    }
  }
  return { create: args.createIfMissing, reason: null }
}

export interface UpdateRowsResult {
  /** Rows that matched, before picking. */
  found: number
  updated: Array<{ id: string; change: string }>
  /** A row was created because nothing matched. */
  created: string | null
  /** The (first) row after the change, for {{vars.row_<column>}}. */
  row: Record<string, unknown> | null
  error?: string
  /** Why nothing matched, when it can be said (notFoundOutcome). */
  reason?: string
}

/**
 * Finds the rows and writes the chosen columns — only those; the rest of
 * each row is left as it is. Writing the same value twice changes nothing,
 * so a customer pressing "Confirm" twice is harmless. Afterwards the same
 * things happen as for an edit by staff: the AI's knowledge refreshes, a
 * two-way Google Sheet follows, and the record.updated webhook fires.
 */
export async function updateRows(args: {
  accountId: string
  tableId: string
  conditions: readonly RowCondition[]
  /** All conditions must hold (default), or any one of them. */
  mode?: MatchMode
  /** Limit to rows saved for this chat (needs contactId). */
  onlyThisChat: boolean
  contactId: string | null
  which: WhichRow
  sets: readonly ColumnSet[]
  /** Nothing matched: make a new row instead. */
  createIfMissing: boolean
  timeZone: string
  now?: Date
}): Promise<UpdateRowsResult> {
  const none = { found: 0, updated: [], created: null, row: null }
  const table = await prisma.dataTable.findFirst({
    where: { id: args.tableId, account_id: args.accountId },
    select: { id: true, name: true, fields: { select: { field_key: true, label: true, field_type: true } } },
  })
  if (!table) return { ...none, error: 'Table not found in this account' }
  const conds = normaliseConditions(table.fields, args.conditions, args.onlyThisChat, args.mode ?? 'all')
  if ('error' in conds) return { ...none, error: conds.error }
  const built = buildPatch(table.fields, args.sets, args.now ?? new Date(), args.timeZone)
  if ('error' in built) return { ...none, error: built.error }

  // "Only rows saved for this chat" with no chat behind it matches nothing.
  const blocked = conds.nothing || (args.onlyThisChat && !args.contactId)
  const rows = blocked
    ? []
    : await findRows({
        accountId: args.accountId,
        tableId: table.id,
        conditions: conds.conditions,
        mode: args.mode ?? 'all',
        onlyContactId: args.onlyThisChat ? args.contactId : null,
      })

  const [{ scheduleKnowledgeRefresh }, events, { dispatchWebhooks }] = await Promise.all([
    import('@/lib/ai/knowledge-refresh'),
    import('./record-events'),
    import('@/lib/webhooks/deliver'),
  ])

  if (rows.length === 0) {
    if (conds.nothing) return none
    // Rows that match but were not saved by this chat — counted only to
    // explain, and so a "create" never duplicates a person.
    const matchedIgnoringChat = args.onlyThisChat && conds.conditions.length > 0
      ? (await findRows({ accountId: args.accountId, tableId: table.id, conditions: conds.conditions, mode: args.mode ?? 'all', onlyContactId: null })).length
      : 0
    const outcome = notFoundOutcome({ onlyThisChat: args.onlyThisChat, matchedIgnoringChat, createIfMissing: args.createIfMissing })
    if (!outcome.create) return outcome.reason ? { ...none, reason: outcome.reason } : none
    const data = rowForCreate(conds.conditions, built.patch)
    const created = await prisma.dataRecord.create({
      data: {
        table_id: table.id,
        account_id: args.accountId,
        contact_id: args.contactId,
        data: data as Prisma.InputJsonValue,
        source: 'chatbot',
      },
    })
    events.afterRecordCreated({ ...created, source: 'chatbot' })
    return { found: 0, updated: [], created: created.id, row: data }
  }

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
    scheduleKnowledgeRefresh(args.accountId, table.id)
    events.afterRecordsChanged(table.id, args.accountId)
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
  return { found: rows.length, updated, created: null, row: first }
}

/**
 * The step's saved config, read the same way by the engine and the
 * builder's test: conditions, or the first version's single phone column
 * (match_field) as "column = chatting number".
 */
export function conditionsFromConfig(cfg: {
  conditions?: Array<{ field_key?: string; op?: string; value?: string }>
  match_field?: string
}): Array<{ field_key: string; op: MatchOp; value: string }> {
  if (Array.isArray(cfg.conditions) && cfg.conditions.length > 0) {
    return cfg.conditions
      .filter((c) => c && c.field_key)
      .map((c) => ({
        field_key: String(c.field_key),
        op: (MATCH_OPS as readonly string[]).includes(c.op ?? '') ? (c.op as MatchOp) : 'equals',
        value: typeof c.value === 'string' ? c.value : '',
      }))
  }
  if (cfg.match_field) return [{ field_key: cfg.match_field, op: 'phone', value: '{{contact.phone}}' }]
  return []
}
