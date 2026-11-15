/**
 * Report goals, the pure part (phase F2): which metrics a goal can have,
 * checking one from the request (each field on its own), how much of the
 * running week / month has gone, and progress against the goal.
 *
 * Counts (leads, won, calls, revenue) are judged against the pace the time
 * so far allows: half the month gone, half the goal expected. Rates
 * (attended %) and waits (first reply) are met or not, whatever the day.
 */

import type { Fmt } from '../doc/types'

export type GoalMetric = 'leads' | 'won' | 'calls' | 'attended_pct' | 'first_reply_min' | 'revenue'
export type GoalPeriod = 'week' | 'month'

export const METRICS: Record<GoalMetric, { label: string; kind: 'count' | 'rate' | 'wait'; fmt: Fmt; money: boolean }> = {
  leads: { label: 'New leads', kind: 'count', fmt: { kind: 'count' }, money: false },
  won: { label: 'Won', kind: 'count', fmt: { kind: 'count' }, money: false },
  calls: { label: 'Calls', kind: 'count', fmt: { kind: 'count' }, money: false },
  attended_pct: { label: 'Calls attended %', kind: 'rate', fmt: { kind: 'percent', digits: 1 }, money: false },
  first_reply_min: { label: 'First reply, middle wait', kind: 'wait', fmt: { kind: 'minutes' }, money: false },
  revenue: { label: 'Revenue won', kind: 'count', fmt: { kind: 'count' }, money: true },
}
export const GOAL_METRICS = Object.keys(METRICS) as GoalMetric[]
const MAX_TARGET = 1_000_000_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface GoalInput { metric: GoalMetric; period: GoalPeriod; target: number; user_id: string | null }

/** `team`: user id → role for this account's members. */
export function validateGoal(body: unknown, team: Map<string, string>): { ok: true; value: GoalInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const metric = b.metric as GoalMetric
  if (!GOAL_METRICS.includes(metric)) return { ok: false, error: 'Choose what the goal is for.' }
  const period = b.period as GoalPeriod
  if (period !== 'week' && period !== 'month') return { ok: false, error: 'Choose this week or this month.' }
  const target = Number(b.target)
  if (!Number.isFinite(target) || target <= 0 || target > MAX_TARGET) return { ok: false, error: 'Enter a target above 0.' }
  if (METRICS[metric].kind === 'rate' && target > 100) return { ok: false, error: 'A percentage goal is 100 or less.' }
  let user_id: string | null = null
  if (b.user_id != null && b.user_id !== '') {
    if (typeof b.user_id !== 'string' || !UUID.test(b.user_id) || !team.has(b.user_id)) return { ok: false, error: 'Choose someone on this team, or the whole team.' }
    user_id = b.user_id
  }
  return { ok: true, value: { metric, period, target: Math.round(target * 100) / 100, user_id } }
}

/** Share of the running week (7 days) or month (its own length) gone, 0–1. */
export function elapsedShare(period: GoalPeriod, firstDay: string, from: Date, now: Date): number {
  const [y, m] = firstDay.split('-').map(Number)
  const days = period === 'week' ? 7 : new Date(Date.UTC(y, m, 0)).getUTCDate()
  const share = (now.getTime() - from.getTime()) / (days * 86_400_000)
  return Math.min(1, Math.max(0, share))
}

export type GoalStatus = 'done' | 'on_track' | 'behind' | 'no_data'

export function goalProgress(g: { metric: GoalMetric; target: number; actual: number | null; elapsed: number }): { pct: number | null; status: GoalStatus } {
  if (g.actual == null || !Number.isFinite(g.actual)) return { pct: null, status: 'no_data' }
  const kind = METRICS[g.metric].kind
  if (kind === 'wait') {
    const pct = g.actual > 0 ? Math.round((g.target / g.actual) * 100) : 100
    return { pct: Math.min(pct, 999), status: g.actual <= g.target ? 'done' : 'behind' }
  }
  const pct = Math.min(Math.round((g.actual / g.target) * 100), 999)
  if (g.actual >= g.target) return { pct, status: 'done' }
  if (kind === 'rate') return { pct, status: 'behind' }
  // Counts: compared with what the time so far would give at an even pace (5% grace).
  return { pct, status: g.actual >= g.target * g.elapsed * 0.95 ? 'on_track' : 'behind' }
}
