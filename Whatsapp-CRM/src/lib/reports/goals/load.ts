/**
 * Goals with their progress, as a ReportDoc table block (phase F2). The
 * actual figures come from the same summary the reports use, for the
 * running week / month in the business time zone, for the team or one
 * person. Revenue goals appear only to someone who may see money.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { buildSummary } from '../summary'
import { resolveQuery } from '../doc/period-query'
import type { Block, TableCell } from '../doc/types'
import { cell, mainCurrency, money, moneyIn, num, pct, show } from '../doc/reports/common'
import { elapsedShare, goalProgress, METRICS, type GoalMetric, type GoalPeriod, type GoalStatus } from './rules'

const STATUS: Record<GoalStatus, { text: string; tone?: 'good' | 'bad' }> = {
  done: { text: 'Reached', tone: 'good' },
  on_track: { text: 'On track', tone: 'good' },
  behind: { text: 'Behind', tone: 'bad' },
  no_data: { text: 'No numbers yet' },
}

async function medianFirstReply(accountId: string, userId: string | null, from: Date, to: Date): Promise<number | null> {
  const mine = userId ? Prisma.sql`AND l.first_response_by = ${userId}::uuid` : Prisma.empty
  const [r] = await prisma.$queryRaw<Array<{ m: number | null }>>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 60) AS m
    FROM leads l
    WHERE l.account_id = ${accountId}::uuid AND l.first_response_at >= ${from} AND l.first_response_at < ${to} ${mine}`
  return r?.m == null ? null : Math.max(0, Number(r.m))
}

/** The goals block for the team (userId null) or one person; null when there are none. */
export async function goalsBlock(a: { accountId: string; userId: string | null; tz: string; now: Date; canSeeMoney: boolean }): Promise<Block | null> {
  const goals = await prisma.reportGoal.findMany({
    where: { account_id: a.accountId, user_id: a.userId },
    orderBy: [{ period: 'asc' }, { created_at: 'asc' }],
  }).catch((err) => {
    // A server without migration 165 still shows the report.
    console.error('[reports] goals not readable (migration 165?):', err instanceof Error ? err.message : err)
    return []
  })
  const shown = goals.filter((g) => METRICS[g.metric as GoalMetric] && (a.canSeeMoney || !METRICS[g.metric as GoalMetric].money))
  if (!shown.length) return null

  const periods = [...new Set(shown.map((g) => g.period as GoalPeriod))]
  const facts = new Map<GoalPeriod, { actual: Record<GoalMetric, number | null>; elapsed: number; currency: string }>()
  for (const period of periods) {
    const q = resolveQuery({ period, compare: 'none' }, a.now, a.tz)
    if (!q) continue
    const p = q.period
    const [s, reply] = await Promise.all([
      buildSummary({ accountId: a.accountId, userId: a.userId, period: p, now: a.now, tz: a.tz }),
      medianFirstReply(a.accountId, a.userId, p.from, p.to),
    ])
    const currency = mainCurrency([s.revenue])
    facts.set(period, {
      elapsed: elapsedShare(period, p.firstDay, p.from, a.now),
      currency,
      actual: {
        leads: s.cohort.total,
        won: s.wonInPeriod,
        calls: s.calls.total,
        attended_pct: pct(s.calls.connected, s.calls.total),
        first_reply_min: reply,
        revenue: moneyIn(s.revenue, currency),
      },
    })
  }

  const rows: TableCell[][] = shown.map((g) => {
    const metric = g.metric as GoalMetric
    const f = facts.get(g.period as GoalPeriod)
    const target = Number(g.target)
    const actual = f?.actual[metric] ?? null
    const prog = goalProgress({ metric, target, actual, elapsed: f?.elapsed ?? 0 })
    const fmt = (v: number | null) => (metric === 'revenue' ? money(v, f?.currency ?? 'INR') : show(v, METRICS[metric].fmt))
    const st = STATUS[prog.status]
    return [
      cell(`${METRICS[metric].label}, this ${g.period}`),
      cell(fmt(target), target),
      cell(fmt(actual), actual),
      cell(prog.pct == null ? '—' : `${num(prog.pct)}%`, prog.pct),
      cell(st.text, null, st.tone),
    ]
  })
  return {
    kind: 'table', id: 'goals', title: a.userId ? 'My goals' : 'Goals',
    columns: [{ label: 'Goal', align: 'left', width: 2 }, { label: 'Target', align: 'right' }, { label: 'So far', align: 'right' }, { label: 'Progress', align: 'right' }, { label: 'Status', align: 'left' }],
    rows,
    note: 'Counts are compared with the pace the days so far allow; percentages and waits are met or not. Set goals in Reports → Goals.',
  }
}
