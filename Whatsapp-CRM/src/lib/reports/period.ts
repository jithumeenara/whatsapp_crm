/**
 * Report periods, counted in the business's own days.
 *
 * "Today" in a report is today where the business is (company profile
 * timezone), not where the server happens to run — otherwise every
 * evening in India the last five and a half hours would land in
 * tomorrow. Dates travel as plain YYYY-MM-DD strings and become instants
 * only inside SQL (`date::timestamp AT TIME ZONE tz`), so there is one
 * place where a day turns into a time.
 */

import { localDate } from '@/lib/agents/zoned-time'

export const PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
  'this_year',
  'last_12_months',
] as const
export type Preset = (typeof PRESETS)[number]

export const PRESET_LABEL: Record<Preset, string> = {
  today: 'today',
  yesterday: 'yesterday',
  last_7_days: 'in the last 7 days',
  last_30_days: 'in the last 30 days',
  last_90_days: 'in the last 90 days',
  this_month: 'this month',
  last_month: 'last month',
  this_year: 'this year',
  last_12_months: 'in the last 12 months',
}

export interface PeriodSpec {
  preset?: Preset
  /** Custom range, both days included. */
  from?: string
  to?: string
}

export interface ResolvedPeriod {
  from: string
  /** The day after the last day — ranges are [from, toExclusive). */
  toExclusive: string
  days: number
  label: string
  prevFrom: string
  prevToExclusive: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Two years and a day: long enough for "this year vs last", short
 *  enough that a typo cannot ask the database for a century. */
export const MAX_DAYS = 732

function parse(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
function addDays(day: string, n: number): string {
  return format(parse(day) + n * 86_400_000)
}
function daysBetween(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / 86_400_000)
}
function isRealDay(day: string): boolean {
  return DAY.test(day) && format(parse(day)) === day
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function resolvePeriod(spec: PeriodSpec, timezone: string, now: Date = new Date()): ResolvedPeriod | null {
  const today = localDate(timezone, now) ?? localDate('Asia/Kolkata', now)!
  let from: string
  let toExclusive: string
  let label: string

  if (spec.from || spec.to) {
    if (!spec.from || !spec.to || !isRealDay(spec.from) || !isRealDay(spec.to)) return null
    if (spec.to < spec.from) return null
    from = spec.from
    toExclusive = addDays(spec.to, 1)
    label = `${shortDay(spec.from)} – ${shortDay(spec.to)}`
  } else {
    const preset = spec.preset ?? 'last_30_days'
    if (!PRESETS.includes(preset)) return null
    const tomorrow = addDays(today, 1)
    const monthStart = `${today.slice(0, 8)}01`
    switch (preset) {
      case 'today': from = today; toExclusive = tomorrow; break
      case 'yesterday': from = addDays(today, -1); toExclusive = today; break
      case 'last_7_days': from = addDays(today, -6); toExclusive = tomorrow; break
      case 'last_30_days': from = addDays(today, -29); toExclusive = tomorrow; break
      case 'last_90_days': from = addDays(today, -89); toExclusive = tomorrow; break
      case 'this_month': from = monthStart; toExclusive = tomorrow; break
      case 'last_month': {
        const prevMonthEnd = addDays(monthStart, -1)
        from = `${prevMonthEnd.slice(0, 8)}01`
        toExclusive = monthStart
        break
      }
      case 'this_year': from = `${today.slice(0, 4)}-01-01`; toExclusive = tomorrow; break
      case 'last_12_months': from = addDays(today, -364); toExclusive = tomorrow; break
    }
    label = PRESET_LABEL[preset]
  }

  const days = daysBetween(from, toExclusive)
  if (days < 1 || days > MAX_DAYS) return null
  return {
    from,
    toExclusive,
    days,
    label,
    prevFrom: addDays(from, -days),
    prevToExclusive: from,
  }
}

/** Day buckets for a month, weeks up to about six months, months beyond. */
export function bucketFor(days: number): 'day' | 'week' | 'month' {
  if (days <= 31) return 'day'
  if (days <= 186) return 'week'
  return 'month'
}

/** Every bucket start in the range, so a quiet day shows as 0, not a gap. */
export function bucketStarts(from: string, toExclusive: string, bucket: 'day' | 'week' | 'month'): string[] {
  const out: string[] = []
  if (bucket === 'day') {
    for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d)
    return out
  }
  if (bucket === 'week') {
    // Postgres date_trunc('week') starts weeks on Monday.
    const weekday = (new Date(parse(from)).getUTCDay() + 6) % 7
    for (let d = addDays(from, -weekday); d < toExclusive; d = addDays(d, 7)) out.push(d)
    return out
  }
  for (let d = `${from.slice(0, 8)}01`; d < toExclusive; ) {
    out.push(d)
    const [y, m] = d.split('-').map(Number)
    d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  }
  return out
}
