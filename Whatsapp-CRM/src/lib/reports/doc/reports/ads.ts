/**
 * Ad report: every ad from click to cash (src/lib/ads/performance.ts) —
 * spend, people who came in, leads, won, revenue, cost per lead, return —
 * by campaign and by ad, against the comparison period, with the findings
 * code writes (ads spending with no leads first). Owners and admins only.
 */

import { adPerformance, type AdPerformance } from '@/lib/ads/performance'
import type { Block, ReportDoc } from '../types'
import { cell, changeCell, kpi, money, moneyFmt, num, periodInfo, type ReportContext } from './common'

const CH: Record<string, string> = { whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram Direct', lead_form: 'Lead form' }

export async function adReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none' && c.q.previousDays
  const [a, prev] = await Promise.all([
    adPerformance({ accountId: c.accountId, from: p.from, to: p.to, firstDay: p.firstDay, lastDay: p.lastDay }),
    comparing && c.q.previousDays
      ? adPerformance({ accountId: c.accountId, from: p.prevFrom, to: p.prevTo, firstDay: c.q.previousDays.firstDay, lastDay: c.q.previousDays.lastDay }).catch(() => null)
      : Promise.resolve(null as AdPerformance | null),
  ])
  const cur = a.currency ?? 'INR'
  const t = a.totals
  const pt = prev?.totals
  const prevAd = new Map((prev?.ads ?? []).map((x) => [x.adId, x]))
  const revenue = t.revenue.filter((m) => m.currency === cur).reduce((s, m) => s + m.amount, 0)
  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Spent', t.spend, pt?.spend ?? null, { fmt: moneyFmt(cur), higherIsBetter: false, display: t.spend == null ? '—' : undefined }),
      kpi('Came in from ads', t.arrivals, pt ? pt.arrivals : null),
      kpi('Leads', t.leads, pt ? pt.leads : null),
      kpi('Won', t.won, pt ? pt.won : null),
      kpi('Cost per lead', t.costPerLead, pt?.costPerLead ?? null, { fmt: moneyFmt(cur), higherIsBetter: false }),
      kpi('Return on spend', t.roas, pt?.roas ?? null, { fmt: { kind: 'text' }, display: t.roas == null ? '—' : `${t.roas.toFixed(1)}×`, sub: `Revenue ${money(revenue, cur)}` }),
    ],
  }]

  if (a.findings.length) {
    blocks.push({
      kind: 'findings', id: 'findings', title: 'What stands out',
      items: a.findings.map((f, i) => ({ severity: i === 0 && f.includes('no leads') ? 'high' : 'medium', title: f, evidence: 'From this period’s spend and leads.', suggestion: f.includes('no leads') ? 'Pause or change this ad, or check where it sends people.' : 'Move budget toward the cheaper ads.' })),
    })
  }

  if (a.ads.length) {
    blocks.push({
      kind: 'chart', id: 'leads-by-ad', title: 'Leads by ad', chart: 'hbar',
      labels: a.ads.slice(0, 15).map((x) => x.adName ?? x.headline ?? `Ad ${x.adId}`),
      series: [{ name: 'Leads', values: a.ads.slice(0, 15).map((x) => x.leads), previous: comparing ? a.ads.slice(0, 15).map((x) => prevAd.get(x.adId)?.leads ?? 0) : undefined }],
    })
    blocks.push({
      kind: 'table', id: 'campaigns', title: 'By campaign',
      columns: [{ label: 'Campaign', align: 'left', width: 2 }, { label: 'Spent', align: 'right' }, { label: 'Came in', align: 'right' }, { label: 'Leads', align: 'right' }, { label: 'Won', align: 'right' }, { label: 'Per lead', align: 'right' }, { label: 'Return', align: 'right' }],
      rows: a.campaigns.map((x) => [
        cell(x.campaignName ?? 'Campaign not named yet'), cell(money(x.spend, cur), x.spend), cell(num(x.arrivals), x.arrivals),
        cell(num(x.leads), x.leads), cell(num(x.won), x.won), cell(money(x.costPerLead, cur), x.costPerLead), cell(x.roas == null ? '—' : `${x.roas.toFixed(1)}×`, x.roas),
      ]),
    })
    blocks.push({
      kind: 'table', id: 'ads', title: 'By ad',
      columns: [{ label: 'Ad', align: 'left', width: 2 }, { label: 'Channel', align: 'left' }, { label: 'Spent', align: 'right' }, { label: 'Leads', align: 'right' }, { label: 'Before', align: 'right' }, { label: 'Change', align: 'right' }, { label: 'Won', align: 'right' }, { label: 'Per lead', align: 'right' }],
      rows: a.ads.map((x) => {
        const b = prevAd.get(x.adId)
        return [
          cell(`${x.adName ?? x.headline ?? `Ad ${x.adId}`}${x.campaignName ? ` · ${x.campaignName}` : ''}`, null, x.spend && x.leads === 0 ? 'bad' : undefined),
          cell(x.channels.map((ch) => CH[ch] ?? ch).join(', ') || '—'),
          cell(money(x.spend, cur), x.spend), cell(num(x.leads), x.leads), cell(comparing ? num(b?.leads ?? 0) : '—', b?.leads ?? 0),
          changeCell(x.leads, comparing ? b?.leads ?? 0 : null), cell(num(x.won), x.won), cell(money(x.costPerLead, cur), x.costPerLead),
        ]
      }),
      initialRows: 20,
    })
  } else {
    blocks.push({ kind: 'text', id: 'no-ads', style: 'note', lines: ['No ad brought anyone in this period yet. New ad clicks and form fills appear here by themselves.'] })
  }

  const notes: string[] = []
  if (a.spendMessage) notes.push(a.spendMessage)
  notes.push(`Leads from other sources in this period: ${num(a.otherLeads)}.`)

  return {
    key: 'ads', title: 'Ad report',
    headline: t.leads ? `${num(t.leads)} leads from ads${t.spend != null ? ` for ${money(t.spend, cur)}` : ''}; ${num(t.won)} won.` : 'No leads from ads in this period yet.',
    period: periodInfo(c), scope: 'team', blocks, notes, generatedAt: c.now.toISOString(),
  }
}
