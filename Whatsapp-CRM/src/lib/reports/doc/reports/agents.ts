/**
 * Agent report. Supervisors and owners see every team member against the
 * comparison period; an agent sees only themself (their own numbers, no
 * ranks, no one else's name) — the scope comes from the role, never the
 * request. Wins count for whoever closed the lead.
 */

import { cleanPersonName } from '@/lib/auth/person-name'
import { buildSummary } from '../../summary'
import { loadPresentation } from '../../presentation'
import type { Block, ReportDoc, TableCell } from '../types'
import { previousAsMain } from '../period-query'
import { cell, changeCell, kpi, MINUTES, num, pct, PERCENT, periodInfo, pctText, type ReportContext } from './common'

export async function agentReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [s, prev, data] = await Promise.all([
    buildSummary({ accountId: c.accountId, userId: c.userId, period: p, now: c.now, tz: c.tz }),
    comparing ? buildSummary({ accountId: c.accountId, userId: c.userId, period: previousAsMain(p), now: c.now, tz: c.tz }) : null,
    loadPresentation({ accountId: c.accountId, period: p, tz: c.tz, now: c.now, userId: c.userId, skipMeta: true }),
  ])
  const prevBy = new Map((prev?.agents ?? []).map((a) => [a.userId, a]))
  const team = s.agents
  const sum = (list: typeof team, f: (a: (typeof team)[number]) => number) => list.reduce((x, a) => x + f(a), 0)
  const calls = sum(team, (a) => a.calls)
  const conn = sum(team, (a) => a.connected)
  const prevCalls = prev ? sum(prev.agents, (a) => a.calls) : null
  const prevConn = prev ? sum(prev.agents, (a) => a.connected) : null
  const won = sum(team, (a) => a.won)
  const prevWon = prev ? sum(prev.agents, (a) => a.won) : null
  const overdue = sum(team, (a) => a.overdueFollowUps)
  const replies = team.map((a) => a.medianFirstReplyMinutes).filter((m): m is number => m != null).sort((a, b) => a - b)
  const medianReply = replies.length ? replies[Math.floor(replies.length / 2)] : null
  const name = (n: string) => cleanPersonName(n) || 'Former member'
  const self = Boolean(c.userId)

  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Calls', calls, prevCalls),
      kpi('Attended %', pct(conn, calls), prevCalls != null && prevConn != null ? pct(prevConn, prevCalls) : null, { fmt: PERCENT }),
      kpi('Won', won, prevWon),
      kpi('Late follow-ups', overdue, null, { higherIsBetter: false, tone: overdue ? 'bad' : 'good' }),
      kpi('Median first reply', medianReply, null, { fmt: MINUTES, higherIsBetter: false }),
    ],
  }]

  if (team.length === 0) {
    blocks.push({ kind: 'text', id: 'empty', style: 'note', lines: ['No calls, leads or wins in this period yet.'] })
  } else {
    const open = data.funnel.stages.filter((st) => st.outcome !== 'lost').slice(0, 5)
    const stageBy = new Map(data.team.map((t) => [t.userId, t.stages]))
    blocks.push({
      kind: 'table', id: 'team', title: self ? 'My numbers' : 'Team',
      columns: [
        { label: self ? 'Period' : 'Team member', align: 'left', width: 2 },
        { label: 'Calls', align: 'right' }, { label: 'Before', align: 'right' },
        { label: 'Attended %', align: 'right' }, { label: 'Before', align: 'right' },
        ...open.map((st) => ({ label: st.label, align: 'right' as const })),
        { label: 'Won', align: 'right' }, { label: 'Change', align: 'right' },
        { label: 'Late follow-ups', align: 'right' }, { label: 'First reply', align: 'right' },
      ],
      rows: team.map((a) => {
        const b = prevBy.get(a.userId)
        const att = pct(a.connected, a.calls)
        const bAtt = b ? pct(b.connected, b.calls) : null
        const stages = stageBy.get(a.userId) ?? []
        const row: TableCell[] = [
          cell(self ? 'This period' : name(a.name)),
          cell(num(a.calls), a.calls), cell(comparing ? num(b?.calls ?? 0) : '—', b?.calls ?? 0),
          cell(pctText(att), att, att == null ? undefined : att >= 60 ? 'good' : att < 40 ? 'bad' : undefined),
          cell(comparing ? pctText(bAtt) : '—', bAtt),
          ...open.map((_, i) => cell(num(stages[i] ?? 0), stages[i] ?? 0)),
          cell(num(a.won), a.won), changeCell(a.won, comparing ? b?.won ?? 0 : null),
          cell(num(a.overdueFollowUps), a.overdueFollowUps, a.overdueFollowUps ? 'bad' : undefined),
          cell(a.medianFirstReplyMinutes == null ? '—' : `${a.medianFirstReplyMinutes} min`, a.medianFirstReplyMinutes),
        ]
        return row
      }),
      total: self || team.length < 2 ? undefined : [
        cell('Team total'), cell(num(calls), calls), cell(comparing ? num(prevCalls ?? 0) : '—', prevCalls),
        cell(pctText(pct(conn, calls)), pct(conn, calls)), cell(comparing && prevCalls != null && prevConn != null ? pctText(pct(prevConn, prevCalls)) : '—'),
        ...open.map((_, i) => cell(num(team.reduce((x, a) => x + ((stageBy.get(a.userId) ?? [])[i] ?? 0), 0)))),
        cell(num(won), won), changeCell(won, comparing ? prevWon : null),
        cell(num(overdue), overdue), cell('—'),
      ],
      note: self ? undefined : 'Wins count for whoever closed the lead. Percentages from fewer than 20 calls say little.',
    })
    blocks.push({
      kind: 'chart', id: 'calls', title: self ? 'Calls and attended' : 'Calls and attended, by team member', chart: 'hbar',
      labels: team.map((a) => (self ? 'This period' : name(a.name))),
      series: [
        { name: 'Calls', values: team.map((a) => a.calls) },
        { name: 'Attended', values: team.map((a) => a.connected) },
      ],
    })
  }

  const attNow = pct(conn, calls)
  const headline = team.length
    ? `${num(calls)} calls, ${pctText(attNow)} attended, ${num(won)} won${overdue ? `; ${num(overdue)} follow-ups are late` : ''}.`
    : 'No team activity in this period yet.'

  return { key: 'agents', title: self ? 'My report' : 'Agent report', headline, period: periodInfo(c), scope: self ? 'self' : 'team', blocks, notes: [], generatedAt: c.now.toISOString() }
}
