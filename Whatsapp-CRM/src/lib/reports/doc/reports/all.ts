/**
 * All report: a little of every topic — the figures that matter most, each
 * card opening its own report with the same period, plus what needs doing
 * now and the main findings. The deep detail lives in the topic reports.
 */

import { buildSummary } from '../../summary'
import { loadPresentation } from '../../presentation'
import { replySpeed } from '../../reply-speed'
import type { Block, Finding, ReportDoc } from '../types'
import { previousAsMain } from '../period-query'
import { loadGuide } from './guide'
import { carryQuery, COUNT, dayLabel, kpi, mainCurrency, moneyFmt, moneyIn, num, pct, PERCENT, periodInfo, type ReportContext } from './common'

export async function allReport(c: ReportContext, canSeeMoney: boolean): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [s, prev, data, speed] = await Promise.all([
    buildSummary({ accountId: c.accountId, userId: c.userId, period: p, now: c.now, tz: c.tz }),
    comparing ? buildSummary({ accountId: c.accountId, userId: c.userId, period: previousAsMain(p), now: c.now, tz: c.tz }) : null,
    loadPresentation({ accountId: c.accountId, period: p, tz: c.tz, now: c.now, userId: c.userId, skipMeta: !canSeeMoney }),
    replySpeed({ accountId: c.accountId, userId: c.userId, from: p.from, to: p.to }).catch(() => null),
  ])
  const q = carryQuery(c)
  const link = (path: string) => `${path}?${q}`
  const cur = mainCurrency([s.revenue, s.pipeline])
  const ads = data.ads.insights.status === 'ok' ? data.ads.insights : null
  const fast = speed?.rows.find((r) => r.bucket === 'min5')
  const fastShare = speed && speed.rows.reduce((x, r) => x + r.leads, 0) > 0 ? pct(fast?.leads ?? 0, speed.rows.reduce((x, r) => x + r.leads, 0)) : null

  const items = [
    kpi('Leads', s.cohort.total, comparing ? s.previousCohort.total : null, { href: link('/reports/leads') }),
    kpi('Won', s.wonInPeriod, comparing ? s.previousWonInPeriod : null, { href: link('/reports/leads') }),
    kpi('Calls attended', pct(s.calls.connected, s.calls.total), prev ? pct(prev.calls.connected, prev.calls.total) : null, { fmt: PERCENT, sub: `${num(s.calls.connected)} of ${num(s.calls.total)} calls`, href: link('/reports/agents') }),
    kpi('Answered within 5 min', fastShare, null, { fmt: PERCENT, href: link('/reports/leads') }),
  ]
  if (canSeeMoney) {
    items.push(
      kpi('Revenue won', moneyIn(s.revenue, cur), prev ? moneyIn(prev.revenue, cur) : null, { fmt: moneyFmt(cur), tone: 'money', href: link('/reports/sales') }),
      kpi('Open pipeline', moneyIn(s.pipeline, cur), null, { fmt: moneyFmt(cur), href: link('/reports/sales') }),
      kpi('Ad conversations', data.ads.conversations, comparing ? data.ads.previousConversations : null, { href: link('/reports/ads') }),
      kpi('Ad spend', ads?.totals.spend ?? null, null, { fmt: moneyFmt(ads?.totals.currency ?? cur), higherIsBetter: false, display: ads ? undefined : '—', href: link('/reports/spending') }),
    )
  }
  const blocks: Block[] = [{ kind: 'kpis', id: 'figures', items }]

  blocks.push({
    kind: 'chart', id: 'leads-by-day', title: 'Leads by day', chart: 'bar',
    labels: data.period.days.map(dayLabel),
    series: [{ name: 'Leads', values: data.categories.dayTotals, fmt: COUNT }],
  })

  const todo = [
    s.leaks.neverContacted.count ? `${num(s.leaks.neverContacted.count)} leads nobody has contacted` : null,
    s.leaks.waitingChats.count ? `${num(s.leaks.waitingChats.count)} customers waiting for a reply` : null,
    s.leaks.overdueFollowUps.count ? `${num(s.leaks.overdueFollowUps.count)} overdue follow-ups` : null,
    s.scope === 'team' && s.leaks.unassigned.count ? `${num(s.leaks.unassigned.count)} open leads with no owner` : null,
  ].filter((x): x is string => Boolean(x))
  blocks.push({ kind: 'text', id: 'todo', title: 'Needs doing now', style: todo.length ? 'warning' : 'note', lines: todo.length ? todo : ['Nothing is waiting.'] })

  // The Performance guide's three most serious cards (the full list is its own report).
  const guide = await loadGuide(c, { s, prev, data }, canSeeMoney).catch((err) => {
    console.error('[reports] guide for the All report failed:', err instanceof Error ? err.message : err)
    return null
  })
  if (guide) {
    const top: Finding[] = guide.findings.slice(0, 3)
    blocks.push({ kind: 'findings', id: 'findings', title: 'Top 3 from the Performance guide', items: top })
    blocks.push({ kind: 'kpis', id: 'guide-link', items: [kpi('Open the Performance guide', guide.findings.filter((f) => f.severity !== 'good').length, null, { sub: 'things to work on', href: link('/reports/guide') })] })
  }

  return {
    key: 'all', title: c.userId ? 'My report' : 'All report',
    headline: `${num(s.cohort.total)} leads, ${num(s.wonInPeriod)} won${canSeeMoney && moneyIn(s.revenue, cur) > 0 ? `, ${moneyFmtText(moneyIn(s.revenue, cur), cur)} earned` : ''}${s.leaks.neverContacted.count ? `; ${num(s.leaks.neverContacted.count)} not contacted yet` : ''}.`,
    period: periodInfo(c), scope: c.userId ? 'self' : 'team', blocks, notes: [], generatedAt: c.now.toISOString(),
  }
}

function moneyFmtText(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)
  } catch {
    return `${currency} ${Math.round(v)}`
  }
}

