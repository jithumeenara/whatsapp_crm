/**
 * Lead report: how many leads, from where, which category, how far they
 * got, why they were lost, how fast they got a first answer — each against
 * the comparison period. Counts only for anything about customers.
 */

import { buildSummary } from '../../summary'
import { replySpeed, type SpeedBucket } from '../../reply-speed'
import { loadPresentation } from '../../presentation'
import type { Block, ReportDoc } from '../types'
import { previousAsMain } from '../period-query'
import { cell, changeCell, COUNT, dayLabel, kpi, num, pct, PERCENT, periodInfo, pctText, words, type ReportContext } from './common'
import { loadActivity } from '../activity'
import { changeLabel, judgeChange } from '../change'
import { pushFirstCall, pushIdle } from './agents'
import { cleanPersonName } from '@/lib/auth/person-name'

const SPEED_LABEL: Record<SpeedBucket, string> = {
  min5: 'Within 5 minutes', hour1: '5 to 60 minutes', day1: '1 to 24 hours', later: 'After a day', none: 'Not answered yet',
}

export async function leadReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [s, prev, data, speed, act] = await Promise.all([
    buildSummary({ accountId: c.accountId, userId: c.userId, period: p, now: c.now, tz: c.tz }),
    comparing ? buildSummary({ accountId: c.accountId, userId: c.userId, period: previousAsMain(p), now: c.now, tz: c.tz }) : null,
    loadPresentation({ accountId: c.accountId, period: p, tz: c.tz, now: c.now, userId: c.userId, skipMeta: true }),
    replySpeed({ accountId: c.accountId, userId: c.userId, from: p.from, to: p.to }).catch(() => null),
    loadActivity({ accountId: c.accountId, userId: c.userId, period: p, tz: c.tz, now: c.now }).catch((err) => {
      console.error('[reports] lead activity failed:', err instanceof Error ? err.message : err)
      return null
    }),
  ])
  const before = (v: number) => (comparing ? v : null)
  const conv = pct(s.wonInPeriod, s.cohort.total)
  const prevConv = prev ? pct(prev.wonInPeriod, prev.cohort.total) : null
  const catLabel = data.categoryLabel || 'Category'

  const blocks: Block[] = []

  blocks.push({
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Leads', s.cohort.total, before(s.previousCohort.total)),
      kpi('Won', s.wonInPeriod, before(s.previousWonInPeriod)),
      kpi('Lost', s.lostInPeriod, prev ? prev.lostInPeriod : null, { higherIsBetter: false }),
      kpi('Still open', s.cohort.open, prev ? prev.cohort.open : null, { higherIsBetter: false }),
      kpi('Won %', conv, prevConv, { fmt: PERCENT }),
      kpi('Never contacted', s.leaks.neverContacted.count, null, { higherIsBetter: false, sub: `Older than ${s.leakHours} h`, tone: s.leaks.neverContacted.count ? 'bad' : 'good' }),
    ],
  })

  blocks.push({
    kind: 'chart', id: 'by-day', title: 'Leads by day', chart: 'bar',
    labels: data.period.days.map(dayLabel),
    series: [{ name: 'Leads', values: data.categories.dayTotals, fmt: COUNT }],
    alt: `Leads by day: ${data.period.days.map((d, i) => `${d} ${data.categories.dayTotals[i]}`).slice(0, 40).join(', ')}`,
  })

  if (data.funnel.stages.length) {
    const open = data.funnel.stages.filter((st) => st.outcome !== 'lost')
    const count = (rows: typeof data.funnel.rows, key: string) => rows.find((r) => r.key === key)?.count ?? 0
    blocks.push({
      kind: 'chart', id: 'funnel', title: 'Your stages', chart: 'funnel',
      labels: open.map((st) => st.label),
      series: [{ name: 'Reached', values: open.map((st) => count(data.funnel.rows, st.key)), previous: comparing ? open.map((st) => count(data.funnel.previousRows, st.key)) : undefined }],
    })
    blocks.push({
      kind: 'table', id: 'conversion', title: 'Stage to stage',
      columns: [{ label: 'From → to', align: 'left', width: 2 }, { label: 'Now', align: 'right' }, { label: 'Before', align: 'right' }, { label: 'Change', align: 'right' }],
      rows: data.funnel.conversions.map((cv) => [
        cell(`${cv.from} → ${cv.to}`),
        cell(pctText(cv.rate), cv.rate),
        cell(comparing ? pctText(cv.previousRate) : '—', cv.previousRate),
        changeCell(cv.rate, comparing ? cv.previousRate : null, true, PERCENT),
      ]),
    })
  } else {
    blocks.push({ kind: 'text', id: 'no-stages', style: 'note', lines: ['Set up your stages in Settings → Reports to see how far leads get.'] })
  }

  const prevSource = new Map((prev?.bySource ?? []).map((x) => [x.source, x]))
  blocks.push({
    kind: 'table', id: 'sources', title: 'Where leads came from',
    columns: [{ label: 'Source', align: 'left', width: 2 }, { label: 'Leads', align: 'right' }, { label: 'Before', align: 'right' }, { label: 'Change', align: 'right' }, { label: 'Won', align: 'right' }, { label: 'Won %', align: 'right' }],
    rows: s.bySource.map((x) => {
      const b = prevSource.get(x.source)
      return [
        cell(x.source === 'Unknown' ? 'Unknown' : words(x.source)),
        cell(num(x.total), x.total),
        cell(comparing ? num(b?.total ?? 0) : '—', b?.total ?? 0),
        changeCell(x.total, comparing ? b?.total ?? 0 : null),
        cell(num(x.won), x.won),
        cell(pctText(pct(x.won, x.total)), pct(x.won, x.total)),
      ]
    }),
  })

  if (data.categories.rows.length) {
    const days = data.period.days
    const weekly = days.length > 14
    const groups = weekly ? Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7)) : days.map((d) => [d])
    const sum = (byDay: number[], g: string[]) => g.reduce((a, d) => a + (byDay[days.indexOf(d)] ?? 0), 0)
    blocks.push({
      kind: 'table', id: 'category-day', title: `Leads by ${catLabel.toLowerCase()} and ${weekly ? 'week' : 'day'}`,
      columns: [{ label: catLabel, align: 'left', width: 2 }, ...groups.map((g) => ({ label: weekly ? `${dayLabel(g[0])}–${dayLabel(g[g.length - 1])}` : dayLabel(g[0]), align: 'center' as const })), { label: 'Total', align: 'right' }, { label: 'Share', align: 'right' }],
      rows: data.categories.rows.map((r) => [
        cell(r.label || 'Not set'),
        ...groups.map((g) => cell(sum(r.byDay, g) ? num(sum(r.byDay, g)) : '–', sum(r.byDay, g))),
        cell(num(r.total), r.total),
        cell(`${r.share}%`, r.share / 100),
      ]),
      total: [cell('Total'), ...groups.map((g) => cell(num(sum(data.categories.dayTotals, g)), sum(data.categories.dayTotals, g))), cell(num(data.categories.total), data.categories.total), cell('100%', 1)],
    })
  }

  if (s.lostReasons.length) {
    blocks.push({
      kind: 'chart', id: 'lost', title: 'Why leads were lost', chart: 'hbar',
      labels: s.lostReasons.map((x) => x.reason),
      series: [{ name: 'Lost', values: s.lostReasons.map((x) => x.count) }],
    })
  }

  if (speed?.countedSince && speed.rows.some((r) => r.leads > 0)) {
    blocks.push({
      kind: 'table', id: 'speed', title: 'How fast leads got a first answer',
      columns: [{ label: 'First answer', align: 'left', width: 2 }, { label: 'Leads', align: 'right' }, { label: 'Won %', align: 'right' }],
      rows: speed.rows.map((r) => [cell(SPEED_LABEL[r.bucket]), cell(num(r.leads), r.leads), cell(r.winRate == null ? (r.leads ? 'Too few' : '—') : `${r.winRate}%`, r.winRate)]),
      note: data.speedFinding ?? undefined,
    })
  }

  if (act) {
    pushFirstCall(blocks, act)
    const owners = new Map(s.agents.map((a) => [a.userId, cleanPersonName(a.name) || 'Former member']))
    pushIdle(blocks, act, s.scope === 'team', owners)
  }

  const leaks = [
    s.leaks.neverContacted.count ? `${num(s.leaks.neverContacted.count)} leads nobody has contacted` : null,
    s.leaks.waitingChats.count ? `${num(s.leaks.waitingChats.count)} customers waiting for a reply` : null,
    s.leaks.overdueFollowUps.count ? `${num(s.leaks.overdueFollowUps.count)} overdue follow-ups` : null,
    s.scope === 'team' && s.leaks.unassigned.count ? `${num(s.leaks.unassigned.count)} open leads with no owner` : null,
  ].filter((x): x is string => Boolean(x))
  blocks.push({ kind: 'text', id: 'todo', title: 'Needs doing now', style: leaks.length ? 'warning' : 'note', lines: leaks.length ? leaks : ['Nothing is waiting.'] })

  // The shared rule (change.ts): nothing said from a small base.
  const lc = comparing ? judgeChange({ now: s.cohort.total, before: s.previousCohort.total, higherIsBetter: true, fmt: COUNT }) : null
  const lcText = lc && lc.kind !== 'none' && lc.kind !== 'small' ? changeLabel(lc, String) : null
  const vsBefore = lcText ? ` (${lc?.kind === 'times' ? lcText : `${lcText} on before`})` : ''
  const headline = `${num(s.cohort.total)} leads${vsBefore}, ${num(s.wonInPeriod)} won${s.leaks.neverContacted.count ? `; ${num(s.leaks.neverContacted.count)} not contacted yet` : ''}.`

  return {
    key: 'leads', title: 'Lead report', headline, period: periodInfo(c), scope: c.userId ? 'self' : 'team',
    blocks,
    notes: [
      speed?.countedSince ? `First-answer times are counted from ${speed.countedSince.slice(0, 10)}.` : null,
      act?.firstCall.countedSince ? `Time to first call is counted for leads since calls were first logged (${act.firstCall.countedSince}).` : null,
    ].filter((x): x is string => Boolean(x)),
    generatedAt: c.now.toISOString(),
  }
}
