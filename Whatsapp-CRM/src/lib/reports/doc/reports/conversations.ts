/**
 * Conversation report (plan §4.4): chats with a customer message in the
 * period, how fast they got a first reply (anyone / a person), who
 * answered, chats that lost WhatsApp's 24-hour free window, by channel,
 * number, hour and person, and what customers rated. An agent sees the
 * chats assigned to them; supervisors and above see the team.
 */

import { prisma } from '@/lib/db'
import { cleanPersonName } from '@/lib/auth/person-name'
import { previousAsMain } from '../period-query'
import { loadChats, REPLY_TARGET_MIN } from '../conversation-data'
import type { Block, Finding, ReportDoc } from '../types'
import { cell, COUNT, kpi, MINUTES, num, pct, PERCENT, periodInfo, pctText, words, type ReportContext } from './common'

const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Messenger', email: 'Email', website: 'Website chat', telegram: 'Telegram', sms: 'SMS', rcs: 'RCS' }
const minText = (m: number | null) => (m == null ? '—' : m > 0 && m < 1 ? 'under a minute' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} days`)

export async function conversationReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [d, prev] = await Promise.all([
    loadChats({ accountId: c.accountId, userId: c.userId, period: p, tz: c.tz, now: c.now }),
    comparing ? loadChats({ accountId: c.accountId, userId: c.userId, period: previousAsMain(p), tz: c.tz, now: c.now }) : null,
  ])
  const s = d.summary
  const ps = prev?.summary
  const within = pct(s.withinTarget, s.answered)
  const prevWithin = ps ? pct(ps.withinTarget, ps.answered) : null
  const fb = d.feedback

  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Chats', s.total, ps ? ps.total : null, { sub: 'with a customer message' }),
      kpi('First reply, middle wait', s.firstReplyMedian, ps?.firstReplyMedian ?? null, { fmt: MINUTES, higherIsBetter: false }),
      kpi(`Answered within ${REPLY_TARGET_MIN} min`, within, prevWithin, { fmt: PERCENT }),
      kpi('A person replied, middle wait', s.personReplyMedian, ps?.personReplyMedian ?? null, { fmt: MINUTES, higherIsBetter: false }),
      kpi('Assistant replied first', pct(s.byAi, s.answered), ps ? pct(ps.byAi, ps.answered) : null, { fmt: PERCENT, sub: `${num(s.byAi)} chats` }),
      kpi('Missed the 24-hour window', s.missedWindow, ps ? ps.missedWindow : null, { higherIsBetter: false, tone: s.missedWindow ? 'bad' : 'good', sub: `${num(s.waiting)} still waiting` }),
      kpi('Customer rating', fb.avg, null, { fmt: { kind: 'text' }, display: fb.avg == null ? '—' : `${fb.avg} / 5`, sub: fb.asked ? `${num(fb.answered)} of ${num(fb.asked)} asked replied` : 'Not asked in this period' }),
    ],
  }]

  const findings: Finding[] = []
  if (s.missedWindow >= 5) findings.push({ severity: s.missedWindow >= 20 ? 'high' : 'medium', title: `${num(s.missedWindow)} chats got no reply within 24 hours`, evidence: 'After 24 hours WhatsApp only allows a paid template, not a normal reply.', suggestion: 'Answer chats the same day, or let the assistant give a first reply so the window stays open.', action: { label: 'Open the Inbox', href: '/inbox' } })
  if (s.firstReplyMedian != null && s.answered >= 10 && s.firstReplyMedian > 60) findings.push({ severity: 'medium', title: `Customers wait ${minText(s.firstReplyMedian)} for a first reply`, evidence: `The middle wait across ${num(s.answered)} answered chats.`, suggestion: 'Turn on the assistant for first replies, or share chats among more people at busy hours.' })
  const busy = [...s.byHour.entries()].filter(([, h]) => h.chats >= 5).map(([hour, h]) => ({ hour, rate: h.answered / h.chats, chats: h.chats })).sort((a, b) => a.rate - b.rate)[0]
  if (busy && busy.rate < 0.7) findings.push({ severity: 'medium', title: `Chats at ${String(busy.hour).padStart(2, '0')}:00 go unanswered most`, evidence: `${Math.round(busy.rate * 100)}% of ${num(busy.chats)} chats then got a reply.`, suggestion: 'Put someone on the Inbox at that hour, or set an automatic first reply.' })
  if (findings.length) blocks.push({ kind: 'findings', id: 'findings', title: 'What stands out', items: findings })

  if (s.total) {
    blocks.push({
      kind: 'chart', id: 'by-hour', title: 'Chats by hour of the day', chart: 'bar',
      labels: s.byHour.map((_, h) => `${String(h).padStart(2, '0')}:00`),
      series: [
        { name: 'Chats', values: s.byHour.map((h) => h.chats), fmt: COUNT },
        { name: 'Answered', values: s.byHour.map((h) => h.answered), fmt: COUNT },
      ],
      note: 'The hour of the first customer message, in the business\'s time zone.',
    })
    blocks.push({
      kind: 'table', id: 'by-channel', title: 'By channel',
      columns: [{ label: 'Channel', align: 'left', width: 2 }, { label: 'Chats', align: 'right' }, { label: 'Answered', align: 'right' }, { label: 'First reply', align: 'right' }],
      rows: s.byChannel.map((g) => [cell(CHANNEL[g.key] ?? words(g.key)), cell(num(g.chats), g.chats), cell(pctText(pct(g.answered, g.chats)), pct(g.answered, g.chats)), cell(minText(g.median), g.median)]),
    })
    if (s.byNumber.length > 1) {
      const nums = await prisma.whatsAppConfig.findMany({ where: { account_id: c.accountId }, select: { id: true, label: true, is_default: true }, orderBy: { created_at: 'asc' } })
      const label = new Map(nums.map((n, i) => [n.id, n.label?.trim() || (n.is_default ? 'Main number' : `Number ${i + 1}`)]))
      blocks.push({
        kind: 'table', id: 'by-number', title: 'By WhatsApp number',
        columns: [{ label: 'Number', align: 'left', width: 2 }, { label: 'Chats', align: 'right' }, { label: 'Answered', align: 'right' }, { label: 'First reply', align: 'right' }],
        rows: s.byNumber.map((g) => [cell(g.key === '__none' ? 'Other channels' : label.get(g.key) ?? 'Removed number'), cell(num(g.chats), g.chats), cell(pctText(pct(g.answered, g.chats)), pct(g.answered, g.chats)), cell(minText(g.median), g.median)]),
      })
    }
    if (!c.userId && s.byPerson.size) {
      const ids = [...s.byPerson.keys()]
      const people = await prisma.profile.findMany({ where: { account_id: c.accountId, user_id: { in: ids } }, select: { user_id: true, full_name: true } })
      const name = new Map(people.map((p2) => [p2.user_id, cleanPersonName(p2.full_name) || 'Team member']))
      blocks.push({
        kind: 'table', id: 'by-person', title: 'First person to reply',
        columns: [{ label: 'Team member', align: 'left', width: 2 }, { label: 'Chats answered', align: 'right' }, { label: 'Middle wait', align: 'right' }],
        rows: [...s.byPerson.entries()].sort((a, b) => b[1].answered - a[1].answered).map(([id, v]) => [cell(name.get(id) ?? 'Former member'), cell(num(v.answered), v.answered), cell(minText(v.median), v.median)]),
        note: 'Who sent the first team reply after the customer\'s first message in the period.',
      })
    }
  } else {
    blocks.push({ kind: 'text', id: 'empty', style: 'note', lines: ['No customer messages in this period.'] })
  }

  return {
    key: 'conversations', title: c.userId ? 'My conversations' : 'Conversation report',
    headline: s.total
      ? `${num(s.total)} chats; first reply in ${minText(s.firstReplyMedian)} (middle wait), ${pctText(within)} within ${REPLY_TARGET_MIN} minutes.`
      : 'No customer messages in this period.',
    period: periodInfo(c), scope: c.userId ? 'self' : 'team', blocks,
    notes: ['Reply times count every hour, working or not. The 24-hour window is WhatsApp\'s free reply window.'],
    generatedAt: c.now.toISOString(),
  }
}
