/**
 * AI & Automation report (plan §4.7): assistant and chatbot replies,
 * chats settled without a person, handovers (why, outside hours, how fast
 * a person took over), questions the assistant could not answer, chatbot
 * flow drop-off, and AI-suggested leads people accepted. Supervisors and
 * above. The customer questions shown are their own words, team-only.
 */

import { loadAutomation } from '../automation-data'
import { loadChats } from '../conversation-data'
import { previousAsMain } from '../period-query'
import type { Block, Finding, ReportDoc } from '../types'
import { cell, kpi, MINUTES, num, pct, PERCENT, periodInfo, pctText, type ReportContext } from './common'

const REASON: Record<string, string> = {
  low_confidence: 'Not sure of the answer', unsupported_details: 'Answer not in its knowledge', assistant_requested: 'Decided a person should take it',
  escalation_topic: 'A sensitive topic', turn_limit: 'Too many replies without resolving', asked_for_person: 'Customer asked for a person',
  registration: 'Registration needed a person', flow_step: 'Chatbot flow step', other: 'Other',
}

export async function automationReport(c: ReportContext): Promise<ReportDoc> {
  const p = c.q.period
  const comparing = c.q.compare !== 'none'
  const [d, prev, chats] = await Promise.all([
    loadAutomation({ accountId: c.accountId, period: p }),
    comparing ? loadAutomation({ accountId: c.accountId, period: previousAsMain(p) }) : null,
    loadChats({ accountId: c.accountId, userId: null, period: p, tz: c.tz, now: c.now }),
  ])
  const h = d.handovers
  const settled = chats.rows.filter((r) => r.replyType === 'bot' && r.personMin == null).length
  const botChats = chats.rows.filter((r) => r.replyType === 'bot').length
  const acceptPct = pct(d.aiLeads.accepted, d.aiLeads.accepted + d.aiLeads.rejected)

  const blocks: Block[] = [{
    kind: 'kpis', id: 'figures',
    items: [
      kpi('Assistant replies', d.replies.ai, prev ? prev.replies.ai : null),
      kpi('Chatbot messages', d.replies.chatbot, prev ? prev.replies.chatbot : null),
      kpi('Settled without a person', pct(settled, botChats), null, { fmt: PERCENT, sub: `${num(settled)} of ${num(botChats)} chats the assistant answered first` }),
      kpi('Handed to a person', d.handoversReady ? h.total : null, prev?.handoversReady ? prev.handovers.total : null, { higherIsBetter: false, display: d.handoversReady ? undefined : '—', sub: d.handoversReady ? `${num(h.outside)} outside working hours` : 'Starts after the update' }),
      kpi('Taken over, middle wait', d.handoversReady ? h.takenMedian : null, null, { fmt: MINUTES, higherIsBetter: false, sub: d.handoversReady && h.notTaken ? `${num(h.notTaken)} not taken yet` : undefined }),
      kpi('AI-suggested leads accepted', acceptPct, null, { fmt: PERCENT, sub: `${num(d.aiLeads.suggested)} suggested` }),
    ],
  }]

  const findings: Finding[] = []
  if (d.handoversReady && h.total >= 5 && h.outside / h.total >= 0.4) findings.push({ severity: 'medium', title: `${Math.round((h.outside / h.total) * 100)}% of handovers came outside working hours`, evidence: `${num(h.outside)} of ${num(h.total)}.`, suggestion: 'Check the working hours in Settings, or have someone cover those hours.' })
  if (d.handoversReady && h.notTaken >= 3) findings.push({ severity: 'high', title: `${num(h.notTaken)} handovers were never taken by a person`, evidence: 'The customer was told a person would reply.', suggestion: 'Open the pending chats in the Inbox and reply.', action: { label: 'Open the Inbox', href: '/inbox' } })
  const topQ = d.questions[0]
  if (topQ && topQ.times >= 3) findings.push({ severity: 'medium', title: `The assistant could not answer "${topQ.text.slice(0, 60)}" ${topQ.times} times`, evidence: 'Asked by customers again and again in this period.', suggestion: 'Add the answer to the assistant\'s knowledge so it can reply next time.', action: { label: 'Open AI training', href: '/chatbot' } })
  const leaky = d.flows.find((f) => f.started >= 10 && f.stopped / f.started >= 0.3 && f.worstStep)
  if (leaky) findings.push({ severity: 'medium', title: `Chatbot "${leaky.name}": ${Math.round((leaky.stopped / leaky.started) * 100)}% stopped part-way`, evidence: `Most stopped at step "${leaky.worstStep}" (${num(leaky.worstStepCount)}).`, suggestion: 'Make that step shorter or clearer, or add buttons so people can answer quickly.', action: { label: 'Open chatbots', href: '/flows' } })
  if (findings.length) blocks.push({ kind: 'findings', id: 'findings', title: 'What stands out', items: findings })

  if (!d.handoversReady) {
    blocks.push({ kind: 'text', id: 'handover-pending', style: 'note', lines: ['Handover reasons are counted once this server has the latest update (database step 163).'] })
  } else if (h.total) {
    blocks.push({
      kind: 'chart', id: 'reasons', title: 'Why chats were handed to a person', chart: 'hbar',
      labels: h.byReason.map((r) => REASON[r.reason] ?? r.reason),
      series: [{ name: 'Handovers', values: h.byReason.map((r) => r.n) }],
    })
  }

  if (d.questions.length) {
    blocks.push({
      kind: 'table', id: 'questions', title: 'Questions the assistant could not answer',
      columns: [{ label: 'Question', align: 'left', width: 4 }, { label: 'Times', align: 'right' }, { label: 'Last asked', align: 'right' }],
      rows: d.questions.map((q) => [cell(q.text), cell(num(q.times), q.times), cell(q.last.slice(0, 10))]),
      initialRows: 10,
      note: 'In the customers\' own words. Add the answers to the assistant\'s knowledge (Chatbot → AI training).',
    })
  }

  if (d.flows.length) {
    blocks.push({
      kind: 'table', id: 'flows', title: 'Chatbot flows',
      columns: [{ label: 'Flow', align: 'left', width: 2 }, { label: 'Started', align: 'right' }, { label: 'Finished', align: 'right' }, { label: 'To a person', align: 'right' }, { label: 'Stopped', align: 'right' }, { label: 'Most stopped at', align: 'left' }],
      rows: d.flows.slice(0, 30).map((f) => [
        cell(f.name || 'Flow'), cell(num(f.started), f.started), cell(pctText(pct(f.finished, f.started)), pct(f.finished, f.started)),
        cell(num(f.handedOver), f.handedOver), cell(num(f.stopped), f.stopped, f.stopped ? 'bad' : undefined), cell(f.worstStep ?? '—'),
      ]),
      note: f0(d.flows),
    })
  }

  return {
    key: 'automation', title: 'AI & Automation report',
    headline: `${num(d.replies.ai)} assistant replies; ${pctText(pct(settled, botChats))} of the chats it answered first needed no person${d.handoversReady ? `; ${num(h.total)} handed over` : ''}.`,
    period: periodInfo(c), scope: 'team', blocks,
    notes: ['"Settled without a person": the assistant replied first and no team member wrote in that chat afterwards in the period.'],
    generatedAt: c.now.toISOString(),
  }
}

function f0(flows: Array<{ running: number }>): string | undefined {
  const running = flows.reduce((x, f) => x + f.running, 0)
  return running ? `${num(running)} runs are still going and are not counted as finished or stopped.` : undefined
}
