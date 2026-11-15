/**
 * Performance guide (plan §10, layer 1): where things dropped and what to
 * do, as cards written by code from the numbers (guide-findings.ts).
 * Owners and supervisors get the team's guide; anyone else their own.
 *
 * Ad spend and AI checks join when the Ad and AI reports are built
 * (phases D and E); the AI-written layer is phase F and opt-in.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { cleanPersonName } from '@/lib/auth/person-name'
import { buildSummary, zoneForSql } from '../../summary'
import { loadPresentation } from '../../presentation'
import { previousAsMain } from '../period-query'
import { loadActivity, median } from '../activity'
import type { Block, Finding, ReportDoc } from '../types'
import { guideFindings, slotLabel, type GuideFacts } from './guide-findings'
import { carryQuery, kpi, MINUTES, num, pct, PERCENT, periodInfo, words, type ReportContext } from './common'

type Summary = Awaited<ReturnType<typeof buildSummary>>
type Presentation = Awaited<ReturnType<typeof loadPresentation>>

/** Numbers a caller already has (the All report), so they are not loaded twice. */
export interface GuideReuse { s?: Summary; prev?: Summary | null; data?: Presentation }

async function replySlots(c: ReportContext) {
  const p = c.q.period
  const zone = await zoneForSql(prisma, c.tz, c.now)
  const mine = c.userId ? Prisma.sql`AND l.assigned_to = ${c.userId}::uuid` : Prisma.empty
  const rows = await prisma.$queryRaw<Array<{ dow: number; hour: number; m: number }>>`
    SELECT EXTRACT(dow FROM (l.created_at AT TIME ZONE ${zone}))::int AS dow,
           EXTRACT(hour FROM (l.created_at AT TIME ZONE ${zone}))::int AS hour,
           GREATEST(0, EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 60) AS m
    FROM leads l
    WHERE l.account_id = ${c.accountId}::uuid AND l.is_hidden = false AND l.ai_suggested = false
      AND l.created_at >= ${p.from} AND l.created_at < ${p.to} AND l.first_response_at IS NOT NULL ${mine}
    LIMIT 50000`
  const by = new Map<string, number[]>()
  for (const r of rows) {
    const k = slotLabel(Number(r.dow), Number(r.hour))
    const list = by.get(k) ?? []
    list.push(Number(r.m))
    by.set(k, list)
  }
  return {
    median: median(rows.map((r) => Number(r.m))),
    answered: rows.length,
    slots: [...by.entries()].map(([label, list]) => ({ label, median: median(list) ?? 0, leads: list.length })),
  }
}

export async function loadGuide(c: ReportContext, reuse: GuideReuse = {}): Promise<{ findings: Finding[]; facts: GuideFacts }> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [s, prev, data, act, prevAct, reply] = await Promise.all([
    reuse.s ?? buildSummary({ accountId: c.accountId, userId: c.userId, period: p, now: c.now, tz: c.tz }),
    reuse.prev !== undefined ? reuse.prev : comparing ? buildSummary({ accountId: c.accountId, userId: c.userId, period: previousAsMain(p), now: c.now, tz: c.tz }) : null,
    reuse.data ?? loadPresentation({ accountId: c.accountId, period: p, tz: c.tz, now: c.now, userId: c.userId, skipMeta: true }),
    loadActivity({ accountId: c.accountId, userId: c.userId, period: p, tz: c.tz, now: c.now }),
    comparing ? loadActivity({ accountId: c.accountId, userId: c.userId, period: previousAsMain(p), tz: c.tz, now: c.now }) : null,
    replySlots(c),
  ])
  const q = carryQuery(c)
  const prevSource = new Map((prev?.bySource ?? []).map((x) => [x.source, x.total]))
  const sourceKeys = new Set([...s.bySource.map((x) => x.source), ...prevSource.keys()])
  const countOf = (rows: Presentation['funnel']['rows'], label: string) => rows.find((r) => r.label === label)?.count ?? 0

  const facts: GuideFacts = {
    team: !c.userId,
    links: { leads: `/reports/leads?${q}`, agents: `/reports/agents?${q}` },
    leads: { now: s.cohort.total, before: prev ? prev.cohort.total : null },
    wonPct: { now: pct(s.wonInPeriod, s.cohort.total), before: prev ? pct(prev.wonInPeriod, prev.cohort.total) : null, base: s.cohort.total, prevBase: prev?.cohort.total ?? 0 },
    sources: [...sourceKeys].map((k) => ({
      key: k, label: k === 'Unknown' ? 'Unknown source' : words(k),
      now: s.bySource.find((x) => x.source === k)?.total ?? 0, before: prevSource.get(k) ?? 0,
    })),
    steps: comparing ? data.funnel.conversions.map((cv) => ({
      from: cv.from, to: cv.to, rate: cv.rate, previousRate: cv.previousRate,
      base: countOf(data.funnel.rows, cv.from), prevBase: countOf(data.funnel.previousRows, cv.from),
    })) : [],
    reply,
    agents: s.agents.map((a) => ({ userId: a.userId, name: cleanPersonName(a.name) || 'Former member', calls: a.calls, connected: a.connected })),
    followUps: {
      lateNow: act.followUps.team.late + act.followUps.team.missed,
      lateBefore: prevAct ? prevAct.followUps.team.late + prevAct.followUps.team.missed : null,
      overdueOpen: s.leaks.overdueFollowUps.count,
    },
    idle: act.idle.total,
    neverContacted: s.leaks.neverContacted.count,
    leakHours: s.leakHours,
  }
  return { findings: guideFindings(facts), facts }
}

export async function guideReport(c: ReportContext): Promise<ReportDoc> {
  const { findings, facts } = await loadGuide(c)
  const late = facts.followUps.lateNow
  const blocks: Block[] = [
    {
      kind: 'kpis', id: 'figures',
      items: [
        kpi('Leads', facts.leads.now, facts.leads.before),
        kpi('Won %', facts.wonPct.now, facts.wonPct.before, { fmt: PERCENT }),
        kpi('First reply, middle wait', facts.reply.median, null, { fmt: MINUTES, higherIsBetter: false }),
        kpi('Late follow-ups', late, facts.followUps.lateBefore, { higherIsBetter: false }),
        kpi('Idle leads', facts.idle, null, { higherIsBetter: false, sub: '3+ days untouched' }),
      ],
    },
    { kind: 'findings', id: 'guide', title: 'What to work on', items: findings },
    {
      kind: 'text', id: 'coming', style: 'note',
      lines: ['Ad spend and AI checks join this guide when the Ad and AI reports are built.'],
    },
  ]
  const serious = findings.filter((f) => f.severity === 'high' || f.severity === 'medium').length
  const minor = findings.filter((f) => f.severity === 'low').length
  return {
    key: 'guide',
    title: c.userId ? 'My performance guide' : 'Performance guide',
    headline: serious
      ? `${num(serious)} thing${serious === 1 ? '' : 's'} to work on, most serious first.`
      : minor
        ? `Nothing serious; ${num(minor)} smaller thing${minor === 1 ? '' : 's'} to look at.`
        : 'Nothing has dropped in this period.',
    period: periodInfo(c),
    scope: c.userId ? 'self' : 'team',
    blocks,
    notes: [
      'Every card is worked out by code from the numbers; nothing here is written by AI.',
      'Trends need at least 10 leads (20 calls for answer rates) on both sides; smaller numbers are left alone.',
    ],
    generatedAt: c.now.toISOString(),
  }
}
