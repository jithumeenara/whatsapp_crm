/**
 * Campaign report (plan §4.6): broadcasts sent → delivered → read →
 * replied → failed, their WhatsApp cost and cost per reply, leads that
 * followed a reply; templates (use, cost, quality, rejections); opt-ins
 * and opt-outs by day. Supervisors and above (team costs, like Spending).
 *
 * Meta pricing it explains (Nov 2026): since 1 Oct 2026 utility templates
 * are charged even inside the 24-hour window; service replies are free.
 */

import { prisma } from '@/lib/db'
import { daysBetween } from '../../presentation'
import { previousAsMain } from '../period-query'
import { loadCampaigns, LEAD_WINDOW_DAYS } from '../campaign-data'
import type { Block, Finding, ReportDoc } from '../types'
import { cell, COUNT, dayLabel, kpi, money, moneyFmt, num, PERCENT, periodInfo, pctText, words, type ReportContext } from './common'

const STATUS: Record<string, string> = { APPROVED: 'Approved', REJECTED: 'Rejected', PENDING: 'Waiting for Meta', PAUSED: 'Paused by Meta', DISABLED: 'Disabled', IN_APPEAL: 'Appealed' }

export async function campaignReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const account = await prisma.account.findUnique({ where: { id: c.accountId }, select: { default_currency: true } })
  const cur = account?.default_currency || 'USD'
  const [d, prev] = await Promise.all([
    loadCampaigns({ accountId: c.accountId, period: p, tz: c.tz, now: c.now, currency: cur }),
    comparing ? loadCampaigns({ accountId: c.accountId, period: previousAsMain(p), tz: c.tz, now: c.now, currency: cur }) : null,
  ])
  const t = d.totals
  const pt = prev?.totals
  const optOuts = [...d.optOut.values()].reduce((x, v) => x + v, 0)
  const optIns = [...d.optIn.values()].reduce((x, v) => x + v, 0)
  const prevOptOuts = prev ? [...prev.optOut.values()].reduce((x, v) => x + v, 0) : null

  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Messages sent', t.sent, pt ? pt.sent : null, { sub: `${num(t.broadcasts)} broadcasts` }),
      kpi('Delivered', t.deliveredPct, pt?.deliveredPct ?? null, { fmt: PERCENT }),
      kpi('Read', t.readPct, pt?.readPct ?? null, { fmt: PERCENT, sub: 'of delivered' }),
      kpi('Replied', t.repliedPct, pt?.repliedPct ?? null, { fmt: PERCENT, sub: `of delivered · ${num(t.replied)} people` }),
      kpi('Cost', t.cost, pt?.cost ?? null, { fmt: moneyFmt(cur), higherIsBetter: false, display: t.cost == null ? '—' : undefined }),
      kpi('Cost per reply', t.costPerReply, pt?.costPerReply ?? null, { fmt: moneyFmt(cur), higherIsBetter: false, display: t.costPerReply == null ? '—' : undefined }),
      kpi('Leads after a reply', t.leads, pt ? pt.leads : null, { sub: `${num(t.won)} won` }),
      kpi('Opted out', optOuts, prevOptOuts, { higherIsBetter: false, sub: `${num(optIns)} opted in` }),
    ],
  }]

  const findings: Finding[] = []
  for (const b of d.broadcasts.filter((x) => x.sent >= 50 && x.failed / Math.max(1, x.sent + x.failed) >= 0.1).slice(0, 3)) {
    findings.push({
      severity: 'high',
      title: `${b.name}: ${num(b.failed)} messages failed`,
      evidence: `${Math.round((b.failed / (b.sent + b.failed)) * 100)}% of the sends did not go out.`,
      suggestion: 'Open the broadcast to see the reasons: numbers not on WhatsApp, a paused template, or Meta\'s marketing limit (wait a day before trying those people again).',
      action: { label: 'Open broadcasts', href: '/broadcasts' },
    })
  }
  for (const b of d.broadcasts.filter((x) => x.delivered >= 100 && x.repliedPct != null && x.repliedPct < 2).slice(0, 2)) {
    findings.push({ severity: 'medium', title: `${b.name}: hardly anyone replied (${b.repliedPct}%)`, evidence: `${num(b.delivered)} delivered, ${num(b.replied)} replied.`, suggestion: 'Try a clearer question or button at the end, and send to people who asked recently.' })
  }
  if (prevOptOuts != null && optOuts >= 10 && optOuts >= prevOptOuts * 2) {
    findings.push({ severity: 'high', title: `Opt-outs doubled (${prevOptOuts} → ${optOuts})`, evidence: 'People replying STOP or opting out.', suggestion: 'Send less often, and only to people for whom the message is relevant.' })
  }
  const trouble = d.templates.filter((x) => x.status === 'REJECTED' || x.status === 'PAUSED' || x.status === 'DISABLED')
  if (trouble.length) {
    findings.push({ severity: 'medium', title: `${trouble.length} template${trouble.length === 1 ? ' is' : 's are'} rejected or paused`, evidence: trouble.slice(0, 3).map((x) => x.name).join(', '), suggestion: 'Fix the wording and send it for approval again.', action: { label: 'Open templates', href: '/templates' } })
  }
  if (findings.length) blocks.push({ kind: 'findings', id: 'findings', title: 'What stands out', items: findings })

  if (t.sent > 0) {
    blocks.push({
      kind: 'chart', id: 'funnel', title: 'From sent to replied', chart: 'funnel',
      labels: ['Sent', 'Delivered', 'Read', 'Replied'],
      series: [{ name: 'Messages', values: [t.sent, t.delivered, t.read, t.replied], previous: pt ? [pt.sent, pt.delivered, pt.read, pt.replied] : undefined }],
    })
  }

  if (d.broadcasts.length) {
    blocks.push({
      kind: 'table', id: 'broadcasts', title: 'Broadcasts',
      columns: [
        { label: 'Broadcast', align: 'left', width: 2 }, { label: 'Sent', align: 'right' }, { label: 'Delivered', align: 'right' },
        { label: 'Read', align: 'right' }, { label: 'Replied', align: 'right' }, { label: 'Failed', align: 'right' },
        { label: 'Cost', align: 'right' }, { label: 'Per reply', align: 'right' }, { label: 'Leads', align: 'right' }, { label: 'Won', align: 'right' },
      ],
      rows: d.broadcasts.map((b) => [
        cell(b.name || 'Broadcast'), cell(num(b.sent), b.sent), cell(pctText(b.deliveredPct), b.deliveredPct),
        cell(pctText(b.readPct), b.readPct), cell(pctText(b.repliedPct), b.repliedPct),
        cell(num(b.failed), b.failed, b.failed ? 'bad' : undefined),
        cell(b.cost == null ? '—' : `${money(b.cost, cur)}${b.otherCurrency ? ' +' : ''}`, b.cost), cell(b.costPerReply == null ? '—' : money(b.costPerReply, cur), b.costPerReply),
        cell(num(b.leads), b.leads), cell(num(b.won), b.won),
      ]),
      initialRows: 15,
      note: `Read and replied are shares of delivered messages. Leads: from people who replied, within ${LEAD_WINDOW_DAYS} days of the message. A + after a cost means part was charged in another currency and is left out.`,
    })
  } else {
    blocks.push({ kind: 'text', id: 'no-broadcasts', style: 'note', lines: ['No broadcast was sent in this period.'] })
  }

  const usedTemplates = d.templates.filter((x) => x.messages > 0 || x.status === 'REJECTED' || x.status === 'PAUSED')
  if (usedTemplates.length) {
    blocks.push({
      kind: 'table', id: 'templates', title: 'Templates',
      columns: [{ label: 'Template', align: 'left', width: 2 }, { label: 'Category', align: 'left' }, { label: 'Status', align: 'left' }, { label: 'Quality', align: 'left' }, { label: 'Charged messages', align: 'right' }, { label: 'Cost', align: 'right' }],
      rows: usedTemplates.slice(0, 40).map((x) => [
        cell(x.name), cell(x.category ? words(x.category.toLowerCase()) : '—'),
        cell(x.status ? STATUS[x.status] ?? words(x.status.toLowerCase()) : 'Not in this app', null, x.status === 'REJECTED' || x.status === 'PAUSED' ? 'bad' : undefined),
        cell(x.quality ? words(x.quality.toLowerCase()) : '—'), cell(num(x.messages), x.messages), cell(x.cost == null ? '—' : money(x.cost, cur), x.cost),
      ]),
      initialRows: 15,
      note: 'Meta may move a template to Marketing on its own; keep utility templates purely informational. Since 1 October 2026 utility templates are charged even inside the 24-hour window.',
    })
  }

  const days = daysBetween(p.firstDay, p.lastDay)
  if (days.length > 1 && (optOuts || optIns)) {
    blocks.push({
      kind: 'chart', id: 'opt', title: 'Opted in and opted out, by day', chart: 'bar',
      labels: days.map(dayLabel),
      series: [
        { name: 'Opted in', values: days.map((x) => d.optIn.get(x) ?? 0), fmt: COUNT },
        { name: 'Opted out', values: days.map((x) => d.optOut.get(x) ?? 0), fmt: COUNT },
      ],
    })
  }

  return {
    key: 'campaigns', title: 'Campaign report',
    headline: t.sent
      ? `${num(t.sent)} messages in ${num(t.broadcasts)} broadcasts; ${pctText(t.repliedPct)} replied${t.cost != null ? `, ${money(t.cost, cur)} spent` : ''}.`
      : 'No broadcasts in this period.',
    period: periodInfo(c), scope: 'team', blocks,
    notes: ['Costs are Meta\'s own prices on each delivered message, in the business currency.'],
    generatedAt: c.now.toISOString(),
  }
}
