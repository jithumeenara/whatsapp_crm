/**
 * What every report builder shares: who is asking, the period, and small
 * helpers that turn numbers into ReportDoc pieces with their comparison.
 */

import { formatAmount } from '@/lib/format/money'
import type { Compared, Fmt, KpiItem, ReportPeriodInfo, TableCell, Tone } from '../types'
import { changeLabel, judgeChange } from '../change'
import type { ResolvedQuery } from '../period-query'

export interface ReportContext {
  accountId: string
  /** The person whose numbers these are; null for the whole team. Decided by the role, never the request. */
  userId: string | null
  role: string
  tz: string
  now: Date
  q: ResolvedQuery
  /** One person's Agent report card: whose (userId above is the same id),
   *  and whether they are looking at their own. Null/absent = no card. */
  subject?: { userId: string; name: string | null; self: boolean } | null
}

export const COUNT: Fmt = { kind: 'count' }
export const PERCENT: Fmt = { kind: 'percent', digits: 1 }
export const MINUTES: Fmt = { kind: 'minutes' }
export const moneyFmt = (currency: string): Fmt => ({ kind: 'money', currency })

export const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-IN').format(Math.round(n)))
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)
export const pctText = (v: number | null) => (v == null ? '—' : `${v}%`)
export const money = (v: number | null | undefined, currency: string) => (v == null || !Number.isFinite(v) ? '—' : formatAmount(v, currency))

/** Under this many on both sides, a change says little: shown faded. */
export const SMALL_TOTAL = 10

/** A figure card with its comparison. */
export function kpi(
  label: string,
  now: number | null,
  before: number | null,
  o: { fmt?: Fmt; higherIsBetter?: boolean; sub?: string; href?: string; tone?: Tone; display?: string } = {},
): KpiItem {
  const fmt = o.fmt ?? COUNT
  const value = o.display ?? show(now, fmt)
  const compare: Compared & { fmt: Fmt } | undefined = before === null && now === null
    ? undefined
    : {
        now, before, fmt,
        higherIsBetter: o.higherIsBetter ?? true,
        small: fmt.kind === 'count' ? (now ?? 0) + (before ?? 0) < SMALL_TOTAL : undefined,
      }
  return { label, value, compare: before === null ? undefined : compare, sub: o.sub, href: o.href, tone: o.tone }
}

export function show(v: number | null, fmt: Fmt): string {
  if (v == null) return '—'
  switch (fmt.kind) {
    case 'percent': return `${v.toFixed(fmt.digits ?? 1).replace(/\.0$/, '')}%`
    case 'money': return money(v, fmt.currency)
    case 'minutes': return v < 60 ? `${Math.round(v)} min` : `${Math.round((v / 60) * 10) / 10} h`
    case 'text': return String(v)
    default: return num(v)
  }
}

export function cell(text: string, value?: number | string | null, tone?: Tone, href?: string): TableCell {
  return { text, value: value ?? null, tone, href }
}

/** A table's change cell, by the shared rule (change.ts): "+35%", "+4 pts"
 *  for a percentage, "11.6× before", or "Too few" from a small count. */
export function changeCell(now: number | null, before: number | null, higherIsBetter = true, fmt: Fmt = COUNT): TableCell {
  const ch = judgeChange({ now, before, higherIsBetter, fmt })
  if (ch.kind === 'none') return cell('—')
  if (ch.kind === 'small') return cell('Too few')
  const text = changeLabel(ch, (v) => show(v, fmt)) ?? '—'
  return cell(text, ch.kind === 'pct' || ch.kind === 'same' ? ch.value : null, ch.tone ?? undefined)
}

export function periodInfo(c: ReportContext): ReportPeriodInfo {
  return {
    kind: c.q.kind,
    firstDay: c.q.period.firstDay,
    lastDay: c.q.period.lastDay,
    timeZone: c.tz,
    previous: c.q.previousDays,
    partial: c.q.period.partial,
  }
}

/** A short "D Mon" label for a day key. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** "whatsapp" → "Whatsapp", "phone_call" → "Phone call". */
export function words(key: string): string {
  const w = key.replace(/[_-]+/g, ' ').trim()
  return w ? w[0].toUpperCase() + w.slice(1) : key
}

/** Money list (one entry per currency) → total in one currency, others left out. */
export function moneyIn(list: Array<{ currency: string; amount: number }>, currency: string): number {
  return list.filter((m) => m.currency === currency).reduce((s, m) => s + m.amount, 0)
}

export function mainCurrency(lists: Array<Array<{ currency: string; amount: number }>>): string {
  for (const l of lists) for (const m of l) if (m.amount > 0) return m.currency
  return 'INR'
}

/** Query string to carry period and comparison onto links between reports. */
export function carryQuery(c: ReportContext): string {
  const p = new URLSearchParams({ period: c.q.kind, compare: c.q.compare })
  if (c.q.kind === 'custom') {
    p.set('from', c.q.period.firstDay)
    p.set('to', c.q.period.lastDay)
  }
  return p.toString()
}
