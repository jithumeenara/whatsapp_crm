/**
 * The Compare tab of a report (plan §3, §9): two to four periods, team
 * members, sources, categories or WhatsApp numbers side by side — the
 * same numbers for each, a line per item by day, stage reach as bars, and
 * one sentence written by code.
 *
 * Who sees what: the scope is the report's (registry.ts). Someone seeing
 * only their own work compares only their own periods. Items come from
 * the address but are used only when they match options built from this
 * business's data (compare-core.ts pickItems).
 *
 * Counted on leads that came in during each period and what has become
 * of them so far (the same cohort as the stage funnel).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { cleanPersonName } from '@/lib/auth/person-name'
import { parseFunnel } from '../settings'
import { zoneForSql } from '../summary'
import { daysBetween } from '../presentation'
import { resolveQuery } from './period-query'
import type { Block, ReportDoc, TableCell } from './types'
import { compareSentence, dimsFor, DIM_LABEL, MAX_ITEMS, MIN_LEADS, pickItems, summarise, wonPct, type CompareDim, type Option, type SliceRow, type SliceStats } from './compare-core'
import { cell, COUNT, dayLabel, num, pct, PERCENT, periodInfo, pctText, words, type ReportContext } from './reports/common'

const ROW_CAP = 50_000

function keyExpr(dim: CompareDim): Prisma.Sql {
  // Allow-list: the only column expressions a comparison can group by.
  switch (dim) {
    case 'agent': return Prisma.sql`COALESCE(l.assigned_to::text, '__none')`
    case 'source': return Prisma.sql`COALESCE(NULLIF(l.source, ''), 'Unknown')`
    case 'category': return Prisma.sql`COALESCE(l.service_category_key, '__none')`
    case 'number': return Prisma.sql`COALESCE(l.whatsapp_config_id::text, '__none')`
    case 'ad': return Prisma.sql`COALESCE(l.ad_id, '__none')`
    default: return Prisma.sql`'all'`
  }
}

async function loadRows(accountId: string, userId: string | null, dim: CompareDim, from: Date, to: Date, zone: Prisma.Sql) {
  const mine = userId ? Prisma.sql`AND l.assigned_to = ${userId}::uuid` : Prisma.empty
  const cohort = Prisma.sql`l.account_id = ${accountId}::uuid AND l.is_hidden = false AND l.ai_suggested = false AND l.created_at >= ${from} AND l.created_at < ${to} ${mine}`
  const [rows, marks] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; key: string; day: string; won: boolean; lost: boolean; reply_min: number | null; source: string | null }>>`
      SELECT l.id::text AS id, ${keyExpr(dim)} AS key, ((l.created_at AT TIME ZONE ${zone})::date)::text AS day,
             (l.status = 'closed' AND l.converted_at IS NOT NULL) AS won,
             (l.status = 'closed' AND l.converted_at IS NULL) AS lost,
             EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 60 AS reply_min,
             NULLIF(l.source, '') AS source
      FROM leads l WHERE ${cohort}
      LIMIT ${ROW_CAP}::int`,
    prisma.$queryRaw<Array<{ lead_id: string; stage_key: string | null }>>`
      SELECT DISTINCT a.lead_id::text AS lead_id, a.metadata->>'stage_key' AS stage_key
      FROM lead_activities a JOIN leads l ON l.id = a.lead_id
      WHERE a.account_id = ${accountId}::uuid AND a.type = 'stage' AND ${cohort}`,
  ])
  const sliceRows: SliceRow[] = rows.map((r) => ({ id: r.id, key: r.key, day: r.day, won: r.won, lost: r.lost, replyMin: r.reply_min == null ? null : Number(r.reply_min), source: r.source }))
  return { rows: sliceRows, marks: marks.filter((m) => m.stage_key).map((m) => ({ leadId: m.lead_id, stageKey: m.stage_key as string })) }
}

/** Options for a dimension: only what this business has, busiest first. */
async function loadOptions(accountId: string, dim: CompareDim, counts: Map<string, number>): Promise<Option[]> {
  const byCount = (a: Option, b: Option) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0) || a.label.localeCompare(b.label)
  if (dim === 'agent') {
    const people = await prisma.profile.findMany({
      where: { account_id: accountId, account_role: { in: ['agent', 'supervisor', 'admin', 'owner'] } },
      select: { user_id: true, full_name: true },
    })
    return people.map((p) => ({ key: p.user_id, label: cleanPersonName(p.full_name) || 'Team member' })).sort(byCount)
  }
  if (dim === 'category') {
    const cats = await prisma.serviceCategory.findMany({ where: { account_id: accountId }, select: { key: true, label: true } })
    const label = new Map(cats.map((c) => [c.key, c.label]))
    return [...counts.keys()].map((k) => ({ key: k, label: k === '__none' ? 'Not set' : label.get(k) ?? words(k) })).sort(byCount)
  }
  if (dim === 'number') {
    const nums = await prisma.whatsAppConfig.findMany({ where: { account_id: accountId }, select: { id: true, label: true, is_default: true }, orderBy: { created_at: 'asc' } })
    const label = new Map(nums.map((n, i) => [n.id, n.label?.trim() || (n.is_default ? 'Main number' : `Number ${i + 1}`)]))
    const keys = new Set([...counts.keys(), ...nums.map((n) => n.id)])
    return [...keys].map((k) => ({ key: k, label: k === '__none' ? 'Not from WhatsApp' : label.get(k) ?? 'Removed number' })).sort(byCount)
  }
  if (dim === 'ad') {
    const ids = [...counts.keys()].filter((k) => k !== '__none')
    const named = ids.length ? await prisma.adCatalog.findMany({ where: { account_id: accountId, ad_id: { in: ids } }, select: { ad_id: true, ad_name: true } }) : []
    const label = new Map(named.map((n) => [n.ad_id, n.ad_name?.trim() || `Ad ${n.ad_id}`]))
    return [...counts.keys()].map((k) => ({ key: k, label: k === '__none' ? 'Not from an ad' : label.get(k) ?? `Ad ${k}` })).sort(byCount)
  }
  // source
  return [...counts.keys()].map((k) => ({ key: k, label: k === 'Unknown' ? 'Unknown' : words(k) })).sort(byCount)
}

export interface CompareInput {
  reportKey: string
  title: string
  dim: string | null
  items: string | null
}

export async function compareDoc(c: ReportContext, input: CompareInput): Promise<ReportDoc> {
  const dims = dimsFor(input.reportKey, Boolean(c.userId))
  const dim: CompareDim = (dims as string[]).includes(input.dim ?? '') ? (input.dim as CompareDim) : 'period'
  const [settings, zone] = await Promise.all([
    prisma.leadSettings.findUnique({ where: { account_id: c.accountId }, select: { funnel_stages: true } }),
    zoneForSql(prisma, c.tz, c.now),
  ])
  const stages = parseFunnel(settings?.funnel_stages)
  const p = c.q.period
  const currentDays = daysBetween(p.firstDay, p.lastDay)

  let options: Option[]
  let selected: string[]
  const stats = new Map<string, SliceStats>()
  let labels: string[] = currentDays.map(dayLabel)
  let calls: Map<string, { calls: number; connected: number }> | null = null

  if (dim === 'period') {
    const again = (compare: 'previous' | 'year') => resolveQuery({ period: c.q.kind, from: p.firstDay, to: p.lastDay, compare }, c.now, c.tz)
    const prev = again('previous')
    const year = again('year')
    const span = (d: { firstDay: string; lastDay: string } | null | undefined) => (d ? `${dayLabel(d.firstDay)}${d.firstDay === d.lastDay ? '' : ` – ${dayLabel(d.lastDay)}`}` : '')
    const ranges: Record<string, { from: Date; to: Date; days: string[]; label: string }> = {
      current: { from: p.from, to: p.to, days: currentDays, label: `This period (${span(p)})` },
    }
    if (prev?.previousDays) ranges.previous = { from: prev.period.prevFrom, to: prev.period.prevTo, days: daysBetween(prev.previousDays.firstDay, prev.previousDays.lastDay), label: `Period before (${span(prev.previousDays)})` }
    if (year?.previousDays) ranges.last_year = { from: year.period.prevFrom, to: year.period.prevTo, days: daysBetween(year.previousDays.firstDay, year.previousDays.lastDay), label: `Last year (${span(year.previousDays)})` }
    options = Object.entries(ranges).map(([key, r]) => ({ key, label: r.label }))
    selected = pickItems(input.items, options)
    await Promise.all(selected.map(async (key) => {
      const r = ranges[key]
      const { rows, marks } = await loadRows(c.accountId, c.userId, 'period', r.from, r.to, zone)
      const s = summarise(rows, marks, stages, r.days).get('all')
      stats.set(key, s ?? emptyStats(stages, r.days.length))
    }))
    labels = currentDays.map((_, i) => `Day ${i + 1}`)
  } else {
    const { rows, marks } = await loadRows(c.accountId, c.userId, dim, p.from, p.to, zone)
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.key, (counts.get(r.key) ?? 0) + 1)
    options = await loadOptions(c.accountId, dim, counts)
    selected = pickItems(input.items, options)
    const all = summarise(rows.filter((r) => selected.includes(r.key)), marks, stages, currentDays)
    for (const k of selected) stats.set(k, all.get(k) ?? emptyStats(stages, currentDays.length))
    if (dim === 'agent') calls = await loadCalls(c.accountId, selected, p.from, p.to)
  }

  const label = new Map(options.map((o) => [o.key, o.label]))
  const items = selected.map((k) => ({ key: k, label: label.get(k) ?? k, stats: stats.get(k)! }))
  const two = items.length === 2
  const open = stages.filter((s) => s.outcome !== 'lost')

  // The code-written sentence is the headline; no need to repeat it.
  const blocks: Block[] = []

  const minutes = (v: number | null) => {
    if (v == null) return '—'
    return v < 60 ? `${Math.round(v)} min` : `${Math.round(v / 6) / 10} h`
  }
  /** How a difference reads: a count, percentage points or a wait. */
  type DiffKind = 'count' | 'points' | 'minutes'
  const diffText = (d: number, kind: DiffKind) => {
    if (kind === 'points') return `${d} pts`
    if (kind === 'minutes') return minutes(Math.abs(d))
    return num(Math.abs(d))
  }
  const diffCell = (a: number | null, b: number | null, kind: DiffKind): TableCell => {
    if (a == null || b == null) return cell('—')
    const d = Math.round((a - b) * 10) / 10
    if (d === 0) return cell(kind === 'points' ? '0 pts' : '0', 0)
    const sign = d > 0 ? '+' : '-'
    return cell(kind === 'points' ? `${d > 0 ? '+' : ''}${d} pts` : `${sign}${diffText(d, kind)}`, d)
  }
  const row = (name: string, values: Array<number | null>, text: (v: number | null) => string, kind: DiffKind = 'count'): TableCell[] => [
    cell(name), ...values.map((v) => cell(text(v), v)), ...(two ? [diffCell(values[0], values[1], kind)] : []),
  ]
  const rows: TableCell[][] = [
    row('Leads', items.map((i) => i.stats.leads), num),
    row('Won', items.map((i) => i.stats.won), num),
    row('Won %', items.map((i) => wonPct(i.stats)), pctText, 'points'),
    row('Lost', items.map((i) => i.stats.lost), num),
    row('Still open', items.map((i) => i.stats.open), num),
    ...open.map((st) => row(`Reached ${st.label}`, items.map((i) => pct(i.stats.funnel.find((f) => f.key === st.key)?.count ?? 0, i.stats.leads)), pctText, 'points')),
    row('First reply, middle wait', items.map((i) => i.stats.replyMedian), minutes, 'minutes'),
  ]
  if (calls) {
    rows.push(
      row('Calls', items.map((i) => calls!.get(i.key)?.calls ?? 0), num),
      row('Attended %', items.map((i) => { const x = calls!.get(i.key); return x ? pct(x.connected, x.calls) : null }), pctText, 'points'),
    )
  }
  blocks.push({
    kind: 'table', id: 'side-by-side', title: 'Side by side',
    columns: [{ label: 'Measure', align: 'left', width: 2 }, ...items.map((i) => ({ label: i.label, align: 'right' as const })), ...(two ? [{ label: 'Difference', align: 'right' as const }] : [])],
    rows,
    note: items.some((i) => i.stats.leads < MIN_LEADS) ? `Fewer than ${MIN_LEADS} leads on one side: read the percentages with care.` : undefined,
  })

  blocks.push({
    kind: 'chart', id: 'by-day', title: 'Leads by day', chart: 'line',
    labels,
    series: items.map((i) => ({ name: i.label, values: i.stats.byDay.slice(0, labels.length), fmt: COUNT })),
    note: dim === 'period' ? 'Day 1 is the first day of each period.' : undefined,
  })

  if (open.length) {
    blocks.push({
      kind: 'chart', id: 'stages', title: 'Share of leads that reached each stage', chart: 'bar',
      labels: open.map((s) => s.label),
      series: items.map((i) => ({ name: i.label, values: open.map((st) => pct(i.stats.funnel.find((f) => f.key === st.key)?.count ?? 0, i.stats.leads) ?? 0), fmt: PERCENT })),
    })
  }

  if (dim === 'agent') {
    const totals = new Map<string, number>()
    for (const i of items) for (const [s, n] of i.stats.sources) totals.set(s, (totals.get(s) ?? 0) + n)
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s]) => s)
    if (top.length) {
      blocks.push({
        kind: 'table', id: 'source-mix', title: 'Where each person\'s leads came from',
        columns: [{ label: 'Source', align: 'left', width: 2 }, ...items.map((i) => ({ label: i.label, align: 'right' as const }))],
        rows: top.map((s) => [cell(s === 'Unknown' ? 'Unknown' : words(s)), ...items.map((i) => { const n = i.stats.sources.get(s) ?? 0; const share = pct(n, i.stats.leads); return cell(`${num(n)} (${pctText(share)})`, share) })]),
        note: 'Compare like with like: someone given more ad leads, or harder ones, is not doing worse just because their won % is lower.',
      })
    }
  }

  return {
    key: input.reportKey,
    title: `${input.title}: compare ${DIM_LABEL[dim].toLowerCase()}`,
    headline: compareSentence(items),
    period: periodInfo(c),
    scope: c.subject && !c.subject.self ? 'member' : c.userId ? 'self' : 'team',
    blocks,
    notes: ['Counted on leads that came in during each period, and what has become of them so far.'],
    generatedAt: c.now.toISOString(),
    compare: {
      dims: dims.map((d) => ({ key: d, label: DIM_LABEL[d] })),
      dim,
      options: options.slice(0, 50),
      selected,
      max: MAX_ITEMS,
    },
  }
}

function emptyStats(stages: ReturnType<typeof parseFunnel>, days: number): SliceStats {
  return { leads: 0, won: 0, lost: 0, open: 0, byDay: Array.from({ length: days }, () => 0), replyMedian: null, sources: new Map(), funnel: stages.map((s) => ({ ...s, count: 0 })) }
}

async function loadCalls(accountId: string, users: string[], from: Date, to: Date) {
  const ids = users.filter((u) => /^[0-9a-f-]{36}$/i.test(u))
  if (!ids.length) return new Map<string, { calls: number; connected: number }>()
  const rows = await prisma.$queryRaw<Array<{ uid: string; total: bigint; connected: bigint }>>`
    SELECT a.user_id::text AS uid, count(*) AS total, count(*) FILTER (WHERE (a.metadata->>'connected')::boolean) AS connected
    FROM lead_activities a
    WHERE a.account_id = ${accountId}::uuid AND a.type = 'call' AND a.created_at >= ${from} AND a.created_at < ${to}
      AND a.user_id = ANY(${ids}::uuid[])
    GROUP BY 1`
  return new Map(rows.map((r) => [r.uid, { calls: Number(r.total), connected: Number(r.connected) }]))
}
