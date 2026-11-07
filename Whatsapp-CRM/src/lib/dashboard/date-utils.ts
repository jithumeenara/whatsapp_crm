// Centralised date helpers for the dashboard so every chart / card
// agrees on what "today", "day boundary", and "day of week" mean.
// All boundaries are computed in the user's LOCAL timezone — which is
// what a business user intuitively expects when they say "today".
// Server code must use the zoned* helpers at the bottom instead.

import { dayKey, dayStartIso } from '@/lib/audit/zoned'

export function startOfLocalDay(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function daysAgoStart(days: number): Date {
  const out = startOfLocalDay()
  out.setDate(out.getDate() - days)
  return out
}

/** Date-only key (YYYY-MM-DD) for bucketing rows by local calendar day. */
export function localDayKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Inclusive list of local-day keys spanning the last `n` days, in
 * chronological order. Useful for seeding chart buckets so days with
 * zero activity still render a 0-point in the line.
 */
export function lastNDayKeys(n: number): string[] {
  const keys: string[] = []
  const start = daysAgoStart(n - 1)
  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    keys.push(localDayKey(d))
  }
  return keys
}

/**
 * ISO day-of-week where 0 = Monday … 6 = Sunday. JavaScript's native
 * getDay() uses 0 = Sunday which is awkward for most business charts.
 */
export function mondayIndex(d: Date): number {
  const jsDow = d.getDay() // 0..6 with Sunday=0
  return (jsDow + 6) % 7
}

export const DOW_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

// --- Business-zone days (server side) ----------------------------------
//
// The helpers above use the clock of whatever machine runs them. On a
// server that is the VPS's zone (often UTC), not the business's, so a
// day in India began at 05:30 IST. Server code cuts days with these
// instead, passing `businessTimezone(accountId)` (AGENTS.md rule 10).

/** "2026-11-08" moved by n calendar days. */
function shiftDayKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Midnight in the zone, `daysAgo` calendar days before the zone's today. */
export function zonedDaysAgoStart(daysAgo: number, timeZone: string, now: Date = new Date()): Date {
  const key = shiftDayKey(dayKey(now, timeZone), -daysAgo)
  return new Date(dayStartIso(key, timeZone) as string)
}

/** The last `n` calendar days in the zone, oldest first, ending today. */
export function zonedLastNDayKeys(n: number, timeZone: string, now: Date = new Date()): string[] {
  const today = dayKey(now, timeZone)
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) keys.push(shiftDayKey(today, -i))
  return keys
}

/** 0 = Monday … 6 = Sunday, for the day the instant falls on in the zone. */
export function zonedMondayIndex(d: Date, timeZone: string): number {
  const jsDow = new Date(`${dayKey(d, timeZone)}T00:00:00Z`).getUTCDay()
  return (jsDow + 6) % 7
}
