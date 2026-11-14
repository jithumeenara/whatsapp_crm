/**
 * The figures behind the owner's slide deck (presentation-pptx.ts): the
 * weekly report a business used to assemble by hand from Ads Manager, a
 * data-entry sheet and the team's call log, made from what the CRM already
 * knows.
 *
 *   1. Ads at a glance — spend, reach, impressions, clicks (Meta), the
 *      conversations those ads started in the CRM, cost per conversation,
 *      and spend against conversations by day.
 *   2. Leads by category and day — the business's own categories
 *      (specialities, courses, products), one column per day.
 *   3. Funnel and team — calls made and attended, every funnel stage, the
 *      same per team member, and the conversion between stages against the
 *      period before.
 *   4. What needs doing — counts only.
 *
 * Every number is from the database or Meta; sentences are written by
 * code. No customer name or number is ever in it.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { accountInsights, type AccountInsights } from '@/lib/ads/insights'
import { countFunnel, type FunnelRow } from './funnel'
import type { ReportPeriod } from './period'
import { parseFunnel, parsePresentationSettings, type FunnelStage } from './settings'
import { buildSummary, zoneForSql, type ReportSummary } from './summary'
import { replySpeed, speedFinding } from './reply-speed'

export interface CategoryRow { label: string; byDay: number[]; total: number; share: number }

export interface TeamStageRow {
  userId: string
  name: string
  calls: number
  connected: number
  notConnected: number
  /** Leads that reached each stage of `stages` (open and won ones, in order). */
  stages: number[]
  won: number
}

export interface Conversion { from: string; to: string; rate: number | null; previousRate: number | null }

export interface PresentationData {
  period: { kind: ReportPeriod['kind']; firstDay: string; lastDay: string; timeZone: string; days: string[]; previousFirstDay: string; previousLastDay: string }
  brandColor: string | null
  categoryLabel: string | null
  summary: ReportSummary
  ads: {
    insights: AccountInsights
    previous: AccountInsights
    /** Arrivals from ads in the CRM (ad_touches), by business day and in all. */
    conversationsByDay: number[]
    conversations: number
    previousConversations: number
    activeAds: number
  }
  categories: { rows: CategoryRow[]; dayTotals: number[]; total: number; previousTotal: number }
  funnel: { stages: FunnelStage[]; rows: FunnelRow[]; previousRows: FunnelRow[]; conversions: Conversion[]; attendRate: number | null; previousAttendRate: number | null }
  team: TeamStageRow[]
  speedFinding: string | null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Every day from first to last, inclusive; at most 366. */
export function daysBetween(first: string, last: string): string[] {
  const out: string[] = []
  if (!DAY.test(first) || !DAY.test(last)) return out
  for (let d = first, i = 0; d <= last && i < 366; d = addDays(d, 1), i++) out.push(d)
  return out
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

/** Stage-to-stage conversion, in order, from "reached" counts. Pure. */
export function conversions(stages: FunnelStage[], rows: FunnelRow[], previous: FunnelRow[]): Conversion[] {
  const path = stages.filter((s) => s.outcome !== 'lost')
  const count = (list: FunnelRow[], key: string) => list.find((r) => r.key === key)?.count ?? 0
  const out: Conversion[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    out.push({ from: a.label, to: b.label, rate: pct(count(rows, b.key), count(rows, a.key)), previousRate: pct(count(previous, b.key), count(previous, a.key)) })
  }
  return out
}

/** Leads by category and day into table rows with shares, biggest first. Pure. */
export function categoryRows(cells: Array<{ label: string; day: string; n: number }>, days: string[], otherLabel: string): { rows: CategoryRow[]; dayTotals: number[]; total: number } {
  const index = new Map(days.map((d, i) => [d, i]))
  const by = new Map<string, number[]>()
  for (const c of cells) {
    const i = index.get(c.day)
    if (i === undefined) continue
    const label = c.label.trim() || otherLabel
    const row = by.get(label) ?? new Array<number>(days.length).fill(0)
    row[i] += c.n
    by.set(label, row)
  }
  const dayTotals = new Array<number>(days.length).fill(0)
  let total = 0
  for (const row of by.values()) row.forEach((n, i) => { dayTotals[i] += n; total += n })
  const rows = [...by.entries()]
    .map(([label, byDay]) => {
      const t = byDay.reduce((a, b) => a + b, 0)
      return { label, byDay, total: t, share: total > 0 ? Math.round((t / total) * 1000) / 10 : 0 }
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  return { rows, dayTotals, total }
}

type Db = typeof prisma
type RawDb = Pick<Db, '$queryRaw'>

/**
 * The SQL this deck adds to the summary, on its own so it can be checked
 * against a real database: ad arrivals by business day, leads by category
 * and day, both periods' totals, funnel marks, distinct ads.
 */
export async function presentationRows(db: RawDb, accountId: string, p: Pick<ReportPeriod, 'from' | 'to' | 'prevFrom' | 'prevTo'>, zone: Prisma.Sql) {
  const [touches, prevTouches, cats, prevCats, marks, prevMarks, ads] = await Promise.all([
    db.$queryRaw<Array<{ day: string; n: bigint }>>`
      SELECT (t.touched_at AT TIME ZONE ${zone})::date::text AS day, count(*) AS n
      FROM ad_touches t WHERE t.account_id = ${accountId}::uuid AND t.touched_at >= ${p.from} AND t.touched_at < ${p.to} GROUP BY 1`,
    db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM ad_touches t WHERE t.account_id = ${accountId}::uuid AND t.touched_at >= ${p.prevFrom} AND t.touched_at < ${p.prevTo}`,
    db.$queryRaw<Array<{ key: string | null; day: string; n: bigint }>>`
      SELECT l.service_category_key AS key, (l.created_at AT TIME ZONE ${zone})::date::text AS day, count(*) AS n
      FROM leads l WHERE l.account_id = ${accountId}::uuid AND l.is_hidden = false AND l.ai_suggested = false
        AND l.created_at >= ${p.from} AND l.created_at < ${p.to} GROUP BY 1, 2`,
    db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM leads l WHERE l.account_id = ${accountId}::uuid AND l.is_hidden = false AND l.ai_suggested = false
        AND l.created_at >= ${p.prevFrom} AND l.created_at < ${p.prevTo}`,
    funnelMarks(db, accountId, p.from, p.to),
    funnelMarks(db, accountId, p.prevFrom, p.prevTo),
    db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(DISTINCT ad_id) AS n FROM ad_touches
      WHERE account_id = ${accountId}::uuid AND ad_id IS NOT NULL AND touched_at >= ${p.from} AND touched_at < ${p.to}`,
  ])
  return { touches, prevTouches, cats, prevCats, marks, prevMarks, activeAds: Number(ads[0]?.n ?? 0) }
}

async function funnelMarks(db: RawDb, accountId: string, from: Date, to: Date) {
  const cohort = Prisma.sql`l.account_id = ${accountId}::uuid AND l.is_hidden = false AND l.ai_suggested = false AND l.created_at >= ${from} AND l.created_at < ${to}`
  const [marks, won] = await Promise.all([
    db.$queryRaw<Array<{ lead_id: string; stage_key: string | null; assigned_to: string | null }>>`
      SELECT DISTINCT a.lead_id, a.metadata->>'stage_key' AS stage_key, l.assigned_to
      FROM lead_activities a JOIN leads l ON l.id = a.lead_id
      WHERE a.account_id = ${accountId}::uuid AND a.type = 'stage' AND ${cohort}`,
    db.$queryRaw<Array<{ id: string; assigned_to: string | null }>>`
      SELECT l.id, l.assigned_to FROM leads l WHERE ${cohort} AND l.status = 'closed' AND l.converted_at IS NOT NULL`,
  ])
  return { marks: marks.filter((m) => m.stage_key) as Array<{ lead_id: string; stage_key: string; assigned_to: string | null }>, won }
}

function funnelFor(stages: FunnelStage[], m: Awaited<ReturnType<typeof funnelMarks>>, userId?: string): FunnelRow[] {
  const marks = userId ? m.marks.filter((x) => x.assigned_to === userId) : m.marks
  const won = userId ? m.won.filter((x) => x.assigned_to === userId) : m.won
  const wonIds = new Set(won.map((w) => w.id))
  const ids = new Set([...wonIds, ...marks.map((x) => x.lead_id)])
  return countFunnel(stages, [...ids].map((id) => ({ id, won: wonIds.has(id) })), marks.map((x) => ({ leadId: x.lead_id, stageKey: x.stage_key })))
}

export async function loadPresentation(a: {
  accountId: string; period: ReportPeriod; tz: string; now: Date; db?: Db
  /** The team summary, when the caller already built it (not rebuilt here). */
  summary?: ReportSummary
}): Promise<PresentationData> {
  const db = a.db ?? prisma
  const { period: p, accountId, tz, now } = a
  const days = daysBetween(p.firstDay, p.lastDay)
  const prevFirst = addDays(p.firstDay, -days.length)
  const prevLast = addDays(p.firstDay, -1)
  const zone = await zoneForSql(db, tz, now)

  const [settings, summary, speed, insights, previous, raw] = await Promise.all([
    db.leadSettings.findUnique({ where: { account_id: accountId }, select: { funnel_stages: true, report_settings: true } }),
    a.summary ?? buildSummary({ accountId, userId: null, period: p, now, tz, db }),
    replySpeed({ accountId, userId: null, from: p.from, to: p.to, db }).catch(() => null),
    accountInsights(accountId, p.firstDay, p.lastDay),
    accountInsights(accountId, prevFirst, prevLast),
    presentationRows(db, accountId, p, zone),
  ])
  const { touches, prevTouches, cats, prevCats, marks, prevMarks, activeAds } = raw

  const presentation = parsePresentationSettings(settings?.report_settings)
  const stages = parseFunnel(settings?.funnel_stages)
  const keys = [...new Set(cats.map((c) => c.key).filter((k): k is string => Boolean(k)))]
  const labels = keys.length
    ? await db.serviceCategory.findMany({ where: { account_id: accountId, key: { in: keys } }, select: { key: true, label: true } })
    : []
  const labelOf = new Map(labels.map((l) => [l.key, l.label]))
  const categories = categoryRows(cats.map((c) => ({ label: c.key ? labelOf.get(c.key) ?? c.key : '', day: c.day, n: Number(c.n) })), days, '')

  const byDay = new Map(touches.map((t) => [t.day, Number(t.n)]))
  const conversationsByDay = days.map((d) => byDay.get(d) ?? 0)

  const rows = funnelFor(stages, marks)
  const previousRows = funnelFor(stages, prevMarks)
  const open = stages.filter((s) => s.outcome !== 'lost')
  const team: TeamStageRow[] = summary.agents.map((ag) => {
    const mine = funnelFor(stages, marks, ag.userId)
    return {
      userId: ag.userId,
      name: ag.name,
      calls: ag.calls,
      connected: ag.connected,
      notConnected: Math.max(0, ag.calls - ag.connected),
      stages: open.map((s) => mine.find((r) => r.key === s.key)?.count ?? 0),
      won: ag.won,
    }
  })

  return {
    period: { kind: p.kind, firstDay: p.firstDay, lastDay: p.lastDay, timeZone: tz, days, previousFirstDay: prevFirst, previousLastDay: prevLast },
    brandColor: presentation.brandColor,
    categoryLabel: presentation.categoryLabel,
    summary,
    ads: {
      insights, previous, conversationsByDay,
      conversations: conversationsByDay.reduce((s, n) => s + n, 0),
      previousConversations: Number(prevTouches[0]?.n ?? 0),
      activeAds,
    },
    categories: { ...categories, previousTotal: Number(prevCats[0]?.n ?? 0) },
    funnel: {
      stages, rows, previousRows,
      conversions: conversions(stages, rows, previousRows),
      attendRate: pct(summary.calls.connected, summary.calls.total),
      previousAttendRate: null,
    },
    team,
    speedFinding: speed ? speedFinding(speed.rows) : null,
  }
}
