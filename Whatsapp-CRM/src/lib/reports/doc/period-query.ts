/**
 * The period and comparison every report page shares, read from the URL
 * (docs/plans/reports-sections-plan.md §5): Today · This week · This month ·
 * Dates, and under "More" the finished periods — Yesterday, Last week,
 * Last month, Last 7 / 30 days, This year. Compare with the period before
 * (default), the same days last year, or nothing.
 *
 * Built on resolvePeriod (period.ts) without changing it: the extra periods
 * become custom day ranges in the business's zone, so the fair-comparison
 * rule (a running period against the same elapsed part of the one before)
 * holds everywhere. Pure: the caller passes now.
 */

import { dayKey } from '@/lib/audit/zoned'
import { resolvePeriod, type ReportPeriod } from '../period'

export const PERIOD_KINDS = ['today', 'week', 'month', 'yesterday', 'last_week', 'last_month', 'last_7', 'last_30', 'year', 'custom'] as const
export type PeriodQueryKind = (typeof PERIOD_KINDS)[number]
export const COMPARE_KINDS = ['previous', 'year', 'none'] as const
export type CompareKind = (typeof COMPARE_KINDS)[number]

export interface ResolvedQuery {
  kind: PeriodQueryKind
  compare: CompareKind
  /** prevFrom/prevTo follow `compare`; with "none" they are an empty window. */
  period: ReportPeriod
  /** The comparison's own days, for the screen; null with "none". */
  previousDays: { firstDay: string; lastDay: string } | null
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(day, -((wd + 6) % 7))
}

/** The same calendar day a year earlier; 29 Feb becomes 28 Feb. */
export function lastYear(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y - 1, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return new Date(Date.UTC(y - 1, m, 0)).toISOString().slice(0, 10)
  return dt.toISOString().slice(0, 10)
}

/** The day range a named period covers. Null for a kind resolvePeriod handles itself. */
export function rangeFor(kind: PeriodQueryKind, today: string): { from: string; to: string } | null {
  switch (kind) {
    case 'yesterday': {
      const y = addDays(today, -1)
      return { from: y, to: y }
    }
    case 'last_week': {
      const thisMonday = weekStart(today)
      return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) }
    }
    case 'last_month': {
      const first = `${today.slice(0, 7)}-01`
      const [y, m] = first.split('-').map(Number)
      const prevFirst = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
      return { from: prevFirst, to: addDays(first, -1) }
    }
    case 'last_7':
      return { from: addDays(today, -6), to: today }
    case 'last_30':
      return { from: addDays(today, -29), to: today }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    default:
      return null
  }
}

/**
 * The query → a period with its comparison. Null when the dates are not
 * usable (wrong order, too long, in the future); the caller answers 400.
 */
export function resolveQuery(q: { period?: string | null; from?: string | null; to?: string | null; compare?: string | null }, now: Date, tz: string): ResolvedQuery | null {
  const kind = (PERIOD_KINDS as readonly string[]).includes(q.period ?? '') ? (q.period as PeriodQueryKind) : 'week'
  const compare = (COMPARE_KINDS as readonly string[]).includes(q.compare ?? '') ? (q.compare as CompareKind) : 'previous'
  const today = dayKey(now, tz)

  let base: ReportPeriod | null
  if (kind === 'today' || kind === 'week' || kind === 'month') base = resolvePeriod({ kind }, now, tz)
  else if (kind === 'custom') base = resolvePeriod({ kind: 'custom', from: q.from ?? '', to: q.to ?? '' }, now, tz)
  else {
    const r = rangeFor(kind, today)
    base = r ? resolvePeriod({ kind: 'custom', from: r.from, to: r.to }, now, tz) : null
  }
  if (!base) return null

  if (compare === 'none') {
    return { kind, compare, period: { ...base, prevFrom: base.from, prevTo: base.from }, previousDays: null }
  }
  if (compare === 'year') {
    const pFirst = lastYear(base.firstDay)
    const pLast = lastYear(base.lastDay)
    const shifted = resolvePeriod({ kind: 'custom', from: pFirst, to: pLast }, now, tz)
    if (!shifted) return { kind, compare: 'none', period: { ...base, prevFrom: base.from, prevTo: base.from }, previousDays: null }
    // A running period is compared with the same elapsed part of last year's days.
    const elapsed = base.to.getTime() - base.from.getTime()
    const prevTo = new Date(Math.min(shifted.from.getTime() + elapsed, shifted.to.getTime()))
    return { kind, compare, period: { ...base, prevFrom: shifted.from, prevTo }, previousDays: { firstDay: pFirst, lastDay: pLast } }
  }
  const len = Math.round((Date.UTC(+base.lastDay.slice(0, 4), +base.lastDay.slice(5, 7) - 1, +base.lastDay.slice(8, 10)) - Date.UTC(+base.firstDay.slice(0, 4), +base.firstDay.slice(5, 7) - 1, +base.firstDay.slice(8, 10))) / 86_400_000) + 1
  // "This month" compares with last month's first days (period.ts); others with the same number of days before.
  const prevFirst = kind === 'month' || kind === 'last_month'
    ? new Date(Date.UTC(+base.firstDay.slice(0, 4), +base.firstDay.slice(5, 7) - 2, 1)).toISOString().slice(0, 10)
    : addDays(base.firstDay, -len)
  const prevLast = kind === 'last_month' ? addDays(base.firstDay, -1) : addDays(prevFirst, len - 1)
  return { kind, compare, period: base, previousDays: { firstDay: prevFirst, lastDay: prevLast } }
}

/** A period whose main window is this one's comparison window (to build "before" rows). */
export function previousAsMain(p: ReportPeriod): ReportPeriod {
  return { ...p, from: p.prevFrom, to: p.prevTo, prevFrom: p.prevFrom, prevTo: p.prevFrom }
}
