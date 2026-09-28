/**
 * Data health: the mistakes in a table that make the assistant — and
 * anybody filtering the table — give wrong answers.
 *
 *  - One value spelt several ways: "Sub staff", "sub-staff", "Sub-Staff";
 *    "Oct", "October", "ഒക്ടോബർ". A filter on one spelling misses the
 *    rows with the others.
 *  - A month column that disagrees with the row's own date: Month says
 *    september, Date from says 12 October. Ask for October and the row
 *    is missed, or found under the wrong month.
 *  - Date cells nobody can read, and required cells left empty.
 *
 * Only true duplicates are grouped — the same after case, spacing and
 * punctuation, or the same month. Values that are merely alike are left
 * alone on purpose: "STP (M)" and "STP (S)" differ by one letter and are
 * different programmes.
 *
 * Pure: the route loads the rows and applies the fixes.
 */

import { monthOf, normalizeMalayalam, MONTH_ENGLISH } from '@/lib/ai/term-bridge'
import { asDate } from '@/lib/ai/table-search'

export interface HealthField {
  field_key: string
  label: string
  field_type: string
  required: boolean
  options?: string[]
}

export interface HealthRow {
  id: string
  data: Record<string, unknown>
}

export type HealthIssue =
  | {
      kind: 'spellings'
      field_key: string
      label: string
      /** Each group: the spelling to keep and the others, with row counts. */
      groups: Array<{ keep: string; others: Array<{ value: string; rows: number }> }>
    }
  | {
      kind: 'month_mismatch'
      field_key: string
      label: string
      date_label: string
      rows: Array<{ id: string; value: string; should_be: string }>
    }
  | { kind: 'unreadable_dates'; field_key: string; label: string; count: number; examples: string[] }
  | { kind: 'empty_required'; field_key: string; label: string; count: number }

/** Choice-like columns hold at most this many different values. */
const MAX_DISTINCT = 40
const MONTH_LABEL = /month|മാസ/i
const START_LABEL = /\b(from|start|begin)|തുടക്ക|മുതൽ/i

function text(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'object') return ''
  return String(raw).trim()
}

/** Two spellings of one value share this key. */
export function valueKey(value: string): string {
  const month = monthOf(value)
  if (month !== null && value.trim().split(/\s+/).length <= 2) return `month:${month}`
  return normalizeMalayalam(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function isDateType(f: HealthField): boolean {
  return f.field_type === 'date' || f.field_type === 'datetime'
}

function spellings(field: HealthField, rows: HealthRow[]): HealthIssue | null {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const t = text(r.data[field.field_key])
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  if (counts.size < 2 || counts.size > MAX_DISTINCT) return null

  const byKey = new Map<string, Array<{ value: string; rows: number }>>()
  for (const [value, n] of counts) {
    const k = valueKey(value)
    if (!k) continue
    const list = byKey.get(k) ?? []
    list.push({ value, rows: n })
    byKey.set(k, list)
  }

  const options = new Set(field.options ?? [])
  const groups = [...byKey.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      // Keep one of the column's own options if there is one, else the
      // spelling most rows already use.
      const sorted = [...g].sort((a, b) => Number(options.has(b.value)) - Number(options.has(a.value)) || b.rows - a.rows)
      return { keep: sorted[0].value, others: sorted.slice(1) }
    })
  return groups.length ? { kind: 'spellings', field_key: field.field_key, label: field.label, groups } : null
}

/** How a month is written in this column already: "october", "October",
 *  "Oct" or "ഒക്ടോബർ" — so a fix matches the rest of the column. */
function monthIn(style: string[], month: number, options: string[]): string {
  const fromOptions = options.find((o) => monthOf(o) === month)
  if (fromOptions) return fromOptions
  const english = MONTH_ENGLISH[month - 1]
  const sample = style.find((s) => monthOf(s) !== null) ?? english
  if (/[\u0D00-\u0D7F]/.test(sample)) return english
  if (sample.length <= 4) return english.slice(0, 3).replace(/^./, (c) => (sample[0] === sample[0].toUpperCase() ? c.toUpperCase() : c))
  return sample[0] === sample[0].toUpperCase() ? english.charAt(0).toUpperCase() + english.slice(1) : english
}

function monthMismatch(fields: HealthField[], rows: HealthRow[]): HealthIssue[] {
  const dates = fields.filter(isDateType)
  if (dates.length === 0) return []
  const start = dates.find((f) => START_LABEL.test(f.label)) ?? dates[0]

  const out: HealthIssue[] = []
  for (const f of fields) {
    if (isDateType(f) || !MONTH_LABEL.test(f.label)) continue
    const values = rows.map((r) => text(r.data[f.field_key])).filter(Boolean)
    if (values.length === 0 || values.filter((v) => monthOf(v) !== null).length < values.length * 0.8) continue

    const bad: Array<{ id: string; value: string; should_be: string }> = []
    for (const r of rows) {
      const value = text(r.data[f.field_key])
      const date = asDate(r.data[start.field_key])
      if (!value || !date) continue
      const month = Number(date.slice(5, 7))
      if (monthOf(value) !== month) bad.push({ id: r.id, value, should_be: monthIn(values, month, f.options ?? []) })
    }
    if (bad.length) out.push({ kind: 'month_mismatch', field_key: f.field_key, label: f.label, date_label: start.label, rows: bad })
  }
  return out
}

export function findHealthIssues(fields: HealthField[], rows: HealthRow[]): HealthIssue[] {
  const issues: HealthIssue[] = []

  for (const f of fields) {
    if (f.field_type === 'select' || f.field_type === 'text') {
      const s = spellings(f, rows)
      if (s) issues.push(s)
    }
    if (isDateType(f)) {
      const unreadable = rows.map((r) => text(r.data[f.field_key])).filter((t) => t && asDate(t) === null)
      if (unreadable.length) {
        issues.push({ kind: 'unreadable_dates', field_key: f.field_key, label: f.label, count: unreadable.length, examples: [...new Set(unreadable)].slice(0, 5) })
      }
    }
    if (f.required) {
      const empty = rows.filter((r) => !text(r.data[f.field_key]) && !Array.isArray(r.data[f.field_key])).length
      if (empty) issues.push({ kind: 'empty_required', field_key: f.field_key, label: f.label, count: empty })
    }
  }

  issues.push(...monthMismatch(fields, rows))
  return issues
}

/** The rows a merge would change: every row whose value is one of
 *  `from` and shares `to`'s key. Values of another key are never
 *  touched, whatever was asked. */
export function mergeChanges(
  field: HealthField,
  rows: HealthRow[],
  from: readonly string[],
  to: string,
): Array<{ id: string; data: Record<string, unknown> }> {
  const key = valueKey(to)
  const wanted = new Set(from.filter((v) => v !== to && valueKey(v) === key))
  return rows
    .filter((r) => wanted.has(text(r.data[field.field_key])))
    .map((r) => ({ id: r.id, data: { ...r.data, [field.field_key]: to } }))
}

/** The rows a month fix would change, each set to its own date's month. */
export function monthFixChanges(
  fields: HealthField[],
  rows: HealthRow[],
  fieldKey: string,
): Array<{ id: string; data: Record<string, unknown> }> {
  const issue = monthMismatch(fields, rows).find(
    (i): i is Extract<HealthIssue, { kind: 'month_mismatch' }> => i.kind === 'month_mismatch' && i.field_key === fieldKey,
  )
  if (!issue) return []
  const byId = new Map(rows.map((r) => [r.id, r]))
  return issue.rows.map((b) => ({ id: b.id, data: { ...byId.get(b.id)!.data, [fieldKey]: b.should_be } }))
}
