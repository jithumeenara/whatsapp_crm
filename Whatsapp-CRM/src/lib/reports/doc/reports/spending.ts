/**
 * Spending & ROI report: WhatsApp messages, AI and Meta Ads, against the
 * comparison period, with cost per lead and per won deal, and the return:
 * revenue won against what was spent. Team money: supervisors and above.
 */

import { formatAmount, formatCost } from '@/lib/format/money'
import { loadSpending } from '../../spending'
import { channelLabel, dayAmount, type Money } from '../../spending-assemble'
import { buildSummary } from '../../summary'
import { adPerformance, type AdPerformance } from '@/lib/ads/performance'
import { loadCampaigns } from '../campaign-data'
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
  const [r, prev, s, ads] = await Promise.all([
    loadSpending({ accountId: c.accountId, period: p, tz: c.tz }),
    comparing ? loadSpending({ accountId: c.accountId, period: previousAsMain(p), tz: c.tz }) : null,
    buildSummary({ accountId: c.accountId, userId: null, period: p, now: c.now, tz: c.tz }),
    adPerformance({ accountId: c.accountId, from: p.from, to: p.to, firstDay: p.firstDay, lastDay: p.lastDay }).catch((err) => {
      console.error('[reports] ad return for spending failed:', err instanceof Error ? err.message : err)
      return null
    }),
  ])
  const cur = r.businessCurrency
  const camp = await loadCampaigns({ accountId: c.accountId, period: p, tz: c.tz, now: c.now, currency: cur }).catch((err) => {
    console.error('[reports] broadcast return for spending failed:', err instanceof Error ? err.message : err)
    return null
  })
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
  blocks.push(...returnBlocks(ads, camp, cur))

  return {
    key: 'spending', title: 'Spending & ROI report',
    headline: `${formatAmount(total, cur)} spent; ${formatAmount(revenue, cur)} won${roi == null ? '' : ` (return ${roi >= 0 ? '+' : ''}${roi}%)`}.`,
    period: periodInfo(c), scope: 'team', blocks, notes, generatedAt: c.now.toISOString(),
  }
}

/** Return by ad campaign and what broadcasts cost against their result. */
function returnBlocks(ads: AdPerformance | null, camp: Awaited<ReturnType<typeof loadCampaigns>> | null, cur: string): Block[] {
  const out: Block[] = []
  if (ads && ads.campaigns.length) {
    const ac = ads.currency ?? cur
    const revOf = (list: Array<{ currency: string; amount: number }>) => list.filter((m) => m.currency === ac).reduce((x, m) => x + m.amount, 0)
    out.push({
      kind: 'table', id: 'return-campaign', title: 'Return by ad campaign',
      columns: [{ label: 'Campaign', align: 'left', width: 2 }, { label: 'Spent', align: 'right' }, { label: 'Leads', align: 'right' }, { label: 'Won', align: 'right' }, { label: 'Revenue', align: 'right' }, { label: 'Return', align: 'right' }],
      rows: ads.campaigns.map((x) => {
        const rev = revOf(x.revenue)
        return [
          cell(x.campaignName ?? 'Campaign not named yet'), cell(x.spend == null ? '—' : formatAmount(x.spend, ac), x.spend),
          cell(num(x.leads), x.leads), cell(num(x.won), x.won), cell(formatAmount(rev, ac), rev),
          cell(x.roas == null ? '—' : `${x.roas.toFixed(1)}×`, x.roas, x.roas == null ? undefined : x.roas >= 1 ? 'good' : 'bad'),
        ]
      }),
      note: 'Return = revenue won from the campaign\'s leads ÷ what Meta charged for it. 1× means it paid for itself.',
    })
  }
  if (camp && camp.broadcasts.length) {
    out.push({
      kind: 'table', id: 'return-broadcast', title: 'Broadcasts: cost and result',
      columns: [{ label: 'Broadcast', align: 'left', width: 2 }, { label: 'Cost', align: 'right' }, { label: 'Replies', align: 'right' }, { label: 'Per reply', align: 'right' }, { label: 'Leads', align: 'right' }, { label: 'Won', align: 'right' }],
      rows: camp.broadcasts.slice(0, 20).map((b) => [
        cell(b.name || 'Broadcast'), cell(b.cost == null ? '—' : formatAmount(b.cost, cur), b.cost), cell(num(b.replied), b.replied),
        cell(b.costPerReply == null ? '—' : formatAmount(b.costPerReply, cur), b.costPerReply), cell(num(b.leads), b.leads), cell(num(b.won), b.won),
      ]),
      note: 'Leads: from people who replied, within 7 days of the message. The Campaign report has the full detail.',
    })
  }
  return out
}
