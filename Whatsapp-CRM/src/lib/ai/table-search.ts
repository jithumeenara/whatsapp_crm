/**
 * Searching the business's own tables for the customer-facing assistant.
 *
 * ── Why a search, not knowledge ─────────────────────────────────────
 *
 * A table given to the model as text is only as good as the model's
 * reading of it: it picks rows by eye, compares dates and fees in its
 * head, and can only see the rows that fitted in the prompt. Research on
 * tables says the same thing our own transcripts did — lists came back
 * incomplete, "October" picked up a September row, a fee was retyped
 * wrong. So the model now says *what* it wants (a table, a month, a date,
 * a limit) and this code does the finding: exact comparisons, every row,
 * the live table rather than a snapshot.
 *
 * ── What it can reach ───────────────────────────────────────────────
 *
 * Only tables connected as customer knowledge that are not people's own
 * submissions (see knowledge-store.ts / people-tables.ts), only columns
 * that knowledge would show, read-only, a bounded number of rows. The
 * model names a table and conditions; it never writes a query.
 *
 * This file is the pure part — matching, rendering, the placeholder — so
 * it can be tested without a database. table-search-store.ts loads.
 */

import { englishFor, monthOf, normalizeMalayalam, MONTH_ENGLISH } from './term-bridge'

export interface SearchField {
  key: string
  label: string
  type: string
}

export interface LoadedTable {
  tableId: string
  knowledgeId: string
  name: string
  purpose: string | null
  fields: SearchField[]
  rows: Array<{ id: string; data: Record<string, unknown> }>
  /** Column the customer must choose before rows are listed. */
  askFirst: string | null
  /** Date column that decides what counts as upcoming. */
  upcomingBy: string | null
  /** More rows exist than were read. */
  truncated: boolean
}

export const MATCHES = [
  'is', 'contains', 'in_month', 'before', 'after', 'from', 'until',
  'less_than', 'more_than', 'at_most', 'at_least',
] as const
export type Match = (typeof MATCHES)[number]

export interface SearchFilter {
  column: string
  match: string
  value: string
}

export interface SearchArgs {
  table?: unknown
  filters?: unknown
  words?: unknown
  upcoming_only?: unknown
  limit?: unknown
}

export interface FoundRecord {
  /** The line the customer is shown, exactly. */
  line: string
  /** The same row's raw values, for checking a retyped line against. */
  raw: string
}

export type SearchOutcome =
  | {
      kind: 'records'
      table: string
      matched: number
      shown: number
      records: FoundRecord[]
      list: string
      how_to_show: string
      note?: string
      available?: Record<string, string[]>
    }
  | { kind: 'needs'; table: string; needs: string; choices: string[]; note: string }
  | { kind: 'error'; error: string }

export const RECORDS_PLACEHOLDER = '[[records]]'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25
/** A column with at most this many different values is offered as
 *  choices ("Month: september, october"). */
const MAX_CHOICES = 30

// ── Normalising ─────────────────────────────────────────────────────

export function norm(value: unknown): string {
  return normalizeMalayalam(String(value ?? ''))
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/^[\s.,;:!?'"()[\]-]+|[\s.,;:!?'"()[\]-]+$/g, '')
    .trim()
}

/** Column names compared loosely: "Date To", "date_to", "dateto". */
function key(value: string): string {
  return norm(value).replace(/[^\p{L}\p{N}]+/gu, '')
}

function cellText(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (Array.isArray(raw)) return raw.map(cellText).filter(Boolean).join(', ')
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const k of ['label', 'name', 'title', 'value']) if (typeof o[k] === 'string') return String(o[k]).trim()
    return ''
  }
  return String(raw).trim()
}

// ── Dates ───────────────────────────────────────────────────────────

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A cell or a value as YYYY-MM-DD, or null. Day-first for slashes —
 *  12/10/2026 is the 12th of October here. */
export function asDate(raw: unknown): string | null {
  const s = cellText(raw)
  if (!s) return null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) return ymd(+m[3], +m[2], +m[1])
  m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(s)
  if (m) {
    const month = monthOf(m[2])
    if (month) return ymd(+m[3], month, +m[1])
  }
  // Not bare digit runs: a ten-digit cell is far more often a phone
  // number than a timestamp.
  return null
}

function ymd(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1900)) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** A date the model or customer named — "today", "tomorrow", an ISO or
 *  day-first date — worked out from today in the business's zone. */
export function resolveDate(value: string, today: string): string | null {
  const v = norm(value)
  if (v === 'today' || v === 'ഇന്ന്') return today
  if (v === 'tomorrow' || v === 'നാളെ') return addDays(today, 1)
  if (v === 'yesterday' || v === 'ഇന്നലെ') return addDays(today, -1)
  return asDate(value.trim())
}

/** A month the model or customer named: "October", "ഒക്ടോബർ", "2026-10",
 *  "this_month", "next_month". A month without a year is its next
 *  occurrence counting this one — asked in September, "October" is this
 *  year's; asked in November, next year's. */
export function resolveMonth(value: string, today: string): { year: number; month: number; yearGiven: boolean } | null {
  const v = norm(value).replace(/\s+/g, '_')
  const [ty, tm] = today.split('-').map(Number)
  if (v === 'this_month' || v === 'ഈ_മാസം') return { year: ty, month: tm, yearGiven: true }
  if (v === 'next_month' || v === 'അടുത്ത_മാസം') return tm === 12 ? { year: ty + 1, month: 1, yearGiven: true } : { year: ty, month: tm + 1, yearGiven: true }
  let m = /^(\d{4})-(\d{1,2})$/.exec(v)
  if (m && +m[2] >= 1 && +m[2] <= 12) return { year: +m[1], month: +m[2], yearGiven: true }
  m = /^([^\d_]+)_?(\d{4})$/.exec(v)
  if (m) {
    const month = monthOf(m[1])
    if (month) return { year: +m[2], month, yearGiven: true }
  }
  const month = monthOf(v.split('_')[0])
  if (!month) return null
  return { year: month >= tm ? ty : ty + 1, month, yearGiven: false }
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`
}

// ── Numbers ─────────────────────────────────────────────────────────

function asNumber(raw: unknown): number | null {
  const s = cellText(raw).replace(/[,\s₹$€£]|rs\.?|inr/gi, '')
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

// ── Column roles ────────────────────────────────────────────────────

const isDateField = (f: SearchField) => f.type === 'date' || f.type === 'datetime'
const START_LABEL = /\b(from|start|begin|starts|commence)|തുടക്ക|മുതൽ/i
const END_LABEL = /\b(to|end|till|until|last|ends|close)\b|വരെ|അവസാന/i
const TITLE_LABEL = /name|title|programme|program|course|product|item|service|doctor|subject|event|plan|package/i

function dateFields(table: LoadedTable): SearchField[] {
  // A text column is a date column when its values are dates.
  return table.fields.filter(
    (f) =>
      isDateField(f) ||
      (f.type === 'text' &&
        table.rows.length > 0 &&
        table.rows.filter((r) => cellText(r.data[f.key])).every((r) => asDate(r.data[f.key]) !== null) &&
        table.rows.some((r) => asDate(r.data[f.key]) !== null)),
  )
}

function startAndEnd(table: LoadedTable): { start: SearchField | null; end: SearchField | null } {
  const dates = dateFields(table)
  if (dates.length === 0) return { start: null, end: null }
  const start = dates.find((f) => START_LABEL.test(f.label)) ?? dates[0]
  const end = dates.find((f) => f !== start && END_LABEL.test(f.label)) ?? null
  return { start, end }
}

function titleField(table: LoadedTable): SearchField | null {
  const texty = table.fields.filter((f) => f.type === 'text' || f.type === 'select')
  return texty.find((f) => TITLE_LABEL.test(f.label)) ?? texty[0] ?? null
}

export function findColumn(table: LoadedTable, name: string): SearchField | null {
  const k = key(name)
  if (!k) return null
  return (
    table.fields.find((f) => key(f.label) === k || key(f.key) === k) ??
    table.fields.find((f) => key(f.label).includes(k) || k.includes(key(f.label))) ??
    null
  )
}

export function findTable(tables: readonly LoadedTable[], name: string): LoadedTable | null {
  const k = key(name)
  if (!k) return tables.length === 1 ? tables[0] : null
  return tables.find((t) => key(t.name) === k) ?? tables.find((t) => key(t.name).includes(k) || k.includes(key(t.name))) ?? null
}

/** The different values a column holds, in first-seen order. */
export function choicesOf(rows: LoadedTable['rows'], field: SearchField): string[] {
  const seen = new Map<string, string>()
  for (const r of rows) {
    const t = cellText(r.data[field.key])
    if (t && !seen.has(norm(t))) seen.set(norm(t), t)
  }
  return [...seen.values()]
}

// ── Matching one condition ──────────────────────────────────────────

function wordsOf(text: string): string[] {
  return norm(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => Array.from(w).length > 1)
}

function textHas(haystack: string, needle: string): boolean {
  const h = norm(haystack)
  const n = norm(needle)
  if (!n) return true
  if (h.includes(n)) return true
  // Every word of the value, in either script: "ഗോൾഡ് ലോൺ" finds "Gold loan".
  const words = wordsOf(n)
  return (
    words.length > 0 &&
    words.every(
      (w) =>
        h.includes(w) ||
        // "programmes" finds "Programme".
        (/^[a-z]{5,}$/.test(w) && h.includes(w.replace(/(es|s)$/, ''))) ||
        englishFor(w).some((e) => h.includes(e)),
    )
  )
}

function sameValue(cell: string, value: string): boolean {
  if (!cell) return false
  if (norm(cell) === norm(value)) return true
  const a = monthOf(cell)
  if (a !== null && a === monthOf(value)) return true
  const x = asNumber(cell)
  const y = asNumber(value)
  if (x !== null && y !== null) return x === y
  return false
}

function matchesFilter(
  row: LoadedTable['rows'][number],
  field: SearchField,
  match: Match,
  value: string,
  today: string,
  isDate: boolean,
): boolean {
  const raw = row.data[field.key]
  const cell = cellText(raw)

  switch (match) {
    case 'is': {
      if (isDate) {
        const want = resolveDate(value, today)
        if (want) return asDate(raw) === want
      }
      return cell.split(/\s*,\s*/).some((part) => sameValue(part, value)) || sameValue(cell, value)
    }
    case 'contains':
      return textHas(cell, value)
    case 'in_month': {
      const want = resolveMonth(value, today)
      if (!want) return false
      const d = asDate(raw)
      if (d) {
        // A dated row: that month of that year (the next one, when no
        // year was named).
        const [y, m] = d.split('-').map(Number)
        return m === want.month && y === want.year
      }
      // A month written as a word in the cell: "october".
      return monthOf(cell) === want.month
    }
    case 'before':
    case 'after':
    case 'from':
    case 'until': {
      const want = resolveDate(value, today)
      const d = asDate(raw)
      if (!want || !d) return false
      if (match === 'before') return d < want
      if (match === 'after') return d > want
      if (match === 'from') return d >= want
      return d <= want
    }
    case 'less_than':
    case 'more_than':
    case 'at_most':
    case 'at_least': {
      const want = asNumber(value)
      const n = asNumber(raw)
      if (want === null || n === null) return false
      if (match === 'less_than') return n < want
      if (match === 'more_than') return n > want
      if (match === 'at_most') return n <= want
      return n >= want
    }
  }
}

// ── Rendering ───────────────────────────────────────────────────────

function formatCell(field: SearchField, raw: unknown, isDate: boolean): string {
  if (isDate) {
    const d = asDate(raw)
    if (d) return prettyDate(d)
  }
  if (field.type === 'number') {
    const n = asNumber(raw)
    if (n !== null) return n.toLocaleString('en-IN')
  }
  return cellText(raw).replace(/\*/g, '')
}

/** One row as the customer sees it: the name in bold, then the dates as
 *  a range, then every other filled column as "Label: value". */
export function renderRow(table: LoadedTable, row: LoadedTable['rows'][number]): FoundRecord {
  const title = titleField(table)
  const { start, end } = startAndEnd(table)
  const dates = new Set(dateFields(table).map((f) => f.key))
  const parts: string[] = []
  const rawParts: string[] = []

  const s = start ? asDate(row.data[start.key]) : null
  const e = end ? asDate(row.data[end.key]) : null
  if (s && e && s !== e) parts.push(`${prettyDate(s)} – ${prettyDate(e)}`)
  else if (s) parts.push(prettyDate(s))

  for (const f of table.fields) {
    const raw = row.data[f.key]
    const text = cellText(raw)
    if (!text) continue
    rawParts.push(`${f.label}: ${text}`)
    if (f === title || f === start || f === end) continue
    // The month is already in the dates shown.
    if (s && monthOf(text) !== null && /month|മാസ/i.test(f.label)) continue
    parts.push(`${f.label}: ${formatCell(f, raw, dates.has(f.key))}`)
  }

  const name = title ? cellText(row.data[title.key]).replace(/\*/g, '') : ''
  const line = name ? `*${name}*${parts.length ? ` — ${parts.join(' · ')}` : ''}` : parts.join(' · ')
  return { line, raw: rawParts.join(' | ') }
}

// ── The search ──────────────────────────────────────────────────────

function asFilters(value: unknown): SearchFilter[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
    .map((f) => ({ column: String(f.column ?? ''), match: String(f.match ?? 'is'), value: String(f.value ?? '') }))
    .filter((f) => f.column && f.value)
    .slice(0, 8)
}

export function searchTable(
  tables: readonly LoadedTable[],
  args: SearchArgs,
  today: string,
): SearchOutcome {
  const table = findTable(tables, typeof args.table === 'string' ? args.table : '')
  if (!table) {
    return {
      kind: 'error',
      error: `No table by that name. Tables you can search: ${tables.map((t) => `"${t.name}"`).join(', ') || 'none'}.`,
    }
  }

  const dates = new Set(dateFields(table).map((f) => f.key))
  const filters = asFilters(args.filters)
  const conditions: Array<{ field: SearchField; match: Match; value: string }> = []
  for (const f of filters) {
    const field = findColumn(table, f.column)
    if (!field) {
      return { kind: 'error', error: `"${table.name}" has no column "${f.column}". Its columns: ${table.fields.map((x) => x.label).join(', ')}.` }
    }
    const match = (MATCHES as readonly string[]).includes(f.match) ? (f.match as Match) : 'is'
    conditions.push({ field, match, value: f.value })
  }
  const words = typeof args.words === 'string' ? args.words.trim() : ''

  let rows = table.rows

  // Upcoming: not yet finished. The end date when there is one, so a
  // programme already under way still counts.
  const { start, end } = startAndEnd(table)
  const upcomingField =
    (table.upcomingBy && table.fields.find((f) => f.key === table.upcomingBy)) || end || start
  const upcoming = args.upcoming_only === true || Boolean(table.upcomingBy)
  if (upcoming && upcomingField) {
    rows = rows.filter((r) => {
      const d = asDate(r.data[upcomingField.key])
      return d !== null && d >= today
    })
  }

  // Ask first: the business wants this column chosen before anything is
  // listed. Not when the customer already named something to look for.
  if (table.askFirst && !words) {
    const ask = table.fields.find((f) => f.key === table.askFirst)
    if (ask && !conditions.some((c) => c.field.key === ask.key)) {
      const choices = choicesOf(rows, ask)
      if (choices.length > 1) {
        return {
          kind: 'needs',
          table: table.name,
          needs: ask.label,
          choices,
          note: `Before listing anything, ask the customer which ${ask.label} they want, offering these: ${choices.join(', ')}. Then search again with that ${ask.label}.`,
        }
      }
    }
  }

  const before = rows
  for (const c of conditions) {
    rows = rows.filter((r) => matchesFilter(r, c.field, c.match, c.value, today, dates.has(c.field.key)))
  }
  if (words) {
    rows = rows.filter((r) => textHas(table.fields.map((f) => cellText(r.data[f.key])).join(' | '), words))
  }

  // Soonest first when the rows have dates.
  if (start) {
    rows = [...rows].sort((a, b) => (asDate(a.data[start.key]) ?? '9999').localeCompare(asDate(b.data[start.key]) ?? '9999'))
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(args.limit) || DEFAULT_LIMIT))
  const records = rows.slice(0, limit).map((r) => renderRow(table, r))

  const outcome: Extract<SearchOutcome, { kind: 'records' }> = {
    kind: 'records',
    table: table.name,
    matched: rows.length,
    shown: records.length,
    records,
    list: records.map((r) => `- ${r.line}`).join('\n'),
    how_to_show: `Write ${RECORDS_PLACEHOLDER} on its own line where these should appear; it is replaced with these exact lines. Do not retype names, dates or amounts.`,
  }

  if (rows.length === 0) {
    // What there is instead — "no programme in November; there are some
    // in September and October" needs the months that do exist.
    const available: Record<string, string[]> = {}
    for (const c of conditions) {
      const vals =
        c.match === 'in_month' || (dates.has(c.field.key) && c.match === 'is')
          ? [
              ...new Set(
                before
                  .map((r) => asDate(r.data[c.field.key]))
                  .filter(Boolean)
                  .map((d) => MONTH_ENGLISH[+d!.slice(5, 7) - 1])
                  .map((m) => m.charAt(0).toUpperCase() + m.slice(1)),
              ),
            ]
          : choicesOf(before, c.field)
      if (vals.length > 0 && vals.length <= MAX_CHOICES) available[c.field.label] = vals
    }
    outcome.note = upcoming
      ? 'Nothing upcoming matches. Say so plainly; do not offer rows that were not returned.'
      : 'Nothing matches. Say so plainly; do not offer rows that were not returned.'
    if (Object.keys(available).length) outcome.available = available
  } else if (rows.length > records.length) {
    outcome.note = `Showing ${records.length} of ${rows.length}. Tell the customer there are more and ask how to narrow it down.`
  }
  if (table.truncated) {
    outcome.note = `${outcome.note ? `${outcome.note} ` : ''}This table is very large and only its first rows were searched.`
  }
  return outcome
}

// ── The placeholder ─────────────────────────────────────────────────

const PLACEHOLDER = /\[\[\s*records\s*\]\]|\{\{\s*records\s*\}\}/gi

/** Every search result in what the tools returned this turn. */
export function searchResults(toolOutputs: readonly string[]): Array<Extract<SearchOutcome, { kind: 'records' }>> {
  const out: Array<Extract<SearchOutcome, { kind: 'records' }>> = []
  for (const o of toolOutputs) {
    try {
      const parsed = JSON.parse(o) as { kind?: string }
      if (parsed && parsed.kind === 'records') out.push(parsed as Extract<SearchOutcome, { kind: 'records' }>)
    } catch {
      /* not a search result */
    }
  }
  return out
}

/**
 * Puts the exact rows where the reply asked for them.
 *
 * The model writes [[records]]; this swaps in the lines the search
 * rendered, so a name, a date or a fee reaches the customer exactly as it
 * is stored. The last search is used — the one the reply is about. A
 * placeholder with no search behind it is removed rather than sent.
 */
export function fillRecordPlaceholders(reply: string, toolOutputs: readonly string[]): string {
  if (!PLACEHOLDER.test(reply)) return reply
  PLACEHOLDER.lastIndex = 0
  const results = searchResults(toolOutputs)
  const last = results[results.length - 1]
  const list = last && last.records.length ? last.list : ''
  return reply.replace(PLACEHOLDER, list).replace(/\n{3,}/g, '\n\n').trim()
}

/** A search's output (rows or a question to ask), as opposed to another
 *  tool's. Checked against row by row instead of as one block. */
export function isSearchOutput(output: string): boolean {
  try {
    const kind = (JSON.parse(output) as { kind?: unknown })?.kind
    return kind === 'records' || kind === 'needs'
  } catch {
    return false
  }
}

/** Each returned row as its own source unit, for checking a list the
 *  model typed itself: its line and its raw values. */
export function recordUnits(toolOutputs: readonly string[]): string[] {
  return searchResults(toolOutputs).flatMap((r) => r.records.map((rec) => `${rec.line} | ${rec.raw}`))
}
