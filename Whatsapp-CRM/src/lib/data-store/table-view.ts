/**
 * How a Data Store table is presented — decided from the table's own
 * fields and rows, never from column names a particular business uses.
 * The same rules lay out a training register, a clinic's bookings and a
 * shop's orders. Pure: tested on plain objects.
 */

import type { DataField, DataRecord } from './types'
import { getSelectItems } from './types'
import { filterableFields } from './filters'

const TEXTUAL = new Set(['text', 'textarea'])

function values(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return []
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean)
  if (typeof raw === 'object') {
    const o = raw as { label?: unknown; name?: unknown }
    const s = String(o.label ?? o.name ?? '').trim()
    return s ? [s] : []
  }
  return [String(raw).trim()].filter(Boolean)
}

/** The configured label for a stored choice ("sup" → "Supervisory Staff"). */
export function choiceLabel(field: DataField, raw: string): string {
  return getSelectItems(field.options).find((o) => o.value === raw)?.label ?? raw
}

/**
 * What a row is called: a text field named like a name ("Name of
 * Participant", "Customer name", "Patient"), else the first text field
 * that is filled in most rows. Null when the table has no text field.
 */
export function pickTitleField(fields: readonly DataField[], records: readonly DataRecord[] = []): DataField | null {
  const text = fields.filter((f) => TEXTUAL.has(f.field_type))
  const named = text.find((f) => /\bname\b|participant|customer|patient|student|member|client/i.test(f.label) && !/society|bank|company|institution|school|organi[sz]ation|father|mother|guardian/i.test(f.label))
  if (named) return named
  if (text.length === 0) return null
  const filled = (f: DataField) => records.filter((r) => values((r.data as Record<string, unknown>)[f.field_key]).length > 0).length
  return [...text].sort((a, b) => filled(b) - filled(a))[0]
}

/** A second line under the name: the next short text field (a role, a
 *  company) — not one already shown as a chip beside it. */
export function pickSubtitleField(fields: readonly DataField[], title: DataField | null, exclude: ReadonlySet<string> = new Set()): DataField | null {
  if (!title) return null
  return fields.find((f) => f.field_type === 'text' && f.field_key !== title.field_key && !exclude.has(f.field_key)) ?? null
}

/** "Faisal A" → "FA"; Malayalam or other scripts → first letter. */
export function initials(name: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0])[0] ?? ''
  const second = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : Array.from(parts[0])[1] ?? ''
  return (first + (/[a-z]/i.test(second) ? second : '')).toUpperCase()
}

/** Soft background + dark text, same hue — chosen by the value, so the same
 *  choice has the same colour in every row and every visit. */
export const CHIP_TONES = [
  'bg-emerald-50 text-emerald-700 ring-emerald-100',
  'bg-sky-50 text-sky-700 ring-sky-100',
  'bg-violet-50 text-violet-700 ring-violet-100',
  'bg-amber-50 text-amber-800 ring-amber-100',
  'bg-rose-50 text-rose-700 ring-rose-100',
  'bg-teal-50 text-teal-700 ring-teal-100',
  'bg-indigo-50 text-indigo-700 ring-indigo-100',
  'bg-orange-50 text-orange-700 ring-orange-100',
] as const

export function chipTone(value: string): string {
  let h = 0
  const s = value.trim().toLowerCase()
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return CHIP_TONES[h % CHIP_TONES.length]
}

/** Fields shown as coloured chips in the grid: choices, and text columns
 *  that repeat a few values (Target group, Month). */
export function chipFieldKeys(fields: readonly DataField[], records: readonly DataRecord[]): Set<string> {
  return new Set(
    filterableFields([...fields], [...records])
      .filter((f) => f.kind === 'choice')
      // A text column is a category only when it repeats a lot (Target
      // group: 3 values in 14 rows) — not a Designation that differs per row.
      .filter((f) => {
        if (f.field.field_type !== 'text') return true
        const seen = new Set<string>()
        let filled = 0
        for (const r of records) for (const v of values((r.data as Record<string, unknown>)[f.field.field_key])) { seen.add(v.toLowerCase()); filled++ }
        return filled > 0 && seen.size <= Math.max(2, Math.floor(filled / 3))
      })
      .map((f) => f.field.field_key),
  )
}

export type StatTone = 'total' | 'a' | 'b' | 'c' | 'd' | 'e'

export interface StatCard {
  key: string
  label: string
  value: number
  /** Share of all rows, 0–1, for a group card's bar. */
  share?: number
  /** Clicking narrows the table to this. */
  filter?: { field_key: string; value: string }
  tone: StatTone
}

/** What the person chose for the cards (Customize). Empty = automatic. */
export interface StatChoice {
  /** The column the group cards count by. */
  groupField?: string
  /** Which of its values get a card, in order (at most 4). */
  values?: string[]
  /** The "how many different …" card: a column, or null for none. */
  spreadField?: string | null
}

export const STAT_MAX_VALUES = 4
const GROUP_TONES: StatTone[] = ['a', 'b', 'd', 'e']

function countsFor(f: DataField, records: readonly DataRecord[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of records) for (const v of values((r.data as Record<string, unknown>)[f.field_key])) m.set(v, (m.get(v) ?? 0) + 1)
  return m
}

/** The columns cards can count by, each with its values, biggest first. */
export function statGroupOptions(fields: readonly DataField[], records: readonly DataRecord[]): Array<{ field: DataField; values: Array<{ value: string; label: string; count: number }> }> {
  return filterableFields([...fields], [...records])
    .filter((f) => f.kind === 'choice')
    .map((f) => ({
      field: f.field,
      values: [...countsFor(f.field, records).entries()]
        .map(([value, count]) => ({ value, label: choiceLabel(f.field, value), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }))
    .filter((o) => o.values.length > 0)
}

/**
 * The cards above the table: the total, groups of one choice column
 * (chosen, or the first that splits the rows into a few groups — months,
 * statuses), and how many different values another column has (districts).
 */
export function statCards(fields: readonly DataField[], records: readonly DataRecord[], choice: StatChoice = {}): StatCard[] {
  const cards: StatCard[] = [{ key: 'total', label: 'Total', value: records.length, tone: 'total' }]
  if (records.length === 0) return cards
  const options = statGroupOptions(fields, records)
  const chosen = choice.groupField ? options.find((o) => o.field.field_key === choice.groupField) : undefined
  const grouping = chosen ?? options.find((o) => o.values.length >= 2 && o.values.length <= 12)
  if (grouping) {
    const picked = chosen && choice.values?.length
      ? choice.values.slice(0, STAT_MAX_VALUES).map((v) => grouping.values.find((x) => x.value === v) ?? { value: v, label: choiceLabel(grouping.field, v), count: 0 })
      : grouping.values.slice(0, chosen ? STAT_MAX_VALUES : 2)
    picked.forEach((v, i) => cards.push({
      key: `g:${v.value}`, label: v.label, value: v.count, share: v.count / records.length,
      filter: { field_key: grouping.field.field_key, value: v.value }, tone: GROUP_TONES[i % GROUP_TONES.length],
    }))
  }
  if (choice.spreadField === null) return cards
  // "How many places": the chosen column, else district / state / country, else any other.
  const others = options.filter((o) => o.field.field_key !== grouping?.field.field_key && o.values.length >= 2)
  const spread = choice.spreadField
    ? options.find((o) => o.field.field_key === choice.spreadField)
    : others.find((o) => ['district', 'state', 'country'].includes(o.field.field_type)) ?? others[0]
  if (spread) cards.push({ key: `d:${spread.field.field_key}`, label: plural(spread.field.label), value: spread.values.length, tone: 'c' })
  return cards
}

function plural(label: string): string {
  const l = label.trim()
  if (/s$/i.test(l)) return l
  if (/[^aeiou]y$/i.test(l)) return l.slice(0, -1) + 'ies'
  return l + 's'
}

/** The choice columns offered as quick dropdowns beside the search box. */
export function quickFilterFields(fields: readonly DataField[], records: readonly DataRecord[], max = 3): DataField[] {
  return filterableFields([...fields], [...records])
    .filter((f) => f.kind === 'choice')
    .map((f) => f.field)
    .filter((f) => {
      const seen = new Set<string>()
      for (const r of records) for (const v of values((r.data as Record<string, unknown>)[f.field_key])) seen.add(v)
      return seen.size >= 2 && seen.size <= 60
    })
    .slice(0, max)
}

/** Rows as CSV text, Excel-friendly: quotes doubled, every cell quoted,
 *  a byte-order mark so Malayalam opens correctly, and a leading = + - @
 *  neutralised so a cell can never run as a formula in Excel. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const cell = (v: string) => {
    let s = String(v ?? '')
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return `"${s.replace(/"/g, '""')}"`
  }
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

/** Page buttons: 1 … 4 5 6 … 20 — never more than seven. */
export function pageList(current: number, count: number): Array<number | '…'> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const out: Array<number | '…'> = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(count - 1, current + 1)
  if (from > 2) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < count - 1) out.push('…')
  out.push(count)
  return out
}

/**
 * How a stored value reads on screen: "october" → "October",
 * "sub-staff" → "Sub-staff". Only plain lower-case Latin text is touched;
 * "MDP", "iPhone", Malayalam and anything already capitalised stay as typed.
 * Display only — the data is never changed.
 */
export function prettyValue(v: string): string {
  const s = String(v ?? '')
  return /^[a-z][a-z0-9 .,'&()/-]*$/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s
}
