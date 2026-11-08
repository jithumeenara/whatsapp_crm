/**
 * Small pure helpers for the Leads "Tasks" tab and the drill-down links the
 * dashboard uses (follow-ups ?due=, calls ?status=&day=). No React, no
 * clock of its own: callers pass `now` and the business time zone.
 */

import { dayEndIso, dayKey, dayStartIso } from '@/lib/audit/zoned'

const FALLBACK_ZONE = 'Asia/Kolkata'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export type TaskGroupKey = 'overdue' | 'today' | 'new'

export function parseTaskGroup(raw: string | null | undefined): TaskGroupKey | null {
  return raw === 'overdue' || raw === 'today' || raw === 'new' ? raw : null
}

function span(ms: number): string {
  if (ms >= DAY) {
    const d = Math.floor(ms / DAY)
    return `${d} ${d === 1 ? 'day' : 'days'}`
  }
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)} h`
  return `${Math.max(1, Math.floor(ms / MIN))} min`
}

function elapsed(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const ms = now.getTime() - t
  return ms > 0 ? ms : null
}

/** "5 min late", "2 h late", "3 days late"; empty when not late. */
export function lateLabel(dueIso: string | null | undefined, now: Date): string {
  const ms = elapsed(dueIso, now)
  return ms === null ? '' : `${span(ms)} late`
}

/** "Waiting 3 h" for a lead nobody has started on. */
export function waitingLabel(sinceIso: string | null | undefined, now: Date): string {
  const ms = elapsed(sinceIso, now)
  return ms === null ? '' : `Waiting ${span(ms)}`
}

function validZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return zone
  } catch {
    return FALLBACK_ZONE
  }
}

/** "4:30 pm" in the business zone (never the browser's). */
export function formatDueTime(iso: string | null | undefined, zone: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: validZone(zone),
  })
    .format(d)
    .replace(/\s/g, ' ')
    .toLowerCase()
}

/** "12 open leads · 5 pending follow-ups": two numbers, never added. */
export function summaryLine(pendingLeads: number, pendingFollowUps: number): string {
  const leads = `${pendingLeads} open ${pendingLeads === 1 ? 'lead' : 'leads'}`
  const fus = `${pendingFollowUps} pending ${pendingFollowUps === 1 ? 'follow-up' : 'follow-ups'}`
  return `${leads} · ${fus}`
}

/** "Showing 8 of 23", empty when everything is already shown. */
export function showingLabel(shown: number, total: number): string {
  return total > shown && shown > 0 ? `Showing ${shown.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}` : ''
}

export type DueFilter = 'overdue' | 'today' | 'next7'

export function parseDueFilter(raw: string | null | undefined): DueFilter | null {
  return raw === 'overdue' || raw === 'today' || raw === 'next7' ? raw : null
}

/** Today in the business zone: start of the day (inclusive) to start of tomorrow (exclusive). */
export function todayWindow(now: Date, zone: string): { gte: Date; lt: Date } {
  const tz = validZone(zone)
  const today = dayKey(now, tz)
  return { gte: new Date(dayStartIso(today, tz) as string), lt: new Date(dayEndIso(today, tz) as string) }
}

/** What the calls page starts with from `?status=missed&day=today`. */
export function parseCallsParams(
  status: string | null | undefined,
  day: string | null | undefined,
): { filter: 'all' | 'missed'; today: boolean } {
  return { filter: status === 'missed' ? 'missed' : 'all', today: day === 'today' }
}
