/**
 * Finding and shaping rows in a Google Sheet by its header names — the
 * pure half of the chatbot's "Google Sheet" step and of Sheet routing.
 * No network, no database: everything here is tested on plain arrays.
 *
 * What other tools get wrong, and this does not:
 *  - Row numbers are never trusted. A row found a moment ago is checked
 *    again just before it is written or deleted (`relocate`); if somebody
 *    sorted or deleted rows in between, it is found again by its content,
 *    or left alone — never a wrong row changed.
 *  - Columns are matched by NAME, any case and spacing, at the moment of
 *    writing. Moving columns around in the sheet breaks nothing.
 *  - "is" with a phone number compares the last ten digits, so a sheet's
 *    "99478 40578" is the chatting "+919947840578".
 *  - Dates in the sheet are read the way people type them in India
 *    (18/10/2026, 18-Oct-2026, 2026-10-18).
 */

export type SheetOp = 'equals' | 'phone' | 'contains' | 'empty' | 'not_empty'
export const SHEET_OPS: readonly SheetOp[] = ['equals', 'phone', 'contains', 'empty', 'not_empty']
export type SheetWhich = 'latest' | 'oldest' | 'all'
export type SheetMatchMode = 'all' | 'any'
/** The most rows one step changes in one run. */
export const SHEET_STEP_MAX_ROWS = 20
export const SHEET_MAX_CONDITIONS = 5
/** The tab deleted rows are moved to, so they can be put back. */
export const ARCHIVE_TAB = 'Deleted'

export interface SheetCondition {
  column: string
  op: SheetOp
  value: string
}

export interface SheetRow {
  /** The sheet's own 1-based row number (the header is row 1). */
  row: number
  values: string[]
}

export function normHeader(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function findColumn(headers: readonly string[], name: string): number {
  const want = normHeader(name)
  if (!want) return -1
  return headers.findIndex((h) => normHeader(h) === want)
}

/** Last ten digits, or null when there are fewer than ten. */
export function phoneKey(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const digits = String(v).replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

function looksLikePhone(v: string): boolean {
  return /^[+0-9 ()-]+$/.test(v.trim())
}

export function cellMatches(cell: string, op: SheetOp, value: string): boolean {
  const c = (cell ?? '').trim()
  const v = (value ?? '').trim()
  switch (op) {
    case 'empty':
      return c === ''
    case 'not_empty':
      return c !== ''
    case 'contains':
      return v !== '' && c.toLowerCase().includes(v.toLowerCase())
    case 'phone': {
      const k = phoneKey(v)
      return k !== null && phoneKey(c) === k
    }
    case 'equals': {
      if (v === '') return false
      if (c.toLowerCase() === v.toLowerCase()) return true
      const k = looksLikePhone(v) ? phoneKey(v) : null
      return k !== null && looksLikePhone(c) && phoneKey(c) === k
    }
  }
}

export type CheckedConditions =
  | { error: string }
  | { conditions: Array<SheetCondition & { index: number }>; nothing: boolean }

/**
 * The step's conditions against the sheet's header row. A column that is
 * not in the sheet is an error in words, never a silent "no match".
 * `nothing`: a value came out empty (a variable not set yet) or a phone
 * number too short — that matches no row, rather than every row.
 */
export function checkConditions(headers: readonly string[], conds: readonly SheetCondition[]): CheckedConditions {
  const used = conds.filter((c) => c && c.column && c.column.trim()).slice(0, SHEET_MAX_CONDITIONS)
  if (used.length === 0) return { error: 'Add a condition — which rows should this find?' }
  const out: Array<SheetCondition & { index: number }> = []
  let nothing = false
  for (const c of used) {
    const index = findColumn(headers, c.column)
    if (index < 0) return { error: `Column “${c.column.slice(0, 60)}” is not in the sheet any more. Open the step and choose the column again.` }
    const op = (SHEET_OPS as readonly string[]).includes(c.op) ? c.op : 'equals'
    const value = String(c.value ?? '')
    if ((op === 'equals' || op === 'contains') && value.trim() === '') nothing = true
    if (op === 'phone' && phoneKey(value) === null) nothing = true
    out.push({ column: headers[index], op, value, index })
  }
  return { conditions: out, nothing }
}

function blankRow(values: readonly string[]): boolean {
  return values.every((v) => String(v ?? '').trim() === '')
}

/** Rows (header excluded) that meet the conditions, in sheet order. */
export function matchRows(
  table: readonly (readonly string[])[],
  conds: ReadonlyArray<SheetCondition & { index: number }>,
  mode: SheetMatchMode,
): SheetRow[] {
  const out: SheetRow[] = []
  for (let i = 1; i < table.length; i++) {
    const values = table[i] ?? []
    if (blankRow(values)) continue
    const hits = conds.map((c) => cellMatches(String(values[c.index] ?? ''), c.op, c.value))
    const ok = mode === 'any' ? hits.some(Boolean) : hits.every(Boolean)
    if (ok) out.push({ row: i + 1, values: [...values].map((v) => String(v ?? '')) })
  }
  return out
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function utc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null
  const t = Date.UTC(y, m - 1, d, hh, mm, ss)
  const back = new Date(t)
  return back.getUTCDate() === d ? t : null
}

/**
 * A date as people type it in a sheet, to a comparable number (wall-clock
 * time read as UTC — only ever compared with another such number). Day
 * first when it could be either (18/10 and 05/10 are both October).
 * Null for anything that is not plainly a date.
 */
export function parseSheetDate(text: unknown): number | null {
  const s = String(text ?? '').trim()
  if (!s) return null
  const time = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i)
  let hh = 0
  let mm = 0
  let ss = 0
  if (time) {
    hh = Number(time[1])
    mm = Number(time[2])
    ss = Number(time[3] ?? 0)
    const ap = time[4]?.toLowerCase().replace(/\./g, '')
    if (ap === 'pm' && hh < 12) hh += 12
    if (ap === 'am' && hh === 12) hh = 0
  }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return utc(Number(m[1]), Number(m[2]), Number(m[3]), hh, mm, ss)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    // Month first only when the second number cannot be a month.
    return b > 12 && a <= 12 ? utc(Number(m[3]), a, b, hh, mm, ss) : utc(Number(m[3]), b, a, hh, mm, ss)
  }
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{2,4})/i)
  if (m) {
    const mon = MONTHS[m[2].slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3).toLowerCase()]
    return mon ? utc(Number(m[3]), mon, Number(m[1]), hh, mm, ss) : null
  }
  m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i)
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()]
    return mon ? utc(Number(m[3]), mon, Number(m[2]), hh, mm, ss) : null
  }
  return null
}

/**
 * Newest first. By a date column when one is given (rows whose date
 * cannot be read go last), otherwise by position — lower in the sheet is
 * newer, which is how rows arrive.
 */
export function newestFirst(rows: readonly SheetRow[], dateIndex: number): SheetRow[] {
  const copy = [...rows]
  if (dateIndex < 0) return copy.sort((a, b) => b.row - a.row)
  const when = new Map(copy.map((r) => [r.row, parseSheetDate(r.values[dateIndex])]))
  return copy.sort((a, b) => {
    const ta = when.get(a.row) ?? null
    const tb = when.get(b.row) ?? null
    if (ta === null && tb === null) return b.row - a.row
    if (ta === null) return 1
    if (tb === null) return -1
    return tb - ta || b.row - a.row
  })
}

export function pickSheetRows(rows: readonly SheetRow[], which: SheetWhich, dateIndex: number): SheetRow[] {
  const ordered = newestFirst(rows, dateIndex)
  if (ordered.length === 0) return []
  if (which === 'latest') return [ordered[0]]
  if (which === 'oldest') return [ordered[ordered.length - 1]]
  return ordered.slice(0, SHEET_STEP_MAX_ROWS)
}

/** Rows whose date column is more than `days` days before `nowWall`
 *  (the business's wall-clock time, read as UTC — as parseSheetDate). */
export function olderThan(rows: readonly SheetRow[], dateIndex: number, days: number, nowWall: number): SheetRow[] {
  if (dateIndex < 0 || !(days > 0)) return []
  const cutoff = nowWall - days * 86_400_000
  return rows.filter((r) => {
    const t = parseSheetDate(r.values[dateIndex])
    return t !== null && t < cutoff
  })
}

function trimTail(values: readonly string[]): string[] {
  const out = values.map((v) => String(v ?? '').trim())
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

export function sameRow(a: readonly string[], b: readonly string[]): boolean {
  const x = trimTail(a)
  const y = trimTail(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/**
 * Rows found earlier, checked against the sheet as it is now. Same row
 * number with the same content: kept. Moved (someone sorted, or deleted a
 * row above it): found again by content when exactly one row matches.
 * Changed or gone: dropped — with the count, for the log.
 */
export function relocate(found: readonly SheetRow[], now: readonly (readonly string[])[]): { rows: SheetRow[]; lost: number } {
  const rows: SheetRow[] = []
  const taken = new Set<number>()
  let lost = 0
  for (const f of found) {
    const here = now[f.row - 1]
    if (here && f.row > 1 && !taken.has(f.row) && sameRow(here, f.values)) {
      rows.push({ row: f.row, values: [...here] })
      taken.add(f.row)
      continue
    }
    const elsewhere: number[] = []
    for (let i = 1; i < now.length; i++) if (!taken.has(i + 1) && sameRow(now[i], f.values)) elsewhere.push(i + 1)
    if (elsewhere.length === 1) {
      rows.push({ row: elsewhere[0], values: [...now[elsewhere[0] - 1]] })
      taken.add(elsewhere[0])
    } else {
      lost++
    }
  }
  return { rows, lost }
}

export interface ColumnMapping {
  column: string
  /** A template: "{{vars.name}}", "{{contact.phone}}", "{{today}}", plain text. */
  value: string
}

/** Written as an empty cell; every other empty result leaves the cell alone. */
export const CLEAR_TOKEN = '{{clear}}'

/**
 * Values for the sheet's columns from the step's mapping, matched by
 * header name. `missing`: mapped columns the sheet no longer has.
 * `cells`: column index → value, for updating in place; an empty result
 * (a variable not set yet) is left out so it never wipes a filled cell.
 */
export function buildRow(
  headers: readonly string[],
  mapping: readonly ColumnMapping[],
  resolve: (template: string) => string,
): { values: string[]; cells: Map<number, string>; missing: string[] } {
  const values = headers.map(() => '')
  const cells = new Map<number, string>()
  const missing: string[] = []
  for (const m of mapping) {
    if (!m || !m.column || !m.column.trim()) continue
    const i = findColumn(headers, m.column)
    if (i < 0) {
      missing.push(m.column)
      continue
    }
    const tpl = String(m.value ?? '')
    if (tpl.trim() === CLEAR_TOKEN) {
      values[i] = ''
      cells.set(i, '')
      continue
    }
    const v = resolve(tpl).slice(0, 50_000)
    values[i] = v
    if (v.trim() !== '') cells.set(i, v)
  }
  return { values, cells, missing }
}

/** "Mobile No." → "mobile_no" — for {{vars.sheet_mobile_no}}. */
export function headerSlug(header: string): string {
  return normHeader(header).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

/** The row as variables for the next steps: sheet_<column>, plus sheet_row. */
export function rowVars(headers: readonly string[], row: SheetRow | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!row) return out
  headers.forEach((h, i) => {
    const slug = headerSlug(h)
    if (slug) out[`sheet_${slug}`] = String(row.values[i] ?? '')
  })
  out.sheet_row = String(row.row)
  return out
}

/** A row as { header: value }, for the run log and Recent results. */
export function rowObject(headers: readonly string[], values: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((h, i) => {
    if (h && h.trim()) out[h] = String(values[i] ?? '')
  })
  return out
}

/**
 * A row for another tab whose headers may differ: placed by header name;
 * columns that tab lacks are added to the end of its header row.
 */
export function alignToHeaders(target: readonly string[], record: Readonly<Record<string, string>>): { headers: string[]; row: string[]; added: string[] } {
  const headers = target.map((h) => String(h ?? ''))
  const added: string[] = []
  for (const key of Object.keys(record)) {
    if (findColumn(headers, key) < 0) {
      headers.push(key)
      added.push(key)
    }
  }
  const row = headers.map(() => '')
  for (const [k, v] of Object.entries(record)) row[findColumn(headers, k)] = v
  return { headers, row, added }
}

const SYNONYMS: string[][] = [
  ['phone', 'mobile', 'whatsapp', 'contact number', 'phone number', 'mobile number', 'mob', 'cell', 'number', 'ph'],
  ['name', 'full name', 'customer name', 'student name', 'patient name', 'contact name'],
  ['email', 'e-mail', 'mail', 'email id', 'email address'],
  ['date', 'today', 'created', 'created at', 'timestamp', 'time', 'submitted', 'registered on', 'date & time'],
  ['message', 'trigger message', 'query', 'enquiry', 'question', 'comments', 'remarks'],
]

function words(s: string): string {
  return normHeader(s).replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface MatchOption {
  /** The template written into the mapping. */
  value: string
  label: string
  /** Extra names it answers to: a variable's key, a field's key. */
  keys?: string[]
}

/**
 * The best guess for each sheet column, from the options the builder
 * offers. Exact name first, then a known synonym, then one name inside
 * the other. Each option is used once.
 */
export function autoMatch(headers: readonly string[], options: readonly MatchOption[]): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()
  const namesOf = (o: MatchOption) => [o.label, ...(o.keys ?? [])].map(words).filter(Boolean)
  // "mobile no" → phone by its first word; "reg no" stays unmatched.
  const group = (w: string) => {
    const exact = SYNONYMS.findIndex((g) => g.includes(w))
    if (exact >= 0) return exact
    const first = w.split(' ')[0]
    return first === 'number' || first === w ? -1 : SYNONYMS.findIndex((g) => g.includes(first))
  }
  const passes: Array<(h: string, names: string[]) => boolean> = [
    (h, names) => names.includes(h),
    (h, names) => {
      const g = group(h)
      return g >= 0 && names.some((n) => group(n) === g)
    },
    (h, names) => h.length >= 3 && names.some((n) => n.length >= 3 && (n.includes(h) || h.includes(n))),
  ]
  for (const pass of passes) {
    for (const header of headers) {
      if (!header || out[header] !== undefined) continue
      const h = words(header)
      if (!h || h === 'crm id') continue
      const hit = options.find((o) => !used.has(o.value) && pass(h, namesOf(o)))
      if (hit) {
        out[header] = hit.value
        used.add(hit.value)
      }
    }
  }
  return out
}

/** Tab names Google refuses, or would read as a range. */
export function safeTabTitle(raw: string): string {
  const t = String(raw ?? '')
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/'/g, '’')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
  return t || 'Others'
}
