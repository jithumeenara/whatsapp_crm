/**
 * A Google Sheet column's dropdown list ("Data validation → Dropdown"),
 * so a column like District comes into the Data Store as a dropdown with
 * all its choices — not as text, and not with only the few values the
 * first rows happen to use.
 *
 * Google keeps a dropdown in two ways:
 *   ONE_OF_LIST   the choices typed into the rule itself
 *   ONE_OF_RANGE  "=Lists!A1:A14" — the choices are the cells of a range
 *
 * Over plain fetch like the rest of this folder (no googleapis package).
 */

import { tabRange } from './sheets'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'
const MAX_OPTIONS = 200
/** Rows looked at for a rule (after the header). A column's rule is
 *  normally on every row; a few is enough to find it. */
const ROWS_LOOKED_AT = 15

interface Validation {
  condition?: { type?: string; values?: Array<{ userEnteredValue?: string }> }
}
export interface GridData {
  sheets?: Array<{ data?: Array<{ startColumn?: number; rowData?: Array<{ values?: Array<{ dataValidation?: Validation }> }> }> }>
}

/** Per column index: a fixed list, or a range to read. First rule found wins. */
export function rulesFromGrid(grid: GridData): Map<number, { list: string[] } | { range: string }> {
  const out = new Map<number, { list: string[] } | { range: string }>()
  for (const block of grid.sheets?.[0]?.data ?? []) {
    const first = block.startColumn ?? 0
    for (const row of block.rowData ?? []) {
      row.values?.forEach((cell, i) => {
        const col = first + i
        if (out.has(col)) return
        const c = cell.dataValidation?.condition
        if (!c) return
        const vals = (c.values ?? []).map((v) => String(v.userEnteredValue ?? '').trim()).filter(Boolean)
        if (c.type === 'ONE_OF_LIST' && vals.length) out.set(col, { list: cleanOptions(vals) })
        else if (c.type === 'ONE_OF_RANGE' && vals[0]) {
          const range = rangeFromFormula(vals[0])
          if (range) out.set(col, { range })
        }
      })
    }
  }
  return out
}

/** "='Lists'!$A$1:$A$14" → "'Lists'!A1:A14". */
export function rangeFromFormula(formula: string): string | null {
  const r = formula.trim().replace(/^=/, '').replace(/\$/g, '')
  return r && r.length <= 200 ? r : null
}

/** Trimmed, non-empty, each once, at most 200. */
export function cleanOptions(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s.slice(0, 100))
    if (out.length >= MAX_OPTIONS) break
  }
  return out
}

async function getJson<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Google Sheets returned ${res.status}`)
  return (await res.json()) as T
}

/**
 * Each column's dropdown choices for a tab, by column index (0 = A).
 * Never throws: a sheet without dropdowns, or one Google won't describe,
 * gives an empty map and the import goes on as before.
 */
export async function readDropdowns(token: string, spreadsheetId: string, title: string): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>()
  try {
    const range = `${tabRange(title)}!A1:ZZ${ROWS_LOOKED_AT + 1}`
    const grid = await getJson<GridData>(
      token,
      `${API}/${encodeURIComponent(spreadsheetId)}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent('sheets.data(startColumn,rowData.values.dataValidation)')}`,
    )
    for (const [col, rule] of rulesFromGrid(grid)) {
      if ('list' in rule) {
        if (rule.list.length) result.set(col, rule.list)
        continue
      }
      try {
        const v = await getJson<{ values?: unknown[][] }>(
          token,
          `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rule.range)}?valueRenderOption=FORMATTED_VALUE`,
        )
        const list = cleanOptions((v.values ?? []).flat())
        if (list.length) result.set(col, list)
      } catch (err) {
        console.warn('[google-sheet] dropdown range unreadable:', rule.range, err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    console.warn('[google-sheet] dropdowns unreadable:', err instanceof Error ? err.message : err)
  }
  return result
}

export interface DropdownFieldLite {
  field_key: string
  field_type: string
  options?: unknown
}

export interface DropdownUpdate {
  field_key: string
  field_type: string
  options: string[]
}

const CHOICE_TYPES = new Set(['select', 'multiselect', 'radio'])

export function optionsOf(options: unknown): string[] {
  const items = Array.isArray(options) ? options : (options as { select_items?: unknown[] } | null)?.select_items ?? []
  return cleanOptions((items as Array<{ value?: unknown; label?: unknown } | string>).map((i) => (typeof i === 'string' ? i : i?.value ?? i?.label)))
}

/**
 * What to change on the table's fields so its dropdowns match the sheet:
 *  - a column with a dropdown in the sheet becomes a dropdown (a text
 *    field is turned into one) holding the sheet's choices, plus any
 *    the field already had;
 *  - a dropdown field with no choices at all, whose column has no rule,
 *    gets the distinct values the column already holds (up to 50).
 * Fields already right are left out.
 */
export function planDropdownUpdates(args: {
  fields: readonly DropdownFieldLite[]
  /** Field key per sheet column index ('' / null = not imported). */
  columnKeys: ReadonlyArray<string | null | undefined>
  dropdowns: ReadonlyMap<number, string[]>
  rows: readonly string[][]
}): DropdownUpdate[] {
  const byKey = new Map(args.fields.map((f) => [f.field_key, f]))
  const updates: DropdownUpdate[] = []
  args.columnKeys.forEach((key, col) => {
    if (!key) return
    const f = byKey.get(key)
    if (!f) return
    const current = optionsOf(f.options)
    const sheetList = args.dropdowns.get(col)
    if (sheetList && sheetList.length) {
      if (!CHOICE_TYPES.has(f.field_type) && f.field_type !== 'text') return
      const merged = cleanOptions([...sheetList, ...current])
      const type = CHOICE_TYPES.has(f.field_type) ? f.field_type : 'select'
      if (type === f.field_type && merged.length === current.length && merged.every((o, i) => o === current[i])) return
      updates.push({ field_key: key, field_type: type, options: merged })
      return
    }
    if (CHOICE_TYPES.has(f.field_type) && current.length === 0) {
      const distinct = cleanOptions(args.rows.map((r) => r[col] ?? ''))
      if (distinct.length > 0 && distinct.length <= 50) updates.push({ field_key: key, field_type: f.field_type, options: distinct })
    }
  })
  return updates
}

// ── Applying it ──────────────────────────────────────────────────────────

const lastChecked = new Map<string, number>()
const RECHECK_MS = 10 * 60_000

/**
 * Reads the sheet's dropdowns and updates the table's fields to match
 * (planDropdownUpdates). Two-way sync runs often; the sheet's rules are
 * read at most every ten minutes per table unless `force`. Never throws.
 */
export async function syncDropdownFields(args: {
  accountId: string
  tableId: string
  token: string
  spreadsheetId: string
  sheetTitle: string
  columnKeys: ReadonlyArray<string | null | undefined>
  rows: readonly string[][]
  force?: boolean
}): Promise<number> {
  try {
    const now = Date.now()
    if (!args.force && now - (lastChecked.get(args.tableId) ?? 0) < RECHECK_MS) return 0
    lastChecked.set(args.tableId, now)
    const { prisma } = await import('@/lib/db')
    const [fields, dropdowns] = await Promise.all([
      prisma.dataField.findMany({ where: { table_id: args.tableId, account_id: args.accountId }, select: { field_key: true, field_type: true, options: true } }),
      readDropdowns(args.token, args.spreadsheetId, args.sheetTitle),
    ])
    const updates = planDropdownUpdates({ fields, columnKeys: args.columnKeys, dropdowns, rows: args.rows })
    for (const u of updates) {
      const field = fields.find((f) => f.field_key === u.field_key)
      const rest = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? (field.options as Record<string, unknown>) : {}
      await prisma.dataField.updateMany({
        where: { table_id: args.tableId, account_id: args.accountId, field_key: u.field_key },
        data: {
          field_type: u.field_type,
          // Other settings on the field (default value, live source, …) kept.
          options: { ...rest, select_items: u.options.map((o) => ({ label: o, value: o })) },
        },
      })
    }
    if (updates.length) console.log(`[google-sheet] dropdowns updated on ${updates.length} field(s) of table ${args.tableId}`)
    return updates.length
  } catch (err) {
    console.warn('[google-sheet] dropdown update failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
