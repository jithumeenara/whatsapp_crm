/**
 * The words on top of the report, written by rules, not by AI
 * (docs/plans/reports-plan.md Phase 1): one sentence that answers "how
 * did it go", and at most three things to do, chosen by what is leaking
 * most. Every number in them comes straight from the summary. Pure.
 */

import type { Money, ReportSummary } from './summary'

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

export function formatMoney(m: Money): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(m.amount)
  } catch {
    return `${m.currency} ${Math.round(m.amount).toLocaleString('en-IN')}`
  }
}

/** Change against the comparison period, or null when there is nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (before === 0) return null
  return Math.round(((now - before) / before) * 100)
}

export function headline(s: ReportSummary, periodWord: string): string {
  const who = s.scope === 'self' ? 'You' : 'The team'
  const parts: string[] = []
  const came = s.cohort.total
  if (came === 0 && s.wonInPeriod === 0) return `No new leads ${periodWord} yet.`
  parts.push(`${plural(came, 'lead')} came in ${periodWord}`)
  parts.push(`${s.wonInPeriod.toLocaleString('en-IN')} won`)
  const rev = s.revenue.filter((m) => m.amount > 0)
  if (rev.length) parts.push(`${rev.map(formatMoney).join(' + ')} earned`)
  let line = `${parts.join(', ')}.`
  const waiting = s.leaks.neverContacted.count
  if (waiting > 0) line += ` ${plural(waiting, 'lead')} ${waiting === 1 ? 'has' : 'have'} not been contacted yet.`
  else if (s.calls.total > 0) line += ` ${who} made ${plural(s.calls.total, 'call')}.`
  return line
}

export interface Action { key: string; text: string; count: number }

/** Up to three, biggest leak first; nothing when nothing is wrong. */
export function actions(s: ReportSummary): Action[] {
  const list: Action[] = []
  const l = s.leaks
  if (l.neverContacted.count) list.push({ key: 'never', count: l.neverContacted.count, text: `Call the ${plural(l.neverContacted.count, 'lead')} nobody has contacted in over ${s.leakHours} hours.` })
  if (l.waitingChats.count) list.push({ key: 'chats', count: l.waitingChats.count, text: `Reply to ${plural(l.waitingChats.count, 'customer')} waiting more than ${s.leakHours} hours.` })
  if (l.overdueFollowUps.count) list.push({ key: 'followups', count: l.overdueFollowUps.count, text: `Clear ${plural(l.overdueFollowUps.count, 'overdue follow-up')}.` })
  if (l.unassigned.count) list.push({ key: 'unassigned', count: l.unassigned.count, text: `Give ${plural(l.unassigned.count, 'lead')} with no owner to someone.` })
  const noAmount = s.revenue.reduce((n, m) => n + (m.deals - m.withAmount), 0)
  if (noAmount) list.push({ key: 'amounts', count: noAmount, text: `Add the amount to ${plural(noAmount, 'won deal')}, so revenue is complete.` })
  if (s.cohort.closedNoOutcome) list.push({ key: 'outcome', count: s.cohort.closedNoOutcome, text: `Mark won or lost on ${plural(s.cohort.closedNoOutcome, 'closed lead')} with no outcome.` })
  return list.sort((a, b) => b.count - a.count).slice(0, 3)
}
