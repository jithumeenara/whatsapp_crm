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

  // Findings written by code from the numbers above (the Performance guide goes deeper).
  const findings: Finding[] = []
  if (prev && prev.cohort.total >= 10) {
    const ch = Math.round(((s.cohort.total - prev.cohort.total) / prev.cohort.total) * 100)
    if (ch <= -15) findings.push({ severity: 'high', title: `Leads fell ${Math.abs(ch)}%`, evidence: `${num(s.cohort.total)} now against ${num(prev.cohort.total)} before.`, suggestion: 'Open the Lead report to see which source dropped.', href: link('/reports/leads') })
    if (ch >= 15) findings.push({ severity: 'good', title: `Leads rose ${ch}%`, evidence: `${num(s.cohort.total)} now against ${num(prev.cohort.total)} before.`, suggestion: 'Make sure the team keeps up with the extra calls.', href: link('/reports/agents') })
  }
  const worst = data.funnel.conversions.filter((cv) => cv.rate != null && cv.previousRate != null && cv.previousRate - (cv.rate ?? 0) >= 10).sort((a, b) => (b.previousRate! - b.rate!) - (a.previousRate! - a.rate!))[0]
  if (worst) findings.push({ severity: 'medium', title: `${worst.from} → ${worst.to} dropped to ${worst.rate}%`, evidence: `It was ${worst.previousRate}% before.`, suggestion: 'Check what changed at this step.', href: link('/reports/leads') })
  if (s.leaks.neverContacted.count >= 5) findings.push({ severity: 'high', title: `${num(s.leaks.neverContacted.count)} leads were never contacted`, evidence: `Older than ${s.leakHours} hours with no call or reply.`, suggestion: 'Assign them and call today.', href: '/leads' })
  if (data.speedFinding) findings.push({ severity: 'low', title: 'Speed wins', evidence: data.speedFinding, suggestion: 'Answer new leads within 5 minutes where you can.' })
  if (findings.length) blocks.push({ kind: 'findings', id: 'findings', title: 'Main findings', items: findings.slice(0, 4) })

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

