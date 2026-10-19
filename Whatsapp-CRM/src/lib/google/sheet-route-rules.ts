/**
 * Sheet routing rules — which Google Sheet (and tab) a Data Store row
 * belongs in. Pure: tested on plain objects; the worker
 * (sheet-routing.ts) does the writing.
 *
 * A rule is conditions on the row's fields → a destination. Rules are
 * checked in order: "first match only" stops at the first, "every match"
 * sends the row to each. A fallback rule ("Others") takes rows no other
 * rule wanted, so nothing silently goes nowhere.
 *
 * A destination's tab (or whole spreadsheet) can be split by the row's
 * own values: "{{Month}} – {{Target group}}" makes one tab per month and
 * group, created the first time a row needs it.
 */

import { cellText, ID_HEADER, NOT_SYNCED } from './sheet-two-way-plan'
import { parseSheetDate, safeTabTitle } from './sheet-rows'

export type RouteOp =
  | 'is' | 'is_not' | 'contains' | 'one_of' | 'empty' | 'not_empty'
  | 'in_month' | 'date_between' | 'gt' | 'lt'
export const ROUTE_OPS: readonly RouteOp[] = ['is', 'is_not', 'contains', 'one_of', 'empty', 'not_empty', 'in_month', 'date_between', 'gt', 'lt']

export interface RouteCondition {
  field_key: string
  op: RouteOp
  value?: string
  /** date_between: the end date. */
  value2?: string
}

export interface RouteField {
  field_key: string
  label: string
  field_type: string
  options?: unknown
}

export interface RouteColumn {
  field_key: string
  header: string
}

export interface RouteRule {
  id: string
  name: string
  enabled: boolean
  is_fallback: boolean
  match: 'all' | 'any'
  conditions: RouteCondition[]
  spreadsheet_id: string
  tab_title: string
  split_template: string | null
  split_into: 'tab' | 'sheet'
  columns: RouteColumn[]
}

export interface RouteRecord {
  id: string
  data: Record<string, unknown>
  created_at: Date | string
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The select option's label for a stored value (values are often codes). */
function optionLabel(field: RouteField | undefined, v: string): string {
  const opts = Array.isArray(field?.options) ? (field!.options as Array<{ value?: unknown; label?: unknown }>) : []
  const hit = opts.find((o) => String(o?.value ?? '') === v)
  return hit && typeof hit.label === 'string' ? hit.label : v
}

/** A field's value as the list of texts it stands for (multiselect = many). */
function textsOf(raw: unknown, field: RouteField | undefined): string[] {
  const list = Array.isArray(raw) ? raw : [raw]
  const out: string[] = []
  for (const x of list) {
    const t = cellText(x)
    if (!t) continue
    out.push(t)
    const label = optionLabel(field, t)
    if (label !== t) out.push(label)
  }
  return out
}

function num(v: unknown): number | null {
  const s = String(v ?? '').replace(/[,₹$\s]/g, '')
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

/** Month 1–12 and year (or null) a value names: a date, "October", "Oct 2026", "2026-10". */
function monthOf(v: string): { m: number; y: number | null } | null {
  const s = v.trim()
  const ym = s.match(/^(\d{4})-(\d{1,2})$/)
  if (ym) return { y: Number(ym[1]), m: Number(ym[2]) }
  const t = parseSheetDate(s)
  if (t !== null) {
    const d = new Date(t)
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
  }
  const named = s.toLowerCase().match(/^([a-z]{3,9})\.?(?:[\s,-]+(\d{4}))?$/)
  if (named) {
    const i = MONTH_NAMES.findIndex((n) => n.startsWith(named[1].slice(0, 3)))
    if (i >= 0) return { m: i + 1, y: named[2] ? Number(named[2]) : null }
  }
  return null
}

/** "this_month" / "last_month" / "next_month" / "October" / "2026-10" → month spec. */
export function resolveMonthSpec(spec: string, nowWall: number): { m: number; y: number | null } | null {
  const s = spec.trim().toLowerCase()
  const now = new Date(nowWall)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const shift = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1))
    return { m: t.getUTCMonth() + 1, y: t.getUTCFullYear() }
  }
  if (s === 'this_month' || s === 'this month') return shift(0)
  if (s === 'last_month' || s === 'last month') return shift(-1)
  if (s === 'next_month' || s === 'next month') return shift(1)
  return monthOf(spec)
}

export function conditionHolds(c: RouteCondition, rec: RouteRecord, fields: ReadonlyMap<string, RouteField>, nowWall: number): boolean {
  const field = fields.get(c.field_key)
  const raw = c.field_key === '__created' ? new Date(rec.created_at).toISOString().slice(0, 10) : rec.data?.[c.field_key]
  const texts = textsOf(raw, field)
  const want = String(c.value ?? '').trim()
  const lower = texts.map((t) => t.toLowerCase())
  switch (c.op) {
    case 'empty':
      return texts.length === 0
    case 'not_empty':
      return texts.length > 0
    case 'is':
      return want !== '' && lower.includes(want.toLowerCase())
    case 'is_not':
      return !lower.includes(want.toLowerCase())
    case 'contains':
      return want !== '' && lower.some((t) => t.includes(want.toLowerCase()))
    case 'one_of': {
      const set = want.split(/[\n,]/).map((x) => x.trim().toLowerCase()).filter(Boolean)
      return set.length > 0 && lower.some((t) => set.includes(t))
    }
    case 'gt':
    case 'lt': {
      const a = num(texts[0])
      const b = num(want)
      if (a !== null && b !== null) return c.op === 'gt' ? a > b : a < b
      const da = parseSheetDate(texts[0])
      const db = parseSheetDate(want)
      if (da !== null && db !== null) return c.op === 'gt' ? da > db : da < db
      return false
    }
    case 'in_month': {
      const spec = resolveMonthSpec(want, nowWall)
      if (!spec) return false
      return texts.some((t) => {
        const got = monthOf(t)
        return !!got && got.m === spec.m && (spec.y === null || got.y === null || got.y === spec.y)
      })
    }
    case 'date_between': {
      const t = parseSheetDate(texts[0])
      const from = parseSheetDate(want)
      const to = parseSheetDate(String(c.value2 ?? ''))
      if (t === null || (from === null && to === null)) return false
      // "to" is the whole of that day.
      return (from === null || t >= from) && (to === null || t < to + 86_400_000)
    }
  }
  return false
}

export function ruleMatches(rule: RouteRule, rec: RouteRecord, fields: ReadonlyMap<string, RouteField>, nowWall: number): boolean {
  const conds = rule.conditions.filter((c) => c && c.field_key)
  // A non-fallback rule with no conditions takes every row — that is a
  // choice ("copy everything here"), shown as such on the screen.
  if (conds.length === 0) return true
  const hits = conds.map((c) => conditionHolds(c, rec, fields, nowWall))
  return rule.match === 'any' ? hits.some(Boolean) : hits.every(Boolean)
}

/** The rules this row goes to, in order. */
export function chooseRules(
  rules: readonly RouteRule[],
  rec: RouteRecord,
  fields: ReadonlyMap<string, RouteField>,
  mode: 'first' | 'all',
  nowWall: number,
): RouteRule[] {
  const live = rules.filter((r) => r.enabled)
  const out: RouteRule[] = []
  for (const r of live) {
    if (r.is_fallback) continue
    if (ruleMatches(r, rec, fields, nowWall)) {
      out.push(r)
      if (mode === 'first') break
    }
  }
  if (out.length === 0) {
    const fallback = live.find((r) => r.is_fallback)
    if (fallback) out.push(fallback)
  }
  return out
}

/**
 * "{{Month}} – {{Target group}}" for this row. A token is a field's label
 * or key; "|month" turns a date into "Oct 2026", "|monthname" into
 * "October", "|year" into "2026". {{Created|month}} uses when the row was
 * made. An empty value reads "(blank)".
 */
export function renderGroup(template: string, rec: RouteRecord, fields: readonly RouteField[]): string {
  const out = template.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*(month|monthname|year)\s*)?\}\}/gi, (_, name: string, fmt?: string) => {
    const key = name.trim().toLowerCase()
    let text: string
    let field: RouteField | undefined
    if (key === 'created' || key === 'created at') {
      text = new Date(rec.created_at).toISOString().slice(0, 10)
    } else {
      field = fields.find((f) => f.label.trim().toLowerCase() === key || f.field_key.toLowerCase() === key)
      // The label, not the stored code, for a choice field.
      const all = field ? textsOf(rec.data?.[field.field_key], field) : []
      text = field && all.length ? optionLabel(field, all[0]) : ''
    }
    if (!text) return '(blank)'
    const f = fmt?.toLowerCase()
    if (f) {
      const mo = monthOf(text)
      if (!mo) return text
      if (f === 'year') return mo.y ? String(mo.y) : text
      if (f === 'monthname') return MONTH_NAMES[mo.m - 1][0].toUpperCase() + MONTH_NAMES[mo.m - 1].slice(1)
      return `${MONTH_SHORT[mo.m - 1]}${mo.y ? ` ${mo.y}` : ''}`
    }
    return text
  })
  return safeTabTitle(out)
}

/** The fields a sheet can hold, in the table's order. */
export function routableFields(fields: readonly RouteField[]): RouteField[] {
  return fields.filter((f) => !NOT_SYNCED.has(f.field_type))
}

/** Columns that are not a field: a running number, and when the row was added. */
export const SERIAL_KEY = '__serial'
export const CREATED_KEY = '__created'
export const SPECIAL_COLUMNS: ReadonlyArray<{ field_key: string; label: string }> = [
  { field_key: SERIAL_KEY, label: 'Serial number (1, 2, 3…)' },
  { field_key: CREATED_KEY, label: 'Date added' },
]
/** Stands for "the next serial number" until the tab is read. */
export const SERIAL_MARK = '\u0000serial'

/** Header row for a rule: its chosen columns (or every field), then "CRM ID". */
export function ruleHeaders(rule: RouteRule, fields: readonly RouteField[]): { headers: string[]; keys: string[] } {
  const usable = routableFields(fields)
  const cols = rule.columns.length
    ? rule.columns.filter((c) => usable.some((f) => f.field_key === c.field_key) || SPECIAL_COLUMNS.some((s) => s.field_key === c.field_key))
    : usable.map((f) => ({ field_key: f.field_key, header: f.label }))
  const seen = new Set<string>()
  const headers: string[] = []
  const keys: string[] = []
  for (const c of cols) {
    const h = (c.header || c.field_key).trim().slice(0, 100)
    if (!h || seen.has(h.toLowerCase()) || h.toLowerCase() === ID_HEADER.toLowerCase()) continue
    seen.add(h.toLowerCase())
    headers.push(h)
    keys.push(c.field_key)
  }
  return { headers: [...headers, ID_HEADER], keys }
}

/** The row's cells for a rule's headers; select codes shown as their labels. */
export function ruleRow(keys: readonly string[], rec: RouteRecord, fields: readonly RouteField[], timeZone = 'UTC'): string[] {
  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const cells = keys.map((k) => {
    if (k === SERIAL_KEY) return SERIAL_MARK
    if (k === CREATED_KEY) {
      // The business's own date, not the server's.
      return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(rec.created_at))
    }
    const f = byKey.get(k)
    const raw = rec.data?.[k]
    const list = Array.isArray(raw) ? raw : [raw]
    return list.map((x) => optionLabel(f, cellText(x))).filter(Boolean).join(', ')
  })
  return [...cells, rec.id]
}

export interface Destination {
  rule: RouteRule
  /** Group name when split, else null. */
  group: string | null
  /** spreadsheet_id, or null when split into a sheet per group not made yet. */
  spreadsheet_id: string | null
  tab: string
  headers: string[]
  row: string[]
  hash: string
}

export function hashRow(row: readonly string[]): string {
  // FNV-1a — a change detector, not security.
  let h = 0x811c9dc5
  const s = row.join('\u0001')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}

/** Where this row goes, and what it looks like there. */
export function destinationsFor(args: {
  rules: readonly RouteRule[]
  rec: RouteRecord
  fields: readonly RouteField[]
  mode: 'first' | 'all'
  nowWall: number
  /** split_into = 'sheet': group → the spreadsheet already made for it. */
  sheetForGroup?: (ruleId: string, group: string) => string | null
  timeZone?: string
}): Destination[] {
  const fieldMap = new Map(args.fields.map((f) => [f.field_key, f]))
  return chooseRules(args.rules, args.rec, fieldMap, args.mode, args.nowWall).map((rule) => {
    const { headers, keys } = ruleHeaders(rule, args.fields)
    const row = ruleRow(keys, args.rec, args.fields, args.timeZone)
    const group = rule.split_template && rule.split_template.trim() ? renderGroup(rule.split_template, args.rec, args.fields) : null
    let spreadsheet_id: string | null = rule.spreadsheet_id
    let tab = safeTabTitle(rule.tab_title || 'Sheet1')
    if (group) {
      if (rule.split_into === 'sheet') spreadsheet_id = args.sheetForGroup?.(rule.id, group) ?? null
      else tab = group
    }
    return { rule, group, spreadsheet_id, tab, headers, row, hash: hashRow([...headers, '|', ...row]) }
  })
}

/** The preview: how many rows would go where. No Google calls. */
export function previewRouting(args: {
  rules: readonly RouteRule[]
  records: readonly RouteRecord[]
  fields: readonly RouteField[]
  mode: 'first' | 'all'
  nowWall: number
}): { total: number; nowhere: number; destinations: Array<{ rule_id: string; rule: string; place: string; count: number }> } {
  const counts = new Map<string, { rule_id: string; rule: string; place: string; count: number }>()
  let nowhere = 0
  for (const rec of args.records) {
    const dests = destinationsFor({ ...args, rec, sheetForGroup: () => null })
    if (dests.length === 0) nowhere++
    for (const d of dests) {
      const place = d.group && d.rule.split_into === 'sheet' ? `New sheet “${d.group}”` : `Tab “${d.tab}”`
      const key = `${d.rule.id}\u0000${place}`
      const cur = counts.get(key) ?? { rule_id: d.rule.id, rule: d.rule.name, place, count: 0 }
      cur.count++
      counts.set(key, cur)
    }
  }
  return { total: args.records.length, nowhere, destinations: [...counts.values()].sort((a, b) => b.count - a.count) }
}

/** Plain words for a rule's conditions — the card on the screen. */
export function describeConditions(conds: readonly RouteCondition[], match: 'all' | 'any', fields: readonly RouteField[]): string {
  const label = (k: string) => (k === '__created' ? 'Created' : fields.find((f) => f.field_key === k)?.label ?? k)
  const words: Record<RouteOp, string> = {
    is: 'is', is_not: 'is not', contains: 'contains', one_of: 'is one of', empty: 'is empty', not_empty: 'is not empty',
    in_month: 'is in', date_between: 'is between', gt: 'is more than', lt: 'is less than',
  }
  const parts = conds.filter((c) => c.field_key).map((c) => {
    const v = String(c.value ?? '').replace(/_/g, ' ')
    if (c.op === 'empty' || c.op === 'not_empty') return `${label(c.field_key)} ${words[c.op]}`
    if (c.op === 'date_between') return `${label(c.field_key)} is between ${v || '…'} and ${c.value2 || '…'}`
    return `${label(c.field_key)} ${words[c.op]} “${v}”`
  })
  if (parts.length === 0) return 'Every row'
  return parts.join(match === 'any' ? ' or ' : ' and ')
}

export interface TabWrite {
  /** Row 1 to write first, when it had to change (columns only ever added at the end). */
  header: string[] | null
  cells: Array<{ row: number; col: number; value: string }>
  appends: string[][]
  /** 1-based sheet rows to remove. */
  deletes: number[]
  /** Record ids newly appended (counted as delivered). */
  added: string[]
}

/**
 * Which row holds the column names. Usually row 1; a template with a title
 * or a logo row above its table has them lower down. The first of the top
 * ten rows naming the most of the rule's columns wins.
 */
export function findHeaderRow(table: readonly (readonly string[])[], headers: readonly string[]): number {
  const norm = (s: string) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const wanted = new Set(headers.map(norm).filter((h) => h && h !== norm(ID_HEADER)))
  let best = 0
  let bestScore = 0
  for (let i = 0; i < Math.min(10, table.length); i++) {
    const score = (table[i] ?? []).filter((c) => wanted.has(norm(c))).length
    if (score > bestScore) { best = i; bestScore = score }
  }
  return best
}

/**
 * One tab's changes for a batch of rows, found by their "CRM ID" — never
 * by row number from an earlier read. Columns are matched by name, so a
 * person reordering or inserting columns in the sheet breaks nothing;
 * columns this rule needs and the tab lacks are added at the end.
 * `headerIndex`: the header row (findHeaderRow), 0 = row 1.
 */
export function planTabWrite(
  table: readonly (readonly string[])[],
  upserts: ReadonlyArray<{ id: string; headers: readonly string[]; row: readonly string[] }>,
  removeIds: readonly string[],
  headerIndex = 0,
): TabWrite {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const current = (table[headerIndex] ?? []).map((h) => String(h ?? ''))
  const blank = current.every((h) => !h.trim())
  const header = blank ? [] : [...current]
  for (const u of upserts) {
    for (const h of u.headers) if (!header.some((x) => norm(x) === norm(h))) header.push(h)
  }
  if (!header.some((x) => norm(x) === norm(ID_HEADER)) && (upserts.length || removeIds.length)) header.push(ID_HEADER)
  const changed = blank ? header.length > 0 : header.length !== current.length
  const col = (h: string) => header.findIndex((x) => norm(x) === norm(h))
  const idCol = col(ID_HEADER)

  const rowsOf = new Map<string, number[]>()
  for (let i = headerIndex + 1; i < table.length; i++) {
    const id = String(table[i]?.[idCol] ?? '').trim()
    if (!id) continue
    const list = rowsOf.get(id) ?? []
    list.push(i + 1)
    rowsOf.set(id, list)
  }

  // A serial-number column carries on from the highest number already there.
  const serialCols = new Set<number>()
  for (const u of upserts) u.headers.forEach((h, i) => { if (u.row[i] === SERIAL_MARK) serialCols.add(col(h)) })
  const nextSerial = new Map<number, number>()
  for (const c of serialCols) {
    let max = 0
    for (let i = headerIndex + 1; i < table.length; i++) {
      const n = Number(String(table[i]?.[c] ?? '').trim())
      if (Number.isInteger(n) && n > max) max = n
    }
    nextSerial.set(c, max + 1)
  }

  const out: TabWrite = { header: changed ? header : null, cells: [], appends: [], deletes: [], added: [] }
  for (const u of upserts) {
    const existing = rowsOf.get(u.id)
    if (existing && existing.length) {
      const r = existing[0]
      const now = table[r - 1] ?? []
      u.headers.forEach((h, i) => {
        const c = col(h)
        const v = String(u.row[i] ?? '')
        // A row keeps the serial number it was given.
        if (v === SERIAL_MARK) return
        if (c >= 0 && String(now[c] ?? '') !== v) out.cells.push({ row: r, col: c, value: v })
      })
    } else {
      const line = header.map(() => '')
      u.headers.forEach((h, i) => {
        const c = col(h)
        if (c < 0) return
        let v = String(u.row[i] ?? '')
        if (v === SERIAL_MARK) {
          const n = nextSerial.get(c) ?? 1
          nextSerial.set(c, n + 1)
          v = String(n)
        }
        line[c] = v
      })
      out.appends.push(line)
      out.added.push(u.id)
    }
  }
  for (const id of removeIds) out.deletes.push(...(rowsOf.get(id) ?? []))
  out.deletes = [...new Set(out.deletes)].sort((a, b) => b - a)
  return out
}
