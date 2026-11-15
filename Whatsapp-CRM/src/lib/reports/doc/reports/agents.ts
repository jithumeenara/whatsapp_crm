/**
 * Agent report.
 *
 * - Team view (supervisors and above, no ?member): every team member
 *   against the comparison period, each name opening their report card.
 * - Report card (one person): an agent's own, always (the role decides,
 *   never the request), or the member a supervisor opened. Calls by day
 *   and by hour, talk time, follow-ups on time, time to first call, idle
 *   leads, stages, lost reasons and what to work on. No ranks and nobody
 *   else's name on a card.
 *
 * Wins count for whoever closed the lead.
 */

import { cleanPersonName } from '@/lib/auth/person-name'
import { buildSummary } from '../../summary'
import { loadPresentation } from '../../presentation'
import type { Block, ReportDoc, TableCell } from '../types'
import { previousAsMain } from '../period-query'
import { loadActivity, median, onTimePct, talkText, WAIT_BUCKETS, IDLE_BUCKETS, type Activity, type WaitBucket, type IdleBucket } from '../activity'
import { cardFindings } from './card-findings'
import { goalsBlock } from '../../goals/load'
import { carryQuery, cell, changeCell, COUNT, dayLabel, kpi, MINUTES, num, pct, PERCENT, periodInfo, pctText, type ReportContext } from './common'

const WAIT_LABEL: Record<WaitBucket, string> = {
  min5: 'Within 5 minutes', hour1: '5 to 60 minutes', day1: '1 to 24 hours', later: 'After a day', none: 'Not called yet',
}
const IDLE_LABEL: Record<IdleBucket, string> = { d3: '3 to 6 days', d7: '7 to 13 days', d14: '14 to 29 days', d30: '30 days or more' }

const name = (n: string) => cleanPersonName(n) || 'Former member'
const minutesCell = (m: number | null) => cell(m == null ? '—' : m < 60 ? `${Math.round(m)} min` : `${Math.round(m / 6) / 10} h`, m)

export async function agentReport(c: ReportContext): Promise<ReportDoc> {
  return c.userId ? reportCard(c, c.userId) : teamView(c)
}

// ── Team view ──────────────────────────────────────────────────────────

async function teamView(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [s, prev, data, act] = await Promise.all([
    buildSummary({ accountId: c.accountId, userId: null, period: p, now: c.now, tz: c.tz }),
    comparing ? buildSummary({ accountId: c.accountId, userId: null, period: previousAsMain(p), now: c.now, tz: c.tz }) : null,
    loadPresentation({ accountId: c.accountId, period: p, tz: c.tz, now: c.now, userId: null, skipMeta: true }),
    loadActivity({ accountId: c.accountId, userId: null, period: p, tz: c.tz, now: c.now }),
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
  const teamOnTime = onTimePct(act.followUps.team)
  const hasTalk = act.talk.size > 0
  const link = (uid: string) => `/reports/agents?${carryQuery(c)}&member=${encodeURIComponent(uid)}`

  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Calls', calls, prevCalls),
      kpi('Attended %', pct(conn, calls), prevCalls != null && prevConn != null ? pct(prevConn, prevCalls) : null, { fmt: PERCENT }),
      kpi('Won', won, prevWon),
      kpi('Follow-ups on time', teamOnTime, null, { fmt: PERCENT }),
      kpi('First call, middle wait', act.firstCall.medianMinutes, null, { fmt: MINUTES, higherIsBetter: false }),
      kpi('Late follow-ups', overdue, null, { higherIsBetter: false, tone: overdue ? 'bad' : 'good' }),
    ],
  }]

  if (team.length === 0) {
    blocks.push({ kind: 'text', id: 'empty', style: 'note', lines: ['No calls, leads or wins in this period yet.'] })
  } else {
    const open = data.funnel.stages.filter((st) => st.outcome !== 'lost').slice(0, 5)
    const stageBy = new Map(data.team.map((t) => [t.userId, t.stages]))
    blocks.push({
      kind: 'table', id: 'team', title: 'Team',
      columns: [
        { label: 'Team member', align: 'left', width: 2 },
        { label: 'Calls', align: 'right' }, { label: 'Before', align: 'right' },
        { label: 'Attended %', align: 'right' }, { label: 'Before', align: 'right' },
        ...(hasTalk ? [{ label: 'Talk time', align: 'right' as const }] : []),
        ...open.map((st) => ({ label: st.label, align: 'right' as const })),
        { label: 'Won', align: 'right' }, { label: 'Change', align: 'right' },
        { label: 'On time %', align: 'right' }, { label: 'Late follow-ups', align: 'right' },
        { label: 'First call', align: 'right' }, { label: 'Idle leads', align: 'right' },
      ],
      rows: team.map((a) => {
        const b = prevBy.get(a.userId)
        const att = pct(a.connected, a.calls)
        const bAtt = b ? pct(b.connected, b.calls) : null
        const stages = stageBy.get(a.userId) ?? []
        const fu = act.followUps.byUser.get(a.userId)
        const ot = fu ? onTimePct(fu) : null
        const fc = act.firstCall.byUser.get(a.userId)
        const fcMed = fc ? median(fc.minutes) : null
        const idle = act.idle.byUser.get(a.userId) ?? 0
        const talk = act.talk.get(a.userId)
        const row: TableCell[] = [
          cell(name(a.name), null, undefined, link(a.userId)),
          cell(num(a.calls), a.calls), cell(comparing ? num(b?.calls ?? 0) : '—', b?.calls ?? 0),
          cell(pctText(att), att, att == null ? undefined : att >= 60 ? 'good' : att < 40 ? 'bad' : undefined),
          cell(comparing ? pctText(bAtt) : '—', bAtt),
          ...(hasTalk ? [cell(talk ? talkText(talk.seconds) : '—', talk?.seconds ?? null)] : []),
          ...open.map((_, i) => cell(num(stages[i] ?? 0), stages[i] ?? 0)),
          cell(num(a.won), a.won), changeCell(a.won, comparing ? b?.won ?? 0 : null),
          cell(pctText(ot), ot, ot == null ? undefined : ot >= 80 ? 'good' : ot < 50 ? 'bad' : undefined),
          cell(num(a.overdueFollowUps), a.overdueFollowUps, a.overdueFollowUps ? 'bad' : undefined),
          minutesCell(fcMed),
          cell(num(idle), idle, idle ? 'bad' : undefined),
        ]
        return row
      }),
      total: team.length < 2 ? undefined : [
        cell('Team total'), cell(num(calls), calls), cell(comparing ? num(prevCalls ?? 0) : '—', prevCalls),
        cell(pctText(pct(conn, calls)), pct(conn, calls)), cell(comparing && prevCalls != null && prevConn != null ? pctText(pct(prevConn, prevCalls)) : '—'),
        ...(hasTalk ? [cell(talkText([...act.talk.values()].reduce((x, t) => x + t.seconds, 0)))] : []),
        ...open.map((_, i) => cell(num(team.reduce((x, a) => x + ((stageBy.get(a.userId) ?? [])[i] ?? 0), 0)))),
        cell(num(won), won), changeCell(won, comparing ? prevWon : null),
        cell(pctText(teamOnTime), teamOnTime), cell(num(overdue), overdue),
        minutesCell(act.firstCall.medianMinutes), cell(num(act.idle.total), act.idle.total),
      ],
      note: 'Open a name for that person\'s report card. Wins count for whoever closed the lead. Percentages from fewer than 20 calls say little.',
    })
    blocks.push({
      kind: 'chart', id: 'calls', title: 'Calls and attended, by team member', chart: 'hbar',
      labels: team.map((a) => name(a.name)),
      series: [
        { name: 'Calls', values: team.map((a) => a.calls) },
        { name: 'Attended', values: team.map((a) => a.connected) },
      ],
    })
    pushHours(blocks, act, 'When people pick up (whole team)')
  }

  const attNow = pct(conn, calls)
  const headline = team.length
    ? `${num(calls)} calls, ${pctText(attNow)} attended, ${num(won)} won${overdue ? `; ${num(overdue)} ${overdue === 1 ? 'follow-up is' : 'follow-ups are'} late` : ''}.`
    : 'No team activity in this period yet.'

  return {
    key: 'agents', title: 'Agent report', headline, period: periodInfo(c), scope: 'team', blocks,
    notes: notesFor(act), generatedAt: c.now.toISOString(),
  }
}

// ── One person's report card ───────────────────────────────────────────

async function reportCard(c: ReportContext, userId: string): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const prevPeriod = previousAsMain(p)
  const [s, prev, data, act, prevAct] = await Promise.all([
    buildSummary({ accountId: c.accountId, userId, period: p, now: c.now, tz: c.tz }),
    comparing ? buildSummary({ accountId: c.accountId, userId, period: prevPeriod, now: c.now, tz: c.tz }) : null,
    loadPresentation({ accountId: c.accountId, period: p, tz: c.tz, now: c.now, userId, skipMeta: true }),
    loadActivity({ accountId: c.accountId, userId, period: p, tz: c.tz, now: c.now }),
    comparing ? loadActivity({ accountId: c.accountId, userId, period: prevPeriod, tz: c.tz, now: c.now }) : null,
  ])
  const me = s.agents.find((a) => a.userId === userId)
  const before = prev?.agents.find((a) => a.userId === userId)
  const calls = me?.calls ?? 0
  const conn = me?.connected ?? 0
  const won = me?.won ?? 0
  const overdue = s.leaks.overdueFollowUps.count
  const onTime = onTimePct(act.followUps.team)
  const prevOnTime = prevAct ? onTimePct(prevAct.followUps.team) : null
  const talk = act.talk.get(userId)
  const prevTalk = prevAct?.talk.get(userId)
  const self = c.subject?.self ?? true
  const who = self ? null : c.subject?.name ?? 'Team member'
  const firstCalled = act.firstCall.byUser.get(userId)?.minutes.length ?? 0

  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Calls', calls, comparing ? before?.calls ?? 0 : null),
      kpi('Attended %', pct(conn, calls), comparing && before ? pct(before.connected, before.calls) : null, { fmt: PERCENT }),
      ...(talk ? [kpi('Talk time', Math.round(talk.seconds / 60), prevTalk ? Math.round(prevTalk.seconds / 60) : null, { fmt: MINUTES, sub: `${num(talk.answered)} WhatsApp calls` })] : []),
      kpi('Follow-ups on time', onTime, prevOnTime, { fmt: PERCENT }),
      kpi('First call, middle wait', act.firstCall.medianMinutes, prevAct?.firstCall.medianMinutes ?? null, { fmt: MINUTES, higherIsBetter: false }),
      kpi('Won', won, comparing ? before?.won ?? 0 : null),
      kpi('Late follow-ups', overdue, null, { higherIsBetter: false, tone: overdue ? 'bad' : 'good' }),
      kpi('Idle leads', act.idle.total, null, { higherIsBetter: false, sub: '3+ days untouched', tone: act.idle.total ? 'bad' : 'good' }),
    ],
  }]

  // This person's goals (set by owners and admins). Never money on a card.
  const goals = await goalsBlock({ accountId: c.accountId, userId, tz: c.tz, now: c.now, canSeeMoney: false }).catch(() => null)
  if (goals) blocks.push(goals)

  blocks.push({
    kind: 'findings', id: 'work-on', title: 'What to work on',
    items: cardFindings({
      calls, connected: conn, byHour: act.callsByHour,
      onTimePct: onTime, followUpsCounted: act.followUps.team.due - act.followUps.team.skipped,
      firstCallMedian: act.firstCall.medianMinutes, firstCallLeads: firstCalled,
      idle: act.idle.total, overdueOpen: overdue,
    }),
  })

  const days = data.period.days
  if (calls > 0 && days.length > 1) {
    const prevTotal = prevAct ? [...prevAct.callsByDay.values()].reduce((x, v) => x + v.calls, 0) : null
    blocks.push({
      kind: 'chart', id: 'by-day', title: 'Calls by day', chart: 'bar',
      labels: days.map(dayLabel),
      series: [
        { name: 'Calls', values: days.map((d) => act.callsByDay.get(d)?.calls ?? 0), fmt: COUNT },
        { name: 'Attended', values: days.map((d) => act.callsByDay.get(d)?.connected ?? 0), fmt: COUNT },
      ],
      alt: `Calls by day: ${days.map((d) => `${d} ${act.callsByDay.get(d)?.calls ?? 0}`).slice(0, 40).join(', ')}`,
      note: prevTotal != null ? `Before: ${num(prevTotal)} calls in the comparison period.` : undefined,
    })
  }
  pushHours(blocks, act, 'When people pick up')

  const fu = act.followUps.team
  if (fu.due > 0) {
    blocks.push({
      kind: 'table', id: 'follow-ups', title: 'Follow-ups that were due',
      columns: [{ label: 'Result', align: 'left', width: 2 }, { label: 'Count', align: 'right' }, { label: 'Share', align: 'right' }],
      rows: ([['On time', fu.onTime, 'good'], ['Late', fu.late, 'bad'], ['Still not done', fu.missed, 'bad'], ['Skipped', fu.skipped, undefined]] as const)
        .map(([label, n, tone]) => [cell(label), cell(num(n), n, n ? tone : undefined), cell(pctText(pct(n, fu.due)), pct(n, fu.due))]),
      note: 'On time means done before the due time or within an hour after it.',
    })
  }

  pushFirstCall(blocks, act)

  const open = data.funnel.stages.filter((st) => st.outcome !== 'lost')
  const mine = data.team.find((t) => t.userId === userId)
  if (open.length && mine) {
    blocks.push({
      kind: 'chart', id: 'stages', title: self ? 'How far my leads got' : 'How far their leads got', chart: 'funnel',
      labels: open.map((st) => st.label),
      series: [{ name: 'Reached', values: open.map((_, i) => mine.stages[i] ?? 0) }],
    })
  }

  if (s.lostReasons.length) {
    blocks.push({
      kind: 'chart', id: 'lost', title: 'Why leads were lost', chart: 'hbar',
      labels: s.lostReasons.map((x) => x.reason),
      series: [{ name: 'Lost', values: s.lostReasons.map((x) => x.count) }],
    })
  }

  if (s.leaks.overdueFollowUps.rows.length) {
    blocks.push({
      kind: 'table', id: 'late', title: 'Overdue follow-ups',
      columns: [{ label: 'Follow-up', align: 'left', width: 3 }, { label: 'Was due', align: 'right' }],
      rows: s.leaks.overdueFollowUps.rows.map((r) => [cell(r.title?.trim() || 'Follow-up', null, undefined, `/leads/${r.id}`), cell(r.since.slice(0, 10))]),
      initialRows: 5,
    })
  }

  pushIdle(blocks, act, false)

  const headline = `${num(calls)} calls, ${pctText(pct(conn, calls))} attended, ${num(won)} won${onTime != null ? `, ${pctText(onTime)} of follow-ups on time` : ''}.`
  return {
    key: 'agents',
    title: self ? 'My report card' : `Report card: ${who}`,
    headline, period: periodInfo(c), scope: self ? 'self' : 'member', blocks,
    notes: notesFor(act), generatedAt: c.now.toISOString(),
  }
}

// ── Shared blocks ──────────────────────────────────────────────────────

function pushHours(blocks: Block[], act: Activity, title: string) {
  const used = act.callsByHour.map((h, i) => ({ ...h, hour: i })).filter((h) => h.calls > 0)
  if (used.length < 2) return
  // Only hours with calls: an hour nobody rang is not "0% picked up".
  const range = used
  blocks.push({
    kind: 'chart', id: 'by-hour', title, chart: 'barline',
    labels: range.map((h) => `${String(h.hour).padStart(2, '0')}:00`),
    series: [
      { name: 'Calls', values: range.map((h) => h.calls), kind: 'bar', fmt: COUNT },
      { name: 'Attended %', values: range.map((h) => (h.calls ? Math.round((h.connected / h.calls) * 100) : 0)), kind: 'line', axis: 'right', fmt: PERCENT },
    ],
    note: 'Hours in the business\'s time zone. An hour with only a few calls says little.',
  })
}

export function pushFirstCall(blocks: Block[], act: Activity) {
  const b = act.firstCall.buckets
  const total = WAIT_BUCKETS.reduce((x, k) => x + b[k], 0)
  if (!act.firstCall.countedSince || total === 0) return
  blocks.push({
    kind: 'table', id: 'first-call', title: 'How long new leads waited for a first call',
    columns: [{ label: 'First call', align: 'left', width: 2 }, { label: 'Leads', align: 'right' }, { label: 'Share', align: 'right' }],
    rows: WAIT_BUCKETS.map((k) => [cell(WAIT_LABEL[k]), cell(num(b[k]), b[k], k === 'none' && b[k] ? 'bad' : undefined), cell(pctText(pct(b[k], total)), pct(b[k], total))]),
    note: 'Clock time from the lead coming in to the first call logged on it, working hours or not.',
  })
}

export function pushIdle(blocks: Block[], act: Activity, showOwner: boolean, owners?: Map<string, string>) {
  if (!act.idle.total) return
  blocks.push({
    kind: 'table', id: 'idle', title: 'Open leads nobody has touched',
    columns: [{ label: 'Untouched for', align: 'left', width: 2 }, { label: 'Leads', align: 'right' }],
    rows: IDLE_BUCKETS.map((k) => [cell(IDLE_LABEL[k]), cell(num(act.idle.buckets[k]), act.idle.buckets[k], act.idle.buckets[k] && k !== 'd3' ? 'bad' : undefined)]),
    total: [cell('Total'), cell(num(act.idle.total), act.idle.total)],
    note: 'As of now, whatever the period: no call, note, stage change or customer message for 3 days or more.',
  })
  if (act.idle.oldest.length) {
    blocks.push({
      kind: 'table', id: 'idle-oldest', title: 'Waiting longest',
      columns: [
        { label: 'Lead', align: 'left', width: 3 },
        ...(showOwner ? [{ label: 'Owner', align: 'left' as const, width: 2 }] : []),
        { label: 'Days', align: 'right' },
      ],
      rows: act.idle.oldest.map((r) => [
        cell(r.title?.trim() || 'Lead', null, undefined, `/leads/${r.id}`),
        ...(showOwner ? [cell(r.owner ? owners?.get(r.owner) ?? 'Team member' : 'Nobody')] : []),
        cell(num(r.days), r.days, 'bad'),
      ]),
      initialRows: 5,
    })
  }
}

function notesFor(act: Activity): string[] {
  const notes: string[] = []
  if (act.firstCall.countedSince) notes.push(`Time to first call is counted for leads since calls were first logged (${act.firstCall.countedSince}).`)
  if (act.talk.size === 0) notes.push('Talk time appears only for calls made through WhatsApp calling.')
  return notes
}
