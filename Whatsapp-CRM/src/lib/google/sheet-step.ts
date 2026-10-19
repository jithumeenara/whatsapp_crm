/**
 * The chatbot's "Google Sheet" step: add a row, update rows, delete rows
 * — straight to the sheet, no Data Store table in between.
 *
 * `runSheetStep` takes the sheet as a small interface (`SheetsApi`) so it
 * is tested against an in-memory sheet; `googleSheetsApi` is the real one,
 * with Google's "busy" answers retried twice before giving up.
 *
 * Safety, in order:
 *  - the whole read → decide → write runs under a per-tab lock;
 *  - rows found are checked again just before writing (relocate) — a row
 *    that moved is followed, one that changed is left alone;
 *  - at most 20 rows per run; "delete" archives to a "Deleted" tab by
 *    default, with when and from which tab, so it can be put back;
 *  - an empty value never matches every row, and an unset variable never
 *    wipes a filled cell ({{clear}} does that, on purpose).
 */

import {
  ARCHIVE_TAB, SHEET_STEP_MAX_ROWS, alignToHeaders, buildRow, checkConditions, findColumn, matchRows, olderThan,
  pickSheetRows, relocate, rowObject, rowVars, type ColumnMapping, type SheetCondition, type SheetMatchMode,
  type SheetRow, type SheetWhich,
} from './sheet-rows'
import {
  appendRows, deleteRows, ensureTab, getSpreadsheet, isTransientSheetsError, readTab, writeCells, writeHeaderRow,
} from './sheets'
import { sheetLockKey, withSheetLock } from './sheet-lock'

export type SheetAction = 'add' | 'update' | 'delete'
export type AddMode = 'always' | 'if_missing' | 'upsert'

export interface SheetStepConfig {
  spreadsheet_id?: string
  spreadsheet_name?: string
  sheet_title?: string
  action?: string
  mapping?: ColumnMapping[]
  add_mode?: string
  conditions?: Array<Partial<SheetCondition>>
  match?: string
  which?: string
  date_column?: string
  older_than_days?: number | string
  delete_mode?: string
  next_node_key?: string
  not_found_node_key?: string
}

export interface SheetsApi {
  tabs(): Promise<Array<{ sheetId: number; title: string }>>
  read(tab: string): Promise<string[][]>
  append(tab: string, rows: string[][]): Promise<void>
  writeCells(tab: string, cells: Array<{ row: number; col: number; value: string }>): Promise<void>
  writeHeader(tab: string, headers: string[]): Promise<void>
  deleteRows(sheetId: number, rows: number[]): Promise<void>
  ensureTab(tab: string, headers: string[]): Promise<{ sheetId: number }>
}

export type SheetOutcome = 'added' | 'updated' | 'unchanged' | 'deleted' | 'exists' | 'not_found'

export interface SheetStepResult {
  outcome: SheetOutcome
  /** Rows that met the conditions (before "which" and the 20 cap). */
  found: number
  /** What was (or, in a test, would be) added, changed or removed. */
  rows: Array<{ row: number; before?: Record<string, string>; after?: Record<string, string> }>
  vars: Record<string, string>
  warnings: string[]
  /** Why nothing was done, in words. */
  reason?: string
  tab: string
}

export interface StepOptions {
  /** A test: find and describe, write nothing. */
  dryRun?: boolean
  /** The business's wall-clock now, read as UTC (see parseSheetDate). */
  nowWall: number
  /** "2026-10-19 08:05" in the business's zone, for the archive. */
  nowLabel: string
}

export function normaliseStepConfig(cfg: SheetStepConfig) {
  const action: SheetAction = cfg.action === 'update' || cfg.action === 'delete' ? cfg.action : 'add'
  const addMode: AddMode = cfg.add_mode === 'if_missing' || cfg.add_mode === 'upsert' ? cfg.add_mode : 'always'
  const which: SheetWhich = cfg.which === 'oldest' || cfg.which === 'all' ? cfg.which : 'latest'
  const match: SheetMatchMode = cfg.match === 'any' ? 'any' : 'all'
  const days = Math.max(0, Math.min(3650, Math.floor(Number(cfg.older_than_days) || 0)))
  const deleteMode = cfg.delete_mode === 'delete' ? 'delete' : 'archive'
  const mapping = (Array.isArray(cfg.mapping) ? cfg.mapping : [])
    .filter((m) => m && typeof m.column === 'string' && m.column.trim())
    .slice(0, 100)
    .map((m) => ({ column: String(m.column), value: String(m.value ?? '') }))
  const conditions = (Array.isArray(cfg.conditions) ? cfg.conditions : [])
    .filter((c) => c && typeof c.column === 'string' && c.column.trim())
    .map((c) => ({ column: String(c.column), op: (c.op ?? 'equals') as SheetCondition['op'], value: String(c.value ?? '') }))
  return { action, addMode, which, match, days, deleteMode, mapping, conditions, dateColumn: (cfg.date_column ?? '').trim() }
}

function isBlank(values: readonly string[]): boolean {
  return values.every((v) => !String(v ?? '').trim())
}

export async function runSheetStep(
  api: SheetsApi,
  cfg: SheetStepConfig,
  resolve: (template: string) => string,
  opts: StepOptions,
): Promise<SheetStepResult> {
  const n = normaliseStepConfig(cfg)
  const tabs = await api.tabs()
  const wanted = (cfg.sheet_title ?? '').trim()
  const tabInfo = wanted ? tabs.find((t) => t.title.toLowerCase() === wanted.toLowerCase()) : tabs[0]
  if (!tabInfo) throw new Error(wanted ? `The sheet has no tab called “${wanted.slice(0, 60)}” any more. Open the step and choose the tab again.` : 'The spreadsheet has no tabs.')
  const tab = tabInfo.title
  const warnings: string[] = []
  const done = (r: Omit<SheetStepResult, 'warnings' | 'tab'>): SheetStepResult => ({
    ...r,
    vars: { ...r.vars, sheet_status: r.outcome, sheet_found: String(r.found) },
    warnings,
    tab,
  })

  let table = await api.read(tab)
  let headers = (table[0] ?? []).map((h) => String(h ?? ''))

  // A brand-new, empty sheet: its header row comes from the step.
  if (isBlank(headers)) {
    if (n.action !== 'add') return done({ outcome: 'not_found', found: 0, rows: [], vars: {}, reason: 'The sheet is empty.' })
    headers = [...new Set(n.mapping.map((m) => m.column.trim()))]
    if (headers.length === 0) throw new Error('Map at least one column.')
    if (!opts.dryRun) await api.writeHeader(tab, headers)
    table = [headers]
  }

  const dateIndex = n.dateColumn ? findColumn(headers, n.dateColumn) : -1
  if (n.dateColumn && dateIndex < 0) warnings.push(`Date column “${n.dateColumn}” is not in the sheet — newest was decided by position.`)

  let matches: SheetRow[] = []
  const needFind = n.action !== 'add' || n.addMode !== 'always'
  if (needFind) {
    const checked = checkConditions(headers, n.conditions.map((c) => ({ ...c, value: resolve(c.value) })))
    if ('error' in checked) throw new Error(checked.error)
    matches = checked.nothing ? [] : matchRows(table, checked.conditions, n.match)
  }
  const found = matches.length

  if (n.action === 'add' && !(n.addMode === 'upsert' && found > 0)) {
    if (n.addMode === 'if_missing' && found > 0) {
      const newest = pickSheetRows(matches, 'latest', dateIndex)[0]
      return done({
        outcome: 'exists', found, vars: rowVars(headers, newest),
        rows: [{ row: newest.row, before: rowObject(headers, newest.values) }],
        reason: 'Already in the sheet — not added again.',
      })
    }
    const built = buildRow(headers, n.mapping, resolve)
    for (const m of built.missing) warnings.push(`Column “${m}” is not in the sheet any more — skipped.`)
    if (isBlank(built.values)) throw new Error('Nothing to write: every mapped value came out empty.')
    let rowNumber = table.length + 1
    if (!opts.dryRun) {
      await api.append(tab, [built.values])
      rowNumber = table.length + 1
    }
    return done({
      outcome: 'added', found, vars: rowVars(headers, { row: rowNumber, values: built.values }),
      rows: [{ row: rowNumber, after: rowObject(headers, built.values) }],
    })
  }

  if (n.action === 'update' || n.action === 'add') {
    // 'add' here is "add, or update the row that is already there".
    const chosen = pickSheetRows(matches, n.action === 'add' ? 'latest' : n.which, dateIndex)
    if (chosen.length === 0) return done({ outcome: 'not_found', found, rows: [], vars: {}, reason: 'No row matched.' })
    const built = buildRow(headers, n.mapping, resolve)
    for (const m of built.missing) warnings.push(`Column “${m}” is not in the sheet any more — skipped.`)
    if (built.cells.size === 0) throw new Error('Nothing to write: every mapped value came out empty.')
    const apply = (values: readonly string[]) => {
      const next = headers.map((_, i) => String(values[i] ?? ''))
      for (const [col, v] of built.cells) next[col] = v
      return next
    }
    let rows = chosen
    if (!opts.dryRun) {
      const re = relocate(chosen, await api.read(tab))
      if (re.lost) warnings.push(`${re.lost} row${re.lost === 1 ? '' : 's'} changed in the sheet while this ran — left alone.`)
      rows = re.rows
      if (rows.length === 0) return done({ outcome: 'not_found', found, rows: [], vars: {}, reason: 'The row changed in the sheet while this ran — left alone.' })
      const cells: Array<{ row: number; col: number; value: string }> = []
      for (const r of rows) for (const [col, v] of built.cells) if (String(r.values[col] ?? '') !== v) cells.push({ row: r.row, col, value: v })
      if (cells.length) await api.writeCells(tab, cells)
      if (cells.length === 0) {
        return done({ outcome: 'unchanged', found, vars: rowVars(headers, rows[0]), rows: rows.map((r) => ({ row: r.row, before: rowObject(headers, r.values) })), reason: 'Already had these values.' })
      }
    }
    return done({
      outcome: 'updated', found,
      vars: rowVars(headers, { row: rows[0].row, values: apply(rows[0].values) }),
      rows: rows.map((r) => ({ row: r.row, before: rowObject(headers, r.values), after: rowObject(headers, apply(r.values)) })),
    })
  }

  // delete
  let pool = matches
  if (n.days > 0) {
    if (dateIndex < 0) throw new Error('“Older than” needs the date column — choose it in the step.')
    pool = olderThan(pool, dateIndex, n.days, opts.nowWall)
  }
  const chosen = pickSheetRows(pool, n.which, dateIndex).slice(0, SHEET_STEP_MAX_ROWS)
  if (chosen.length === 0) {
    return done({ outcome: 'not_found', found, rows: [], vars: {}, reason: found > 0 && n.days > 0 ? `Rows matched, but none is older than ${n.days} days.` : 'No row matched.' })
  }
  let rows = chosen
  if (!opts.dryRun) {
    const re = relocate(chosen, await api.read(tab))
    if (re.lost) warnings.push(`${re.lost} row${re.lost === 1 ? '' : 's'} changed in the sheet while this ran — not deleted.`)
    rows = re.rows
    if (rows.length === 0) return done({ outcome: 'not_found', found, rows: [], vars: {}, reason: 'The row changed in the sheet while this ran — not deleted.' })
    if (n.deleteMode === 'archive' && tab.toLowerCase() !== ARCHIVE_TAB.toLowerCase()) {
      const archiveHeaders = [...headers, 'Deleted at', 'From tab']
      await api.ensureTab(ARCHIVE_TAB, archiveHeaders)
      const current = ((await api.read(ARCHIVE_TAB))[0] ?? []).map(String)
      let target = isBlank(current) ? [] : current
      const out: string[][] = []
      for (const r of rows) {
        const aligned = alignToHeaders(target, { ...rowObject(headers, r.values), 'Deleted at': opts.nowLabel, 'From tab': tab })
        target = aligned.headers
        out.push(aligned.row)
      }
      if (!sameHeaders(current, target)) await api.writeHeader(ARCHIVE_TAB, target)
      // Archived first, then removed: a failure in between leaves a copy, never a loss.
      await api.append(ARCHIVE_TAB, out.map((row) => [...row, ...Array(Math.max(0, target.length - row.length)).fill('')]))
    }
    await api.deleteRows(tabInfo.sheetId, rows.map((r) => r.row))
  }
  return done({
    outcome: 'deleted', found,
    vars: { ...rowVars(headers, rows[0]), sheet_deleted: String(rows.length) },
    rows: rows.map((r) => ({ row: r.row, before: rowObject(headers, r.values) })),
  })
}

function sameHeaders(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  const waits = [1500, 4000]
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i >= waits.length || !isTransientSheetsError(err)) throw err
      await new Promise((r) => setTimeout(r, waits[i]))
    }
  }
}

/** The real sheet, over the Sheets API, with Google's "busy" retried. */
export function googleSheetsApi(token: string, spreadsheetId: string): SheetsApi {
  return {
    tabs: () => retrying(async () => (await getSpreadsheet(token, spreadsheetId)).tabs),
    read: (tab) => retrying(() => readTab(token, spreadsheetId, tab)),
    append: (tab, rows) => retrying(() => appendRows(token, spreadsheetId, tab, rows)),
    writeCells: (tab, cells) => retrying(() => writeCells(token, spreadsheetId, tab, cells)),
    writeHeader: (tab, headers) => retrying(() => writeHeaderRow(token, spreadsheetId, tab, headers)),
    deleteRows: (sheetId, rows) => retrying(() => deleteRows(token, spreadsheetId, sheetId, rows)),
    ensureTab: (tab, headers) => retrying(() => ensureTab(token, spreadsheetId, tab, headers)),
  }
}

/** The business's wall clock now: as a number for date maths, and as text. */
export function businessNow(timeZone: string, now = new Date()): { nowWall: number; nowLabel: string; today: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  )
  const nowWall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return { nowWall, nowLabel: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`, today: `${p.year}-${p.month}-${p.day}` }
}

/** {{today}} and {{now}} in the business's zone; the rest by `inner`. */
export function withDateTokens(inner: (t: string) => string, now: { today: string; nowLabel: string }): (t: string) => string {
  return (t) => inner(String(t ?? '').replace(/\{\{today\}\}/gi, now.today).replace(/\{\{now\}\}/gi, now.nowLabel))
}

/**
 * The step for real: locked per tab, against Google. An "add" Google
 * keeps refusing as busy is queued (sheet_jobs) and sent within minutes —
 * the customer's chat goes on, and the row is not lost.
 */
export async function runGoogleSheetStep(args: {
  accountId: string
  cfg: SheetStepConfig
  resolve: (t: string) => string
  timeZone: string
  dryRun?: boolean
}): Promise<SheetStepResult & { queued?: boolean }> {
  const { googleAccessToken } = await import('./oauth')
  const id = (args.cfg.spreadsheet_id ?? '').trim()
  if (!id) throw new Error('No Google Sheet chosen in this step.')
  const now = businessNow(args.timeZone)
  const resolve = withDateTokens(args.resolve, now)
  const token = await googleAccessToken(args.accountId)
  const api = googleSheetsApi(token, id)
  const key = sheetLockKey(id, args.cfg.sheet_title ?? '')
  try {
    return await withSheetLock(key, () => runSheetStep(api, args.cfg, resolve, { dryRun: args.dryRun, nowWall: now.nowWall, nowLabel: now.nowLabel }))
  } catch (err) {
    const n = normaliseStepConfig(args.cfg)
    if (args.dryRun || n.action !== 'add' || n.addMode !== 'always' || !isTransientSheetsError(err)) throw err
    const record: Record<string, string> = {}
    for (const m of n.mapping) {
      const v = resolve(m.value)
      if (v.trim()) record[m.column] = v
    }
    const { prisma } = await import('@/lib/db')
    await prisma.sheetJob.create({
      data: {
        account_id: args.accountId,
        kind: 'append',
        payload: { spreadsheet_id: id, tab: args.cfg.sheet_title ?? '', record },
        run_after: new Date(Date.now() + 60_000),
        last_error: err instanceof Error ? err.message : String(err),
      },
    })
    return {
      outcome: 'added', found: 0, rows: [{ row: 0, after: record }], tab: args.cfg.sheet_title ?? '',
      vars: { sheet_status: 'queued', sheet_found: '0' },
      warnings: ['Google Sheets was busy — the row is queued and will be added within a few minutes.'],
      queued: true,
    }
  }
}
