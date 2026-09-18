/**
 * Narrowing a table down to the rows somebody actually wants to see.
 *
 * ── Why there is no configuration ───────────────────────────────────
 *
 * The obvious way to build this is to let each table declare its own
 * filters, and the obvious first filter to declare is the one the
 * business in front of you happens to need — a financial year, a term,
 * a season. That is exactly the version worth not building. A training
 * institute filters by programme and month; a clinic by doctor and
 * date; a shop by category and brand; a school by class and section. No
 * fixed list survives the second industry, and a fixed list is also a
 * setup screen that somebody has to fill in before the feature does
 * anything at all.
 *
 * So the filters are read off the table's own fields. A dropdown field
 * becomes a dropdown filter, a date field becomes a from/to pair, a
 * number field becomes a min/max pair, and a table nobody has
 * configured anything for still gets a filter bar that fits it. The
 * same code serves every table in every industry because it never
 * learns what any of the columns mean.
 *
 * ── Why the options narrow as you choose ────────────────────────────
 *
 * Each dropdown offers the values that actually occur in the rows
 * surviving *the other* filters — not every value the field could hold.
 * Pick a programme and the month list collapses to the months that
 * programme runs; pick a doctor and the date list collapses to days
 * they have clinics. That is the cascade, and it falls out of one rule
 * rather than out of a chain somebody has to declare: a filter never
 * constrains its own choices, and always constrains everyone else's.
 *
 * The practical consequence is that a dead end is unreachable. You
 * cannot pick a combination that returns nothing, because a value that
 * would return nothing is not offered.
 */

import type { DataField, DataRecord } from './types'
import { getSelectItems } from './types'

/** One field's current filter. Absent from the map means "any". */
export type FilterValue =
  | { kind: 'choice'; value: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'bool'; value: 'yes' | 'no' }

export type FilterMap = Record<string, FilterValue>

/** How a field is filtered, or null when it isn't filtered at all. */
export type FilterKind = 'choice' | 'date' | 'number' | 'bool'

/**
 * Which fields get a control.
 *
 * Free text is deliberately absent: the search box above already reads
 * every column, and a second text box per column would be a worse
 * version of it. Layout and attachment types have nothing to narrow by.
 */
export function filterKindFor(field: DataField): FilterKind | null {
  switch (field.field_type) {
    case 'select':
    case 'multiselect':
    case 'radio':
    case 'country':
    case 'state':
    case 'district':
    case 'relation':
      return 'choice'
    case 'date':
    case 'datetime':
      return 'date'
    case 'number':
      return 'number'
    case 'boolean':
      return 'bool'
    default:
      return null
  }
}

export interface FilterableField {
  field: DataField
  kind: FilterKind
}

export function filterableFields(fields: DataField[]): FilterableField[] {
  const out: FilterableField[] = []
  for (const field of fields) {
    const kind = filterKindFor(field)
    if (kind) out.push({ field, kind })
  }
  return out
}

/** A stored value as a plain comparable string. Multiselect cells hold
 *  arrays; everything else holds a scalar. */
function cellValues(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return []
  if (Array.isArray(raw)) return raw.map((v) => String(v)).filter((v) => v !== '')
  return [String(raw)]
}

/**
 * A date cell as a sortable `YYYY-MM-DD`, or null when it is not a date
 * this can order.
 *
 * Three storage shapes are in play across this app's tables — an ISO
 * string, a `YYYY-MM-DD` already, and a unix timestamp from an
 * import — and a range filter that silently ignores two of them would
 * look like a filter that finds nothing.
 */
export function asComparableDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const str = String(raw)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const d = /^\d{10}$/.test(str) ? new Date(parseInt(str, 10) * 1000) : new Date(str)
  if (Number.isNaN(d.getTime())) return null
  // Local calendar date, not UTC: a from/to typed into a date input is
  // read by the person who typed it, in their own day.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** True when this one record satisfies one filter. */
function matchesOne(record: DataRecord, field: DataField, filter: FilterValue): boolean {
  const raw = (record.data as Record<string, unknown>)[field.field_key]

  if (filter.kind === 'bool') {
    const wanted = filter.value === 'yes'
    return Boolean(raw) === wanted
  }

  if (filter.kind === 'choice') {
    return cellValues(raw).includes(filter.value)
  }

  // A range with neither end set matches everything, which is what an
  // empty pair of inputs should do.
  if (!filter.from && !filter.to) return true

  if (field.field_type === 'date' || field.field_type === 'datetime') {
    const value = asComparableDate(raw)
    if (!value) return false
    if (filter.from && value < filter.from) return false
    if (filter.to && value > filter.to) return false
    return true
  }

  const num = Number(raw)
  if (raw === null || raw === undefined || raw === '' || Number.isNaN(num)) return false
  if (filter.from !== '' && num < Number(filter.from)) return false
  if (filter.to !== '' && num > Number(filter.to)) return false
  return true
}

/**
 * Every filter applied, optionally ignoring one field.
 *
 * `exceptKey` is what makes the cascade work: to decide what a field
 * should offer, apply everything *else* and look at what is left. A
 * field that constrained its own option list would let you choose a
 * value once and never change it.
 */
export function applyFilters(
  records: DataRecord[],
  fields: DataField[],
  filters: FilterMap,
  exceptKey?: string,
): DataRecord[] {
  const active = Object.entries(filters).filter(([key]) => key !== exceptKey)
  if (active.length === 0) return records

  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  return records.filter((record) =>
    active.every(([key, filter]) => {
      const field = byKey.get(key)
      // A filter left over from a field somebody has since deleted must
      // not silently hide every row.
      if (!field) return true
      return matchesOne(record, field, filter)
    }),
  )
}

export interface FilterOption {
  value: string
  label: string
  /** How many rows would remain. Shown beside the label, because "3"
   *  next to a month is the difference between picking it and guessing. */
  count: number
}

/**
 * What a dropdown should offer, given everything else that is selected.
 *
 * Values come from the rows themselves rather than from the field's
 * configured option list, which is the whole point: a table may list
 * twelve programmes and be running two. Labels still come from the
 * configured list where one exists, so a stored id shows as its name.
 *
 * The currently selected value is always included even if nothing else
 * selects it, so a choice never disappears out from under the person
 * who made it.
 */
export function optionsFor(
  field: DataField,
  records: DataRecord[],
  fields: DataField[],
  filters: FilterMap,
): FilterOption[] {
  const scope = applyFilters(records, fields, filters, field.field_key)

  const counts = new Map<string, number>()
  for (const record of scope) {
    for (const value of cellValues((record.data as Record<string, unknown>)[field.field_key])) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }

  const selected = filters[field.field_key]
  if (selected?.kind === 'choice' && !counts.has(selected.value)) {
    counts.set(selected.value, 0)
  }

  const labels = new Map(getSelectItems(field.options).map((o) => [o.value, o.label]))

  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: labels.get(value) ?? value, count }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }))
}

/** How many filters are actually narrowing anything — a range with both
 *  ends blank is set but not narrowing, and counting it would leave a
 *  badge showing "1" over a table nobody has filtered. */
export function activeFilterCount(filters: FilterMap): number {
  return Object.values(filters).filter((f) =>
    f.kind === 'range' ? Boolean(f.from || f.to) : true,
  ).length
}
