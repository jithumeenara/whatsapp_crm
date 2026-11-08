/**
 * Builds the owner dashboard (GET /api/dashboard/owner). It computes no
 * report figure of its own: cohort, won, lost, revenue, pipeline, source,
 * funnel, leaks and the team table come from buildSummary and are passed
 * through as they are, so Dashboard and Reports never show two numbers for
 * one word. What is added here is the viewer's Task list, the follow-up
 * buckets, missed calls today and the median first reply.
 */

import { prisma } from '@/lib/db'
import { buildSummary, medianFirstReply } from '@/lib/reports/summary'
import { resolvePeriod } from '@/lib/reports/period'
import { loadFollowUpBuckets, loadMyTasks, loadTeamTasks } from '@/lib/leads/my-tasks'
import { MISSED_CALL_STATUSES } from '@/lib/calls/statuses'
import { zonedDaysAgoStart } from './date-utils'
import { loadManualSpend, spendTable } from './spend'
import type { OwnerDashboard } from './owner-types'
import type { DashboardScope } from './scope'

export type DashboardPeriod = 'today' | 'week' | 'month'

/** Percentages on fewer leads than this are shown faded (Reports rule 7). */
export const SMALL_NUMBER = 20
const CACHE_MS = 30_000
const CACHE_MAX = 200

const cache = new Map<string, { at: number; value: OwnerDashboard }>()
export function clearOwnerDashboardCache() { cache.clear() }

interface Args {
  accountId: string
  /** The person looking: their Task list is always their own. */
  viewerId: string
  scope: DashboardScope
  period: DashboardPeriod
  now: Date
  tz: string
}

/** Calls cannot be tied to one person (a missed call has nobody on it), so an agent view says null. */
export async function missedCallsToday(accountId: string, tz: string, now: Date): Promise<number> {
  return prisma.call.count({
    where: { account_id: accountId, status: { in: [...MISSED_CALL_STATUSES] }, started_at: { gte: zonedDaysAgoStart(0, tz, now), lt: zonedDaysAgoStart(-1, tz, now) } },
  })
}

async function build(a: Args): Promise<OwnerDashboard> {
  const { accountId, viewerId, scope, now, tz } = a
  const p = resolvePeriod({ kind: a.period }, now, tz)
  if (!p) throw new Error('Period could not be resolved')
  const wide = scope.view !== 'agent'
  const who = scope.userId

  // Spend is typed in per month, so it is set beside the leads only when
  // the period is a month; and it is money, so only for owner and admin.
  const wantSpend = scope.money && a.period === 'month'
  const [summary, median, prevMedian, missed, followUps, tasks, teamTasks, manualSpend] = await Promise.all([
    buildSummary({ accountId, userId: who, period: p, now, tz }),
    medianFirstReply({ accountId, userId: who, from: p.from, to: p.to }),
    medianFirstReply({ accountId, userId: who, from: p.prevFrom, to: p.prevTo }),
    wide ? missedCallsToday(accountId, tz, now) : Promise.resolve(null),
    loadFollowUpBuckets({ accountId, userId: who, tz, now }),
    loadMyTasks({ accountId, userId: viewerId, tz, now, limit: 8 }),
    wide ? loadTeamTasks({ accountId, tz, now }) : Promise.resolve(null),
    wantSpend ? loadManualSpend(accountId) : Promise.resolve(null),
  ])
  const month = p.firstDay.slice(0, 7)

  const leaks = summary.leaks
  return {
    generatedAt: now.toISOString(),
    view: scope.view,
    money: scope.money,
    period: { kind: a.period, firstDay: p.firstDay, lastDay: p.lastDay, partial: p.partial, timeZone: tz },
    attention: {
      // One overdue number per screen: a person's own view uses the Task
      // logic (which also counts follow-ups they made with no assignee),
      // the account-wide views use the account-wide bucket (same rule as
      // Reports' leak count).
      overdueFollowUps: followUps.overdue,
      waitingChats: leaks.waitingChats.count,
      neverContacted: leaks.neverContacted.count,
      unassigned: who ? null : leaks.unassigned.count,
      missedCallsToday: missed,
      leakHours: summary.leakHours,
      oldestWaitingChatSince: leaks.waitingChats.rows[0]?.since ?? null,
    },
    kpis: {
      cohort: summary.cohort,
      previousCohort: summary.previousCohort,
      wonInPeriod: summary.wonInPeriod,
      previousWonInPeriod: summary.previousWonInPeriod,
      revenue: scope.money ? summary.revenue : null,
      previousRevenue: scope.money ? summary.previousRevenue : null,
      pipeline: scope.money ? summary.pipeline : null,
      medianFirstReplyMinutes: median,
      previousMedianFirstReplyMinutes: prevMedian,
    },
    funnel: summary.funnel,
    bySource: summary.bySource,
    spend: manualSpend
      ? { month, rows: spendTable(summary.bySource, manualSpend, month), entered: manualSpend.some((s) => s.month === month) }
      : null,
    followUps,
    team: wide ? summary.agents : null,
    tasks,
    teamTasks,
    smallNumber: SMALL_NUMBER,
  }
}

/**
 * Cached for 30 seconds. The key carries the account, the view, the person
 * looking and the period: the Task list is the viewer's own even on the
 * owner view, so two owners never share an entry.
 */
export async function getOwnerDashboard(a: Args): Promise<OwnerDashboard> {
  const key = [a.accountId, a.scope.view, a.viewerId, a.scope.userId ?? 'team', a.period].join('|')
  const hit = cache.get(key)
  const t = Date.now()
  if (hit && t - hit.at < CACHE_MS) return hit.value
  const value = await build(a)
  cache.delete(key)
  cache.set(key, { at: t, value })
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return value
}
