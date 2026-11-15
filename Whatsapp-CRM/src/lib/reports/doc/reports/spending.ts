/**
 * Spending & ROI report: WhatsApp messages, AI and Meta Ads, against the
 * comparison period, with cost per lead and per won deal, and the return:
 * revenue won against what was spent. Team money: supervisors and above.
 */

import { formatAmount, formatCost } from '@/lib/format/money'
import { loadSpending } from '../../spending'
import { channelLabel, dayAmount, type Money } from '../../spending-assemble'
import { buildSummary } from '../../summary'
import type { Block, ReportDoc } from '../types'
import { previousAsMain } from '../period-query'
import { cell, dayLabel, kpi, moneyFmt, moneyIn, num, periodInfo, type ReportContext } from './common'

const moneyText = (m: Money) => {
  const parts = Object.entries(m).map(([c, a]) => formatAmount(a, c))
  return parts.length ? parts.join(' + ') : '—'
}

export async function spendingReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [r, prev, s] = await Promise.all([
    loadSpending({ accountId: c.accountId, period: p, tz: c.tz }),
    comparing ? loadSpending({ accountId: c.accountId, period: previousAsMain(p), tz: c.tz }) : null,
    buildSummary({ accountId: c.accountId, userId: null, period: p, now: c.now, tz: c.tz }),
  ])
  const cur = r.businessCurrency
  const total = r.totals.combined
  const revenue = moneyIn(s.revenue, cur)
  const roi = total > 0 ? Math.round(((revenue - total) / total) * 100) : null
  const prevTotal = prev ? prev.totals.combined : null
  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Total spend', total, prevTotal, { fmt: moneyFmt(cur), higherIsBetter: false, tone: 'money' }),
      kpi('WhatsApp', dayAmount(r.whatsapp.total, cur), prev ? dayAmount(prev.whatsapp.total, cur) : null, { fmt: moneyFmt(cur), higherIsBetter: false, sub: `${num(r.whatsapp.delivered)} delivered · ${num(r.whatsapp.free)} free` }),
      kpi('AI (estimated)', r.ai.inBusinessCurrency?.amount ?? null, prev?.ai.inBusinessCurrency?.amount ?? null, {
        fmt: moneyFmt(cur), higherIsBetter: false, sub: `${num(r.ai.calls)} calls`,
        display: r.ai.inBusinessCurrency ? undefined : formatCost(r.ai.costUsd, 'USD'),
      }),
      kpi('Meta Ads', r.ads.spend, prev?.ads.spend ?? null, {
        fmt: moneyFmt(r.ads.currency ?? cur), higherIsBetter: false,
        display: !r.ads.connected ? 'Not connected' : r.ads.spend == null ? 'Not available' : undefined,
      }),
      kpi('Cost per lead', r.outcomes.costPerLead, prev?.outcomes.costPerLead ?? null, { fmt: moneyFmt(cur), higherIsBetter: false, sub: `${num(r.outcomes.leads)} leads` }),
      kpi('Return on spend', roi, null, { fmt: { kind: 'percent', digits: 0 }, sub: `Revenue won ${formatAmount(revenue, cur)}`, tone: roi == null ? undefined : roi >= 0 ? 'good' : 'bad' }),
    ],
  }]

  const aiRate = r.ai.inBusinessCurrency?.rate ?? null
  if (r.byDay.length) {
    blocks.push({
      kind: 'chart', id: 'by-day', title: 'Spend by day', chart: 'bar',
      labels: r.byDay.map((d) => dayLabel(d.day)),
      series: [
        { name: 'WhatsApp', values: r.byDay.map((d) => dayAmount(d.whatsapp, cur)), fmt: moneyFmt(cur) },
        ...(aiRate != null ? [{ name: 'AI', values: r.byDay.map((d) => d.aiUsd * aiRate), fmt: moneyFmt(cur) }] : []),
      ],
    })
  }
  blocks.push({
    kind: 'table', id: 'wa-category', title: 'WhatsApp by category',
    columns: [{ label: 'Category', align: 'left', width: 2 }, { label: 'Messages', align: 'right' }, { label: 'Amount', align: 'right' }],
    rows: r.whatsapp.byCategory.map((x) => [cell(`${x.category ?? '—'}${(x.type ?? '').startsWith('free') ? ' (free)' : ''}`), cell(num(x.count), x.count), cell(moneyText(x.amount))]),
  })
  blocks.push({
    kind: 'table', id: 'wa-number', title: 'WhatsApp by number',
    columns: [{ label: 'Number', align: 'left', width: 2 }, { label: 'Messages', align: 'right' }, { label: 'Amount', align: 'right' }],
    rows: r.whatsapp.byNumber.map((x) => [cell(x.label), cell(num(x.count), x.count), cell(moneyText(x.amount))]),
  })
  blocks.push({
    kind: 'table', id: 'channel', title: 'By channel',
    columns: [{ label: 'Channel', align: 'left', width: 2 }, { label: 'WhatsApp', align: 'right' }, { label: 'AI (USD)', align: 'right' }],
    rows: r.byChannel.map((x) => [cell(channelLabel(x.channel)), cell(moneyText(x.messages)), cell(formatCost(x.aiUsd, 'USD'), x.aiUsd)]),
  })
  blocks.push({
    kind: 'table', id: 'ai-feature', title: 'AI by feature',
    columns: [{ label: 'Feature', align: 'left', width: 2 }, { label: 'Calls', align: 'right' }, { label: 'Cost (USD)', align: 'right' }],
    rows: r.ai.byFeature.map((x) => [cell(x.feature.replace(/_/g, ' ')), cell(num(x.calls), x.calls), cell(formatCost(x.costUsd, 'USD'), x.costUsd)]),
  })

  const notes = [...r.totals.excluded, ...r.warnings]
  if (r.ads.error) notes.push(r.ads.error)
  notes.push('AI cost is an estimate from the provider’s own token counts. Amounts in different currencies are never added together.')

  return {
    key: 'spending', title: 'Spending & ROI report',
    headline: `${formatAmount(total, cur)} spent; ${formatAmount(revenue, cur)} won${roi == null ? '' : ` (return ${roi >= 0 ? '+' : ''}${roi}%)`}.`,
    period: periodInfo(c), scope: 'team', blocks, notes, generatedAt: c.now.toISOString(),
  }
}
