/**
 * A Data Store table and a Google Sheet, kept in step.
 *
 *   export — every new record is appended as a row the moment it is
 *            saved (from any channel: AI, Flow, form, staff), and
 *            "Export all" rewrites the tab with every record.
 *   import — the sheet's rows come into the table, matched on the header
 *            row (field label or key, any case). Each row is fingerprinted,
 *            so reading the sheet again — by hand or every 15 minutes —
 *            brings in only rows that were not there before.
 *
 * Edits and deletions are not mirrored in either direction: a row is
 * copied once. That is said in the UI where the link is set up.
 */

import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { googleAccessToken, isGoogleServiceEnabled } from './oauth'
import { appendRows, readTab, writeTab, SHEET_MAX_ROWS } from './sheets'
import { ensureGoogleTables } from './store'
import { slugify } from '@/lib/data-store/slugify'
import { guessFieldType } from './sheet-browse'

/** Fields that hold no value of their own (layout) or no text (a drawn
 *  signature) — never a column. */
const NOT_A_COLUMN = new Set(['section_header', 'html_block', 'signature'])
/** Fields a sheet cannot fill. */
const NOT_IMPORTABLE = new Set(['section_header', 'html_block', 'hidden', 'signature', 'file', 'image'])

export const ADDED_ON_HEADER = 'Added on'
const MAX_IMPORTED_KEYS = 20_000
const EXPORT_ALL_LIMIT = 5_000

interface FieldLite {
  field_key: string
  label: string
  field_type: string
}

/** One cell's text for a stored value. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function exportHeader(fields: readonly FieldLite[]): string[] {
  return [...fields.filter((f) => !NOT_A_COLUMN.has(f.field_type)).map((f) => f.label), ADDED_ON_HEADER]
}

/** Date and time in the business's own zone (rule 10), not the server's. */
export function addedOnText(at: Date, timeZone: string): string {
  return at.toLocaleString('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function exportRow(fields: readonly FieldLite[], data: Record<string, unknown>, createdAt: Date, timeZone: string): string[] {
  return [
    ...fields.filter((f) => !NOT_A_COLUMN.has(f.field_type)).map((f) => cellText(data[f.field_key])),
    addedOnText(createdAt, timeZone),
  ]
}

/** Header cells → field keys, by label or key, ignoring case and spacing. */
export function mapHeaders(headers: readonly string[], fields: readonly FieldLite[]): Array<string | null> {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const byName = new Map<string, string>()
  for (const f of fields) {
    if (NOT_IMPORTABLE.has(f.field_type)) continue
    byName.set(norm(f.label), f.field_key)
    byName.set(norm(f.field_key), f.field_key)
  }
  return headers.map((h) => byName.get(norm(h)) ?? null)
}

/** The same row always gives the same key, whatever order its fields. */
export function rowKey(data: Record<string, unknown>): string {
  const sorted = Object.keys(data)
    .sort()
    .map((k) => [k, String(data[k]).trim()])
  return crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex').slice(0, 20)
}

/** Sheet rows → records' data, with the fingerprint of each. */
export function rowsToRecords(
  rows: readonly string[][],
  columnKeys: ReadonlyArray<string | null>,
): Array<{ key: string; data: Record<string, string> }> {
  const out: Array<{ key: string; data: Record<string, string> }> = []
  for (const row of rows) {
    const data: Record<string, string> = {}
    columnKeys.forEach((k, i) => {
      if (!k) return
      const v = (row[i] ?? '').trim()
      if (v) data[k] = v
    })
    if (Object.keys(data).length > 0) out.push({ key: rowKey(data), data })
  }
  return out
}

async function tableFields(tableId: string): Promise<FieldLite[]> {
  return prisma.dataField.findMany({
    where: { table_id: tableId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    select: { field_key: true, label: true, field_type: true },
  })
}

async function zoneFor(accountId: string): Promise<string> {
  const { businessTimezone } = await import('@/lib/ai/human-date')
  return businessTimezone(accountId)
}

async function recordProblem(linkId: string, problem: string | null): Promise<void> {
  await prisma.googleSheetLink
    .update({ where: { id: linkId }, data: { last_error: problem, ...(problem ? {} : { last_synced_at: new Date() }) } })
    .catch(() => {})
}

/** Called for every new record (record-events.ts). A table with no export
 *  link costs one indexed lookup. Failures are kept on the link, where the
 *  table's Google Sheet panel shows them — never thrown at the save. */
export async function exportNewRecord(record: {
  table_id: string
  account_id: string
  data: unknown
  created_at: Date
}): Promise<void> {
  await ensureGoogleTables()
  const link = await prisma.googleSheetLink.findUnique({
    where: { table_id_direction: { table_id: record.table_id, direction: 'export' } },
  })
  if (!link || link.account_id !== record.account_id) return
  // Sheets switched off in Settings → Google: the link stays, nothing is sent.
  if (!(await isGoogleServiceEnabled(record.account_id, 'sheets'))) return
  try {
    const [fields, zone, token] = await Promise.all([
      tableFields(record.table_id),
      zoneFor(record.account_id),
      googleAccessToken(record.account_id),
    ])
    const data =
      record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? (record.data as Record<string, unknown>) : {}
    await appendRows(token, link.spreadsheet_id, link.sheet_title, [exportRow(fields, data, record.created_at, zone)])
    await recordProblem(link.id, null)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[google-sheet] export of a new record failed:', message)
    await recordProblem(link.id, message)
  }
}

/** Rewrites the tab: header, then every record oldest first. */
export async function exportAll(linkId: string, accountId: string): Promise<{ rows: number; capped: boolean }> {
  const link = await prisma.googleSheetLink.findFirst({ where: { id: linkId, account_id: accountId, direction: 'export' } })
  if (!link) throw new Error('That sheet link no longer exists.')
  try {
    const [fields, zone, token, records] = await Promise.all([
      tableFields(link.table_id),
      zoneFor(accountId),
      googleAccessToken(accountId),
      prisma.dataRecord.findMany({
        where: { table_id: link.table_id, account_id: accountId },
        orderBy: { created_at: 'asc' },
        take: EXPORT_ALL_LIMIT + 1,
        select: { data: true, created_at: true },
      }),
    ])
    const capped = records.length > EXPORT_ALL_LIMIT
    const rows = (capped ? records.slice(0, EXPORT_ALL_LIMIT) : records).map((r) =>
      exportRow(fields, (r.data as Record<string, unknown>) ?? {}, r.created_at, zone),
    )
    await writeTab(token, link.spreadsheet_id, link.sheet_title, [exportHeader(fields), ...rows])
    await recordProblem(link.id, null)
    return { rows: rows.length, capped }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordProblem(link.id, message)
    throw new Error(message)
  }
}

/** Header only — written when an export link is first set up, so the
 *  appended rows land under the right column names. */
export async function writeExportHeader(linkId: string, accountId: string): Promise<void> {
  const link = await prisma.googleSheetLink.findFirst({ where: { id: linkId, account_id: accountId, direction: 'export' } })
  if (!link) return
  const [fields, token] = await Promise.all([tableFields(link.table_id), googleAccessToken(accountId)])
  const existing = await readTab(token, link.spreadsheet_id, link.sheet_title)
  // A tab that already has content keeps it: rows are appended below.
  if (existing.some((r) => r.some((c) => c.trim() !== ''))) return
  await writeTab(token, link.spreadsheet_id, link.sheet_title, [exportHeader(fields)])
}

const importing = new Set<string>()

export interface ImportResult {
  imported: number
  skipped: number
  unmatchedHeaders: string[]
  matchedColumns: number
}

/**
 * Brings the sheet's new rows into the table. A row seen before (same
 * fingerprint) is skipped, so this is safe to run as often as wanted.
 * One run per link at a time.
 */
export async function importFromSheet(linkId: string, accountId: string): Promise<ImportResult> {
  if (importing.has(linkId)) throw new Error('An import from this sheet is already running.')
  importing.add(linkId)
  try {
    const link = await prisma.googleSheetLink.findFirst({ where: { id: linkId, account_id: accountId, direction: 'import' } })
    if (!link) throw new Error('That sheet link no longer exists.')
    if (!(await isGoogleServiceEnabled(accountId, 'sheets')) && !(await isGoogleServiceEnabled(accountId, 'sheets_browse'))) {
      throw new Error('Google Sheets is switched off in Settings → Google.')
    }
    try {
      const [fields, token] = await Promise.all([tableFields(link.table_id), googleAccessToken(accountId)])
      const all = (await readTab(token, link.spreadsheet_id, link.sheet_title)).filter((r) => r.some((c) => c.trim() !== ''))
      if (all.length === 0) {
        await recordProblem(link.id, null)
        return { imported: 0, skipped: 0, unmatchedHeaders: [], matchedColumns: 0 }
      }
      const [headers, ...body] = all
      // The mapping chosen in the import screen when there is one; a column
      // added to the sheet since then is matched by name, or left out.
      const saved = columnMapOf(link.column_map)
      const byName = mapHeaders(headers, fields)
      const known = new Set(fields.map((f) => f.field_key))
      const columnKeys = saved
        ? headers.map((h, i) => {
            const k = saved[h.trim()]
            if (k === undefined) return byName[i]
            return k && known.has(k) ? k : null
          })
        : byName
      const matchedColumns = columnKeys.filter(Boolean).length
      const unmatchedHeaders = headers.filter((h, i) => h.trim() && !columnKeys[i] && h.trim() !== ADDED_ON_HEADER)
      if (matchedColumns === 0) {
        throw new Error(
          `None of the sheet's column names match this table's fields. Rename the header row to the field names (${fields
            .filter((f) => !NOT_IMPORTABLE.has(f.field_type))
            .slice(0, 6)
            .map((f) => f.label)
            .join(', ')}…).`,
        )
      }

      const seen = new Set(link.imported_keys)
      const fresh = rowsToRecords(body.slice(0, SHEET_MAX_ROWS), columnKeys).filter((r) => {
        if (seen.has(r.key)) return false
        seen.add(r.key) // the same row twice in the sheet comes in once
        return true
      })

      if (fresh.length > 0) {
        await prisma.dataRecord.createMany({
          data: fresh.map((r) => ({
            table_id: link.table_id,
            account_id: accountId,
            data: r.data as Prisma.InputJsonValue,
            source: 'google_sheet',
          })),
        })
        const { scheduleKnowledgeRefresh } = await import('@/lib/ai/knowledge-refresh')
        scheduleKnowledgeRefresh(accountId, link.table_id)
      }
      const keys = [...link.imported_keys, ...fresh.map((r) => r.key)].slice(-MAX_IMPORTED_KEYS)
      await prisma.googleSheetLink.update({
        where: { id: link.id },
        data: { imported_keys: keys, last_synced_at: new Date(), last_error: null },
      })
      return { imported: fresh.length, skipped: body.length - fresh.length, unmatchedHeaders, matchedColumns }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await recordProblem(link.id, message)
      throw new Error(message)
    }
  } finally {
    importing.delete(linkId)
  }
}

/** Every 15 minutes from server.ts: import links with "keep in sync" on. */
export async function sweepGoogleSheetImports(): Promise<void> {
  await ensureGoogleTables().catch(() => {})
  const links = await prisma.googleSheetLink
    .findMany({ where: { direction: 'import', auto_sync: true }, select: { id: true, account_id: true } })
    .catch(() => [])
  for (const l of links) {
    await importFromSheet(l.id, l.account_id).catch((err) =>
      console.error('[google-sheet] scheduled import failed:', err instanceof Error ? err.message : err),
    )
  }
}


// ── A sheet straight into a table ─────────────────────────────────────

/** One column of the import screen: into an existing field, a new one, or skipped. */
export interface ColumnChoice {
  header: string
  /** A field key, "new", or "skip". */
  target: string
  /** For "new": the field type and label. */
  type?: string
  label?: string
  options?: string[]
}

const NEW_FIELD_TYPES = new Set(['text', 'textarea', 'number', 'email', 'phone', 'date', 'url', 'select'])

export function columnMapOf(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return out
}

/**
 * What the import screen suggests for each column: the field with the
 * same name if there is one, otherwise a new field of the guessed type.
 */
export function suggestColumns(headers: readonly string[], sample: readonly string[][], fields: readonly FieldLite[]): ColumnChoice[] {
  const matched = mapHeaders(headers, fields)
  const taken = new Set<string>()
  return headers.map((header, i) => {
    const key = matched[i]
    if (key && !taken.has(key)) {
      taken.add(key)
      return { header, target: key }
    }
    const guess = guessFieldType(header, sample.map((r) => r[i] ?? ''))
    return { header, target: 'new', type: guess.type, label: header.slice(0, 80), options: guess.options }
  })
}

/**
 * Creates the new fields the import screen asked for and returns the
 * header → field key map the link keeps. Existing fields are only
 * accepted when they belong to this table.
 */
export async function applyColumnChoices(accountId: string, tableId: string, choices: readonly ColumnChoice[]): Promise<Record<string, string>> {
  const fields = await prisma.dataField.findMany({ where: { table_id: tableId }, select: { field_key: true, sort_order: true } })
  const keys = new Set(fields.map((f) => f.field_key))
  let order = fields.reduce((m, f) => Math.max(m, f.sort_order), -1) + 1
  const map: Record<string, string> = {}
  const toCreate: Prisma.DataFieldCreateManyInput[] = []
  for (const c of choices.slice(0, 200)) {
    const header = String(c.header ?? '').trim()
    if (!header || header in map) continue
    if (c.target === 'skip') {
      map[header] = ''
      continue
    }
    if (c.target !== 'new') {
      map[header] = keys.has(c.target) ? c.target : ''
      continue
    }
    const label = (c.label?.trim() || header).slice(0, 120)
    const base = (slugify(label).replace(/-/g, '_') || 'field').slice(0, 50)
    let key = base === 'table' ? 'field' : base
    for (let i = 2; keys.has(key); i++) key = `${base}_${i}`
    keys.add(key)
    const type = NEW_FIELD_TYPES.has(c.type ?? '') ? c.type! : 'text'
    const options = type === 'select' ? (c.options ?? []).filter((o) => typeof o === 'string' && o.trim()).slice(0, 50) : []
    toCreate.push({
      table_id: tableId,
      account_id: accountId,
      label,
      field_key: key,
      field_type: type,
      ...(options.length ? { options: { select_items: options.map((o) => ({ label: o, value: o })) } as Prisma.InputJsonValue } : {}),
      sort_order: order++,
    })
    map[header] = key
  }
  if (toCreate.length) await prisma.dataField.createMany({ data: toCreate, skipDuplicates: true })
  return map
}
