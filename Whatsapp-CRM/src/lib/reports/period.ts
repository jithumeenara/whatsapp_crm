/**
 * The time window a report covers, in the business's own time zone, and
 * the window it is fairly compared with (docs/plans/reports-plan.md §5).
 *
 * "This month" on the 7th is compared with the first 7 days of last
 * month, never with all of last month: a part-finished period against a
 * finished one always looks like a collapse. Pure: the caller passes now.
 */

import { dayEndIso, dayKey, dayStartIso } from '@/lib/audit/zoned'

export const PERIODS = ['today', 'week', 'month', 'custom'] as const
export type PeriodKind = (typeof PERIODS)[number]

export interface ReportPeriod {
  kind: PeriodKind
  from: Date
  /** Exclusive. For a period still running, this is now. */
  to: Date
  prevFrom: Date
  prevTo: Date
  /** First and last calendar day covered, "YYYY-MM-DD", in the zone. */
  firstDay: string
  lastDay: string
  /** Still running: the comparison is to the same elapsed time. */
  partial: boolean
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** A custom range longer than this is refused; a year answers most questions. */
export const MAX_CUSTOM_DAYS = 366

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((t(b) - t(a)) / 86_400_000)
}

const start = (day: string, tz: string) => new Date(dayStartIso(day, tz) as string)
const end = (day: string, tz: string) => new Date(dayEndIso(day, tz) as string)

/** Monday of the week the day falls in. */
function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(day, -((wd + 6) % 7))
}

export type PeriodInput =
  | { kind: 'today' | 'week' | 'month' }
  | { kind: 'custom'; from: string; to: string }

/** Null when a custom range is not two valid days in order, or too long. */
export function resolvePeriod(input: PeriodInput, now: Date, tz: string): ReportPeriod | null {
  const today = dayKey(now, tz)

  if (input.kind === 'custom') {
    const { from, to } = input
    if (!DAY.test(from) || !DAY.test(to) || !dayStartIso(from, tz) || !dayStartIso(to, tz)) return null
    const len = daysBetween(from, to) + 1
    if (len < 1 || len > MAX_CUSTOM_DAYS) return null
    const lastDay = to > today ? today : to
    const partial = to >= today
    const f = start(from, tz)
    const t = partial ? now : end(to, tz)
    const prevFirst = addDays(from, -len)
    const pf = start(prevFirst, tz)
    return { kind: 'custom', from: f, to: t, prevFrom: pf, prevTo: new Date(pf.getTime() + (t.getTime() - f.getTime())), firstDay: from, lastDay, partial }
  }

  if (input.kind === 'today') {
    const f = start(today, tz)
    const pf = start(addDays(today, -1), tz)
    return { kind: 'today', from: f, to: now, prevFrom: pf, prevTo: new Date(pf.getTime() + (now.getTime() - f.getTime())), firstDay: today, lastDay: today, partial: true }
  }

  if (input.kind === 'week') {
    const first = weekStart(today)
    const f = start(first, tz)
    const pf = start(addDays(first, -7), tz)
    return { kind: 'week', from: f, to: now, prevFrom: pf, prevTo: new Date(pf.getTime() + (now.getTime() - f.getTime())), firstDay: first, lastDay: today, partial: true }
  }

  // Month to date, against the same days of last month (cut at its end).
  const first = `${today.slice(0, 7)}-01`
  const f = start(first, tz)
  const [y, m] = first.split('-').map(Number)
  const prevFirst = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
  const pf = start(prevFirst, tz)
  const prevMonthEnd = f
  const elapsed = now.getTime() - f.getTime()
  const pt = new Date(Math.min(pf.getTime() + elapsed, prevMonthEnd.getTime()))
  return { kind: 'month', from: f, to: now, prevFrom: pf, prevTo: pt, firstDay: first, lastDay: today, partial: true }
}
