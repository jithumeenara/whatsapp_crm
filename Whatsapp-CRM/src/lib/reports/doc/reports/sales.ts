/**
 * Sales & Pipeline report: revenue won, amount lost, the open pipeline by
 * stage, revenue by category — against the comparison period. Money comes
 * from Pipeline deals; amounts in different currencies are never added.
 */

import { buildSummary } from '../../summary'
import type { Block, ReportDoc } from '../types'
import { previousAsMain } from '../period-query'
import { cell, kpi, mainCurrency, money, moneyFmt, moneyIn, num, periodInfo, type ReportContext } from './common'

export async function salesReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [s, prev] = await Promise.all([
    buildSummary({ accountId: c.accountId, userId: c.userId, period: p, now: c.now, tz: c.tz }),
    comparing ? buildSummary({ accountId: c.accountId, userId: c.userId, period: previousAsMain(p), now: c.now, tz: c.tz }) : null,
  ])
  const cur = mainCurrency([s.revenue, s.pipeline, s.lostAmount, prev?.revenue ?? []])
  const revenue = moneyIn(s.revenue, cur)
  const prevRevenue = prev ? moneyIn(prev.revenue, cur) : null
  const lost = moneyIn(s.lostAmount, cur)
  const prevLost = prev ? moneyIn(prev.lostAmount, cur) : null
  const pipe = moneyIn(s.pipeline, cur)
  const wonDeals = s.revenue.reduce((x, m) => x + m.deals, 0)
  const prevWonDeals = prev ? prev.revenue.reduce((x, m) => x + m.deals, 0) : null
  const avgDeal = wonDeals > 0 ? revenue / wonDeals : null
  const prevAvg = prevWonDeals && prevRevenue != null ? prevRevenue / prevWonDeals : null
  const other = s.revenue.filter((m) => m.currency !== cur && m.amount > 0)
  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Revenue won', revenue, prevRevenue, { fmt: moneyFmt(cur), tone: 'money' }),
      kpi('Deals won', wonDeals, prevWonDeals),
      kpi('Average deal', avgDeal, prevAvg, { fmt: moneyFmt(cur) }),
      kpi('Amount lost', lost, prevLost, { fmt: moneyFmt(cur), higherIsBetter: false }),
      kpi('Open pipeline', pipe, null, { fmt: moneyFmt(cur), sub: `${num(s.pipeline.reduce((x, m) => x + m.deals, 0))} open deals` }),
    ],
  }]

  if (s.pipelineByStage.length) {
    blocks.push({
      kind: 'chart', id: 'pipeline-chart', title: 'Open pipeline by stage', chart: 'hbar',
      labels: s.pipelineByStage.filter((x) => x.currency === cur).map((x) => `${x.stage} · ${x.pipeline}`),
      series: [{ name: 'Amount', values: s.pipelineByStage.filter((x) => x.currency === cur).map((x) => x.amount), fmt: moneyFmt(cur) }],
    })
    blocks.push({
      kind: 'table', id: 'pipeline', title: 'Pipeline by stage',
      columns: [{ label: 'Pipeline', align: 'left' }, { label: 'Stage', align: 'left' }, { label: 'Deals', align: 'right' }, { label: 'Amount', align: 'right', fmt: moneyFmt(cur) }],
      rows: s.pipelineByStage.map((x) => [cell(x.pipeline), cell(x.stage), cell(num(x.deals), x.deals), cell(money(x.amount, x.currency), x.amount)]),
    })
  } else {
    blocks.push({ kind: 'text', id: 'no-pipeline', style: 'note', lines: ['No open deals right now. Deals are added from a lead or the Pipelines page.'] })
  }

  const prevCat = new Map((prev?.byCategory ?? []).map((x) => [`${x.category}|${x.currency}`, x]))
  if (s.byCategory.length) {
    blocks.push({
      kind: 'table', id: 'categories', title: 'Revenue by category',
      columns: [{ label: 'Category', align: 'left', width: 2 }, { label: 'Deals', align: 'right' }, { label: 'Amount', align: 'right' }, { label: 'Before', align: 'right' }],
      rows: s.byCategory.map((x) => {
        const b = prevCat.get(`${x.category}|${x.currency}`)
        return [cell(x.category), cell(num(x.deals), x.deals), cell(money(x.amount, x.currency), x.amount), cell(comparing ? money(b?.amount ?? 0, x.currency) : '—', b?.amount ?? 0)]
      }),
    })
  }

  const notes: string[] = []
  if (other.length) notes.push(`Revenue in other currencies is not added to ${cur}: ${other.map((m) => money(m.amount, m.currency)).join(', ')}.`)
  const missing = s.revenue.reduce((x, m) => x + m.deals - m.withAmount, 0)
  if (missing) notes.push(`${num(missing)} won deals have no amount, so revenue is incomplete.`)
  if (s.wonWithoutDate) notes.push(`${num(s.wonWithoutDate)} won deals were closed before win dates were recorded and are in no period.`)

  return {
    key: 'sales', title: 'Sales & Pipeline report',
    headline: `${money(revenue, cur)} won from ${num(wonDeals)} deals; ${money(pipe, cur)} still open in the pipeline.`,
    period: periodInfo(c), scope: c.userId ? 'self' : 'team', blocks, notes, generatedAt: c.now.toISOString(),
  }
}
