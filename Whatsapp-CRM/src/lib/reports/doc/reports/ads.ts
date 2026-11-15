/**
 * Ad report: every ad from click to cash (src/lib/ads/performance.ts) —
 * spend, people who came in, leads, won, revenue, cost per lead, return —
 * by campaign and by ad, against the comparison period, with the findings
 * code writes (ads spending with no leads first). Owners and admins only.
 */

import { adPerformance, type AdPerformance } from '@/lib/ads/performance'
import { accountInsights } from '@/lib/ads/insights'
import { prisma } from '@/lib/db'
import { cleanPersonName } from '@/lib/auth/person-name'
import { daysBetween } from '../../presentation'
import { loadAdExtras } from '../ad-extras'
import type { Block, Finding, ReportDoc } from '../types'
import { cell, changeCell, COUNT, dayLabel, kpi, money, moneyFmt, num, pct, PERCENT, periodInfo, pctText, type ReportContext } from './common'

const CH: Record<string, string> = { whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram Direct', lead_form: 'Lead form' }

export async function adReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none' && c.q.previousDays
  const [a, prev, ins, extras] = await Promise.all([
    adPerformance({ accountId: c.accountId, from: p.from, to: p.to, firstDay: p.firstDay, lastDay: p.lastDay }),
    comparing && c.q.previousDays
      ? adPerformance({ accountId: c.accountId, from: p.prevFrom, to: p.prevTo, firstDay: c.q.previousDays.firstDay, lastDay: c.q.previousDays.lastDay }).catch(() => null)
      : Promise.resolve(null as AdPerformance | null),
    accountInsights(c.accountId, p.firstDay, p.lastDay).catch(() => null),
    loadAdExtras({ accountId: c.accountId, period: p, tz: c.tz, now: c.now }).catch((err) => {
      console.error('[reports] ad extras failed:', err instanceof Error ? err.message : err)
      return null
    }),
  ])
  const insights = ins?.status === 'ok' ? ins : null
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

  // Meta's own delivery numbers, when the ad account is connected. Reach and
  // frequency Meta withholds show "—", never 0.
  if (insights) {
    const it = insights.totals
    const ctr = it.impressions > 0 ? Math.round((it.clicks / it.impressions) * 1000) / 10 : null
    blocks.push({
      kind: 'kpis', id: 'delivery',
      items: [
        kpi('Reach', it.reach, null, { display: it.reach == null ? '—' : undefined, sub: it.reach == null ? 'Meta did not share it' : 'people' }),
        kpi('Impressions', it.impressions, null),
        kpi('Click rate (CTR)', ctr, null, { fmt: PERCENT, sub: `${num(it.clicks)} clicks` }),
        kpi('Frequency', it.frequency, null, { fmt: { kind: 'text' }, display: it.frequency == null ? '—' : `${it.frequency}×`, sub: 'times each person saw an ad' }),
        kpi('Chats started (Meta\'s count)', insights.conversationsStarted ?? null, null, {
          display: insights.conversationsStarted == null ? '—' : undefined,
          sub: `The CRM saw ${num(t.arrivals)} people arrive from ads`,
        }),
      ],
    })
  }

  const findings: Finding[] = a.findings.map((f, i) => ({ severity: i === 0 && f.includes('no leads') ? 'high' : 'medium', title: f, evidence: 'From this period’s spend and leads.', suggestion: f.includes('no leads') ? 'Pause or change this ad, or check where it sends people.' : 'Move budget toward the cheaper ads.' }))
  // Leads but no wins: the ad brings people, the follow-up or the offer does not land.
  for (const x of a.ads.filter((ad) => ad.leads >= 5 && ad.won === 0).slice(0, 3)) {
    findings.push({
      severity: 'medium',
      title: `${adLabel(x)}: ${num(x.leads)} leads, none won`,
      evidence: x.spend != null ? `${money(x.spend, cur)} spent on it in this period.` : 'No spend figure from Meta for it.',
      suggestion: 'Listen to a few of these calls: is the ad promising something the team cannot offer, or are they slow to call?',
    })
  }
  if (findings.length) blocks.push({ kind: 'findings', id: 'findings', title: 'What stands out', items: findings })

  if (extras || insights) blocks.push(...extraBlocks(c, insights?.byDay ?? [], extras, a, cur, await ownerNames(c.accountId, extras)))

  if (a.ads.length) {
    blocks.push({
      kind: 'chart', id: 'leads-by-ad', title: 'Leads by ad', chart: 'hbar',
      labels: a.ads.slice(0, 15).map(adLabel),
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
          cell(`${adLabel(x)}${x.campaignName ? ` · ${x.campaignName}` : ''}`, null, x.spend && x.leads === 0 ? 'bad' : undefined),
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

function adLabel(x: { adName: string | null; headline: string | null; adId: string }): string {
  return x.adName ?? x.headline ?? `Ad ${x.adId}`
}

/** Spend against people arriving, who won the ad leads, where ads were seen, weekdays. */
function extraBlocks(
  c: ReportContext,
  spendByDay: Array<{ day: string; spend: number }>,
  extras: Awaited<ReturnType<typeof loadAdExtras>> | null,
  a: AdPerformance,
  cur: string,
  owners: Map<string, string>,
): Block[] {
  const out: Block[] = []
  const days = daysBetween(c.q.period.firstDay, c.q.period.lastDay)
  const spend = new Map(spendByDay.map((d) => [d.day, d.spend]))
  if (days.length > 1 && (spend.size || extras?.arrivalsByDay.size)) {
    out.push({
      kind: 'chart', id: 'spend-vs-arrivals', title: 'Spend and people arriving, by day', chart: 'barline',
      labels: days.map(dayLabel),
      series: [
        ...(spend.size ? [{ name: 'Spent', values: days.map((d) => spend.get(d) ?? 0), kind: 'bar' as const, fmt: moneyFmt(cur) }] : []),
        { name: 'Came in from ads', values: days.map((d) => extras?.arrivalsByDay.get(d) ?? 0), kind: 'line' as const, axis: spend.size ? 'right' as const : 'left' as const, fmt: COUNT },
      ],
    })
  }
  if (!extras) return out

  if (extras.byAgent.length) {
    const ads = new Map(a.ads.map((x) => [x.adId, adLabel(x)]))
    const rows = [...extras.byAgent].sort((x, y) => y.leads - x.leads).slice(0, 30)
    out.push({
      kind: 'table', id: 'ad-agent', title: 'Who won the leads from each ad',
      columns: [{ label: 'Ad', align: 'left', width: 2 }, { label: 'Team member', align: 'left', width: 2 }, { label: 'Leads', align: 'right' }, { label: 'Won', align: 'right' }, { label: 'Won %', align: 'right' }],
      rows: rows.map((r) => {
        const share = r.leads >= 5 ? pct(r.won, r.leads) : null
        return [
          cell(ads.get(r.adId) ?? `Ad ${r.adId}`), cell(r.owner ? owners.get(r.owner) ?? 'Former member' : 'Nobody yet', r.owner),
          cell(num(r.leads), r.leads), cell(num(r.won), r.won), cell(r.leads >= 5 ? pctText(share) : 'Too few', share),
        ]
      }),
      initialRows: 10,
      note: 'Wins count for whoever closed the lead. Won % is shown from 5 leads up.',
    })
  }

  if (extras.places.length) {
    const total = extras.places.reduce((x, p) => x + p.arrivals, 0)
    out.push({
      kind: 'table', id: 'places', title: 'Where the ad was seen',
      columns: [{ label: 'Place', align: 'left', width: 2 }, { label: 'People', align: 'right' }, { label: 'Share', align: 'right' }],
      rows: extras.places.map((p) => [cell(p.place), cell(num(p.arrivals), p.arrivals), cell(pctText(pct(p.arrivals, total)), pct(p.arrivals, total))]),
      note: 'Facebook or Instagram only when Meta says so. A WhatsApp ad click without a click id came from a WhatsApp Status ad.',
    })
  }

  if (extras.weekdays.some((w) => w.arrivals || w.leads)) {
    out.push({
      kind: 'table', id: 'weekdays', title: 'Ads by day of the week',
      columns: [{ label: 'Day', align: 'left', width: 2 }, { label: 'Came in', align: 'right' }, { label: 'Leads', align: 'right' }, { label: 'Won', align: 'right' }, { label: 'Won %', align: 'right' }],
      rows: extras.weekdays.map((w) => [cell(w.day), cell(num(w.arrivals), w.arrivals), cell(num(w.leads), w.leads), cell(num(w.won), w.won), cell(w.wonPct == null ? (w.leads ? 'Too few' : '—') : `${w.wonPct}%`, w.wonPct)]),
      note: 'Business time. Won % is shown from 10 leads up.',
    })
  }
  return out
}

async function ownerNames(accountId: string, extras: Awaited<ReturnType<typeof loadAdExtras>> | null): Promise<Map<string, string>> {
  const ids = [...new Set((extras?.byAgent ?? []).map((r) => r.owner).filter((x): x is string => !!x))]
  if (!ids.length) return new Map()
  const people = await prisma.profile.findMany({ where: { account_id: accountId, user_id: { in: ids } }, select: { user_id: true, full_name: true } })
  return new Map(people.map((p) => [p.user_id, cleanPersonName(p.full_name) || 'Team member']))
}
