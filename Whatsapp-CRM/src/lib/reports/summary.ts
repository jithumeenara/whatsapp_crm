/**
 * The owner report: every number on /reports, computed here and only
 * here (docs/plans/reports-plan.md §5). Counts come from leads, money
 * from Pipeline deals. Screens and the digest read this; nothing else
 * computes a report figure.
 *
 * Two kinds of number, named so they are never mixed:
 *  - "cohort": leads that came in during the period, and what became of
 *    them. Won + lost + closed without outcome + open = came in.
 *  - "in the period": things that happened in it (a deal won this week
 *    may come from a lead of last month).
 *
 * An agent's report is the same computation scoped to them: their leads,
 * their calls, their wins. Nobody else's numbers leave the server.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { outcomeOf } from '@/lib/leads/outcome'
import type { ReportPeriod } from './period'
import { countFunnel, type FunnelRow } from './funnel'
import { parseFunnel, parseReportSettings } from './settings'

export interface Count { total: number; won: number; lost: number; closedNoOutcome: number; open: number }
export interface Money { currency: string; amount: number; deals: number; withAmount: number }
export interface LeakRow { id: string; title: string; since: string; owner: string | null }
export interface Leak { count: number; rows: LeakRow[] }
export interface AgentRow {
  userId: string
  name: string
  leads: number
  calls: number
  connected: number
  won: number
  lost: number
  overdueFollowUps: number
  daysWorked: number
  medianFirstReplyMinutes: number | null
}

export interface ReportSummary {
  generatedAt: string
  scope: 'team' | 'self'
  cohort: Count
  previousCohort: Count
  /** Leads hidden or still only suggested by the assistant, left out of the cohort. */
  excluded: number
  wonInPeriod: number
  lostInPeriod: number
  previousWonInPeriod: number
  calls: { total: number; connected: number; previousTotal: number; countedSince: string | null }
  revenue: Money[]
  previousRevenue: Money[]
  lostAmount: Money[]
  pipeline: Money[]
  pipelineByStage: Array<{ pipeline: string; stage: string; deals: number; amount: number; currency: string }>
  /** Won deals closed before won dates were recorded: not in any period's revenue. */
  wonWithoutDate: number
  bySource: Array<{ source: string } & Count>
  byCategory: Array<{ category: string; deals: number; amount: number; currency: string }>
  lostReasons: Array<{ reason: string; count: number }>
  leaks: { neverContacted: Leak; overdueFollowUps: Leak; unassigned: Leak; waitingChats: Leak }
  leakHours: number
  agents: AgentRow[]
  /** This period's leads through the business's own stages; empty until set up. */
  funnel: FunnelRow[]
}

const NO_OUTCOME: Count = { total: 0, won: 0, lost: 0, closedNoOutcome: 0, open: 0 }
const LEAK_ROWS = 8

type Db = Pick<typeof prisma, 'lead' | 'deal' | 'leadActivity' | 'followUp' | 'conversation' | 'profile' | 'leadSettings' | 'pipelineStage' | 'serviceCategory' | '$queryRaw'>
interface Scope { accountId: string; userId: string | null; db: Db }

export function tally(rows:Array<{ status: string; converted_at: Date | null; lost_reason: string | null }>): Count {
  const c = { ...NO_OUTCOME }
  for (const r of rows) {
    c.total++
    const o = outcomeOf(r)
    if (o === 'won') c.won++
    else if (o === 'lost') c.lost++
    else if (o === 'closed') c.closedNoOutcome++
    else c.open++
  }
  return c
}

const leadBase = (s: Scope): Prisma.LeadWhereInput => ({
  account_id: s.accountId,
  is_hidden: false,
  ai_suggested: false,
  ...(s.userId ? { assigned_to: s.userId } : {}),
})

async function cohort(s: Scope, from: Date, to: Date) {
  return s.db.lead.findMany({
    where: { ...leadBase(s), created_at: { gte: from, lt: to } },
    select: { id: true, status: true, converted_at: true, lost_reason: true, source: true },
  })
}

/** The business's own funnel for this period's leads; empty until stages are set up. */
async function funnel(s: Scope, leads: Array<{ id: string; status: string; converted_at: Date | null; lost_reason: string | null }>): Promise<FunnelRow[]> {
  const settings = await s.db.leadSettings.findUnique({ where: { account_id: s.accountId }, select: { funnel_stages: true } })
  const stages = parseFunnel(settings?.funnel_stages)
  if (stages.length === 0) return []
  const ids = leads.map((l) => l.id)
  const marks = ids.length
    ? await s.db.$queryRaw<Array<{ lead_id: string; stage_key: string }>>`
        SELECT DISTINCT lead_id, metadata->>'stage_key' AS stage_key FROM lead_activities
        WHERE account_id = ${s.accountId}::uuid AND type = 'stage' AND lead_id = ANY(${ids}::uuid[])`
    : []
  return countFunnel(
    stages,
    leads.map((l) => ({ id: l.id, won: outcomeOf(l) === 'won' })),
    marks.filter((m) => m.stage_key).map((m) => ({ leadId: m.lead_id, stageKey: m.stage_key })),
  )
}

/** A win or loss belongs to whoever closed it; before closed_by existed, to the holder. */
const closerScope = (s: Scope): Prisma.LeadWhereInput =>
  s.userId ? { OR: [{ closed_by: s.userId }, { closed_by: null, assigned_to: s.userId }] } : {}

async function wonLost(s: Scope, from: Date, to: Date) {
  const base = { account_id: s.accountId, is_hidden: false, ai_suggested: false, status: 'closed', ...closerScope(s) }
  const [won, lost] = await Promise.all([
    s.db.lead.count({ where: { ...base, converted_at: { gte: from, lt: to } } }),
    s.db.lead.count({ where: { ...base, converted_at: null, lost_at: { gte: from, lt: to } } }),
  ])
  return { won, lost }
}

async function money(s: Scope, where: Prisma.DealWhereInput): Promise<Money[]> {
  const rows = await s.db.deal.groupBy({
    by: ['currency'],
    where,
    _sum: { value: true },
    _count: { _all: true },
  })
  const withAmount = await s.db.deal.groupBy({ by: ['currency'], where: { ...where, value: { gt: 0 } }, _count: { _all: true } })
  return rows.map((r) => ({
    currency: r.currency ?? 'INR',
    amount: Number(r._sum.value ?? 0),
    deals: r._count._all,
    withAmount: withAmount.find((w) => w.currency === r.currency)?._count._all ?? 0,
  }))
}

async function calls(s: Scope, from: Date, to: Date) {
  const who = s.userId ? Prisma.sql`AND user_id = ${s.userId}::uuid` : Prisma.empty
  const [row] = await s.db.$queryRaw<Array<{ total: bigint; connected: bigint }>>`
    SELECT count(*) AS total, count(*) FILTER (WHERE (metadata->>'connected')::boolean) AS connected
    FROM lead_activities
    WHERE account_id = ${s.accountId}::uuid AND type = 'call' AND created_at >= ${from} AND created_at < ${to} ${who}`
  return { total: Number(row?.total ?? 0), connected: Number(row?.connected ?? 0) }
}

const names = async (s: Scope, ids: string[]) => {
  if (!ids.length) return new Map<string, string>()
  const profiles = await s.db.profile.findMany({ where: { account_id: s.accountId, user_id: { in: ids } }, select: { user_id: true, full_name: true } })
  return new Map(profiles.map((p) => [p.user_id, p.full_name || 'Team member']))
}

async function leaks(s: Scope, now: Date, hours: number) {
  const cutoff = new Date(now.getTime() - hours * 3_600_000)
  const mine = s.userId ? Prisma.sql`AND l.assigned_to = ${s.userId}::uuid` : Prisma.empty

  // Open, older than the threshold, and nobody has replied, called or moved it.
  const never = await s.db.$queryRaw<Array<{ id: string; title: string; created_at: Date; assigned_to: string | null; n: bigint }>>`
    SELECT l.id, l.title, l.created_at, l.assigned_to, count(*) OVER () AS n
    FROM leads l
    WHERE l.account_id = ${s.accountId}::uuid AND l.status <> 'closed' AND l.is_hidden = false AND l.ai_suggested = false
      AND l.created_at < ${cutoff} AND l.first_response_at IS NULL ${mine}
      AND NOT EXISTS (
        SELECT 1 FROM lead_activities a
        WHERE a.lead_id = l.id AND a.user_id IS NOT NULL AND a.type IN ('call', 'stage_change', 'follow_up', 'stage')
      )
    ORDER BY l.created_at ASC
    LIMIT ${LEAK_ROWS}`

  const fuWhere: Prisma.FollowUpWhereInput = { account_id: s.accountId, status: 'pending', due_at: { lt: now }, ...(s.userId ? { assigned_to: s.userId } : {}) }
  const [fuCount, fuRows] = await Promise.all([
    s.db.followUp.count({ where: fuWhere }),
    s.db.followUp.findMany({ where: fuWhere, orderBy: { due_at: 'asc' }, take: LEAK_ROWS, select: { id: true, lead_id: true, title: true, due_at: true, assigned_to: true } }),
  ])

  const unWhere: Prisma.LeadWhereInput = { account_id: s.accountId, is_hidden: false, ai_suggested: false, status: { not: 'closed' }, assigned_to: null }
  const [unCount, unRows] = s.userId
    ? [0, []] // "nobody's" is not an agent's own list
    : await Promise.all([
        s.db.lead.count({ where: unWhere }),
        s.db.lead.findMany({ where: unWhere, orderBy: { created_at: 'asc' }, take: LEAK_ROWS, select: { id: true, title: true, created_at: true } }),
      ])

  const chatWhere: Prisma.ConversationWhereInput = {
    account_id: s.accountId, status: 'open', unread_count: { gt: 0 }, last_message_at: { lt: cutoff },
    ...(s.userId ? { assigned_agent_id: s.userId } : {}),
  }
  const [chatCount, chatRows] = await Promise.all([
    s.db.conversation.count({ where: chatWhere }),
    s.db.conversation.findMany({
      where: chatWhere, orderBy: { last_message_at: 'asc' }, take: LEAK_ROWS,
      select: { id: true, last_message_at: true, assigned_agent_id: true, contact: { select: { name: true, phone: true } } },
    }),
  ])

  const people = await names(s, [
    ...never.map((r) => r.assigned_to), ...fuRows.map((r) => r.assigned_to), ...chatRows.map((r) => r.assigned_agent_id),
  ].filter((x): x is string => !!x))
  const owner = (id: string | null) => (id ? people.get(id) ?? null : null)

  return {
    neverContacted: { count: Number(never[0]?.n ?? 0), rows: never.map((r) => ({ id: r.id, title: r.title, since: r.created_at.toISOString(), owner: owner(r.assigned_to) })) },
    overdueFollowUps: { count: fuCount, rows: fuRows.map((r) => ({ id: r.lead_id ?? r.id, title: r.title, since: r.due_at.toISOString(), owner: owner(r.assigned_to) })) },
    unassigned: { count: unCount, rows: unRows.map((r) => ({ id: r.id, title: r.title, since: r.created_at.toISOString(), owner: null })) },
    waitingChats: { count: chatCount, rows: chatRows.map((r) => ({ id: r.id, title: r.contact?.name || 'Customer', since: (r.last_message_at ?? now).toISOString(), owner: owner(r.assigned_agent_id) })) },
  }
}

/** `tz` counts "days worked" as the business's calendar days. */
async function agents(s: Scope, p: ReportPeriod, now: Date, tz: string): Promise<AgentRow[]> {
  const who = s.userId ? Prisma.sql`AND x.uid = ${s.userId}::uuid` : Prisma.empty
  const rows = await s.db.$queryRaw<Array<{
    uid: string; leads: bigint; calls: bigint; connected: bigint; won: bigint; lost: bigint; overdue: bigint; days: bigint; median_reply: number | null
  }>>`
    WITH members AS (
      SELECT user_id AS uid FROM profiles WHERE account_id = ${s.accountId}::uuid AND account_role IN ('agent', 'supervisor', 'admin', 'owner')
    ), x AS (SELECT uid FROM members)
    SELECT x.uid,
      (SELECT count(*) FROM leads l WHERE l.account_id = ${s.accountId}::uuid AND l.assigned_to = x.uid AND l.is_hidden = false AND l.ai_suggested = false
         AND l.created_at >= ${p.from} AND l.created_at < ${p.to}) AS leads,
      (SELECT count(*) FROM lead_activities a WHERE a.account_id = ${s.accountId}::uuid AND a.user_id = x.uid AND a.type = 'call'
         AND a.created_at >= ${p.from} AND a.created_at < ${p.to}) AS calls,
      (SELECT count(*) FROM lead_activities a WHERE a.account_id = ${s.accountId}::uuid AND a.user_id = x.uid AND a.type = 'call'
         AND (a.metadata->>'connected')::boolean AND a.created_at >= ${p.from} AND a.created_at < ${p.to}) AS connected,
      (SELECT count(*) FROM leads l WHERE l.account_id = ${s.accountId}::uuid AND l.status = 'closed' AND l.is_hidden = false
         AND COALESCE(l.closed_by, l.assigned_to) = x.uid AND l.converted_at >= ${p.from} AND l.converted_at < ${p.to}) AS won,
      (SELECT count(*) FROM leads l WHERE l.account_id = ${s.accountId}::uuid AND l.status = 'closed' AND l.is_hidden = false AND l.converted_at IS NULL
         AND COALESCE(l.closed_by, l.assigned_to) = x.uid AND l.lost_at >= ${p.from} AND l.lost_at < ${p.to}) AS lost,
      (SELECT count(*) FROM follow_ups f WHERE f.account_id = ${s.accountId}::uuid AND f.assigned_to = x.uid AND f.status = 'pending' AND f.due_at < ${now}) AS overdue,
      (SELECT count(DISTINCT (a.created_at AT TIME ZONE ${tz})::date) FROM lead_activities a WHERE a.account_id = ${s.accountId}::uuid AND a.user_id = x.uid
         AND a.created_at >= ${p.from} AND a.created_at < ${p.to}) AS days,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 60)
         FROM leads l WHERE l.account_id = ${s.accountId}::uuid AND l.first_response_by = x.uid
         AND l.first_response_at >= ${p.from} AND l.first_response_at < ${p.to}) AS median_reply
    FROM x WHERE true ${who}`
  const people = await names(s, rows.map((r) => r.uid))
  return rows
    .map((r) => ({
      userId: r.uid,
      name: people.get(r.uid) ?? 'Team member',
      leads: Number(r.leads), calls: Number(r.calls), connected: Number(r.connected),
      won: Number(r.won), lost: Number(r.lost), overdueFollowUps: Number(r.overdue), daysWorked: Number(r.days),
      medianFirstReplyMinutes: r.median_reply == null ? null : Math.round(Number(r.median_reply)),
    }))
    // People with nothing at all in the period are left out of the table.
    .filter((a) => s.userId || a.leads + a.calls + a.won + a.lost + a.overdueFollowUps > 0)
    .sort((a, b) => b.won - a.won || b.calls - a.calls)
}

/** `db` is for scripts that check the SQL inside a rolled-back transaction. */
export async function buildSummary(args: { accountId: string; userId: string | null; period: ReportPeriod; now: Date; tz: string; db?: Db }): Promise<ReportSummary> {
  const s: Scope = { accountId: args.accountId, userId: args.userId, db: args.db ?? prisma }
  const { period: p, now } = args

  const settings = await s.db.leadSettings.findUnique({ where: { account_id: s.accountId }, select: { sla_warn_hours: true, report_settings: true } })
  // Settings → Reports first, then the Leads SLA warning, then a day.
  const leakHours = parseReportSettings(settings?.report_settings).leakHours
    ?? (settings?.sla_warn_hours && settings.sla_warn_hours > 0 ? settings.sla_warn_hours : 24)

  const dealMine: Prisma.DealWhereInput = s.userId ? { OR: [{ closed_by: s.userId }, { closed_by: null, assigned_to: s.userId }] } : {}
  const dealBase: Prisma.DealWhereInput = { account_id: s.accountId, ...dealMine }

  const [
    cur, prev, excluded, wl, prevWl, callNow, callPrev, firstCall,
    revenue, prevRevenue, lostAmount, pipeline, wonWithoutDate, leakSet, agentRows,
  ] = await Promise.all([
    cohort(s, p.from, p.to),
    cohort(s, p.prevFrom, p.prevTo),
    s.db.lead.count({
      where: { account_id: s.accountId, created_at: { gte: p.from, lt: p.to }, OR: [{ is_hidden: true }, { ai_suggested: true }], ...(s.userId ? { assigned_to: s.userId } : {}) },
    }),
    wonLost(s, p.from, p.to),
    wonLost(s, p.prevFrom, p.prevTo),
    calls(s, p.from, p.to),
    calls(s, p.prevFrom, p.prevTo),
    s.db.leadActivity.findFirst({ where: { account_id: s.accountId, type: 'call' }, orderBy: { created_at: 'asc' }, select: { created_at: true } }),
    money(s, { ...dealBase, status: 'won', won_at: { gte: p.from, lt: p.to } }),
    money(s, { ...dealBase, status: 'won', won_at: { gte: p.prevFrom, lt: p.prevTo } }),
    money(s, { ...dealBase, status: 'lost', lost_at: { gte: p.from, lt: p.to } }),
    money(s, { account_id: s.accountId, status: 'open', ...(s.userId ? { assigned_to: s.userId } : {}) }),
    s.db.deal.count({ where: { ...dealBase, status: 'won', won_at: null } }),
    leaks(s, now, leakHours),
    agents(s, p, now, args.tz),
  ])

  // Pipeline by stage, in the business's own stage order.
  const stageRows = await s.db.deal.groupBy({
    by: ['stage_id', 'currency'],
    where: { account_id: s.accountId, status: 'open', ...(s.userId ? { assigned_to: s.userId } : {}) },
    _sum: { value: true },
    _count: { _all: true },
  })
  const stages = stageRows.length
    ? await s.db.pipelineStage.findMany({
        where: { id: { in: stageRows.map((r) => r.stage_id) }, pipeline: { account_id: s.accountId } },
        select: { id: true, name: true, position: true, pipeline: { select: { name: true } } },
      })
    : []
  const pipelineByStage = stageRows
    .map((r) => {
      const st = stages.find((x) => x.id === r.stage_id)
      return { pipeline: st?.pipeline.name ?? '—', stage: st?.name ?? '—', position: st?.position ?? 0, deals: r._count._all, amount: Number(r._sum.value ?? 0), currency: r.currency ?? 'INR' }
    })
    .sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.position - b.position)
    .map(({ position: _p, ...rest }) => rest)

  // Won revenue by what the enquiry was about (the lead's category).
  const wonDeals = await s.db.deal.findMany({
    where: { ...dealBase, status: 'won', won_at: { gte: p.from, lt: p.to } },
    select: { value: true, currency: true, lead: { select: { service_category_key: true } } },
  })
  const catKeys = [...new Set(wonDeals.map((d) => d.lead?.service_category_key).filter((k): k is string => !!k))]
  const cats = catKeys.length
    ? await s.db.serviceCategory.findMany({ where: { account_id: s.accountId, key: { in: catKeys } }, select: { key: true, label: true } })
    : []
  const byCat = new Map<string, { category: string; deals: number; amount: number; currency: string }>()
  for (const d of wonDeals) {
    const key = d.lead?.service_category_key ?? ''
    const label = cats.find((c) => c.key === key)?.label ?? 'Not set'
    const id = `${label}|${d.currency ?? 'INR'}`
    const row = byCat.get(id) ?? { category: label, deals: 0, amount: 0, currency: d.currency ?? 'INR' }
    row.deals++
    row.amount += Number(d.value ?? 0)
    byCat.set(id, row)
  }

  // Cohort by source.
  const bySourceMap = new Map<string, typeof cur>()
  for (const r of cur) bySourceMap.set(r.source || 'Unknown', [...(bySourceMap.get(r.source || 'Unknown') ?? []), r])
  const bySource = [...bySourceMap].map(([source, rows]) => ({ source, ...tally(rows) })).sort((a, b) => b.total - a.total)

  // Why leads were lost in the period: the picked reason, else the words.
  const lostRows = await s.db.lead.findMany({
    where: { account_id: s.accountId, is_hidden: false, status: 'closed', converted_at: null, lost_at: { gte: p.from, lt: p.to }, ...closerScope(s) },
    select: { lost_reason_key: true, lost_reason: true },
  })
  const reasons = new Map<string, number>()
  for (const r of lostRows) {
    const label = (r.lost_reason_key || r.lost_reason || 'No reason given').trim().slice(0, 60) || 'No reason given'
    reasons.set(label, (reasons.get(label) ?? 0) + 1)
  }

  return {
    generatedAt: now.toISOString(),
    scope: s.userId ? 'self' : 'team',
    cohort: tally(cur),
    previousCohort: tally(prev),
    excluded,
    wonInPeriod: wl.won,
    lostInPeriod: wl.lost,
    previousWonInPeriod: prevWl.won,
    calls: { ...callNow, previousTotal: callPrev.total, countedSince: firstCall?.created_at.toISOString() ?? null },
    revenue, previousRevenue: prevRevenue, lostAmount, pipeline, pipelineByStage, wonWithoutDate,
    bySource,
    byCategory: [...byCat.values()].sort((a, b) => b.amount - a.amount),
    lostReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    leaks: leakSet,
    leakHours,
    agents: agentRows,
    funnel: await funnel(s, cur),
  }
}
