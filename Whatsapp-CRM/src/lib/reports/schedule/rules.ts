/**
 * Scheduled reports, the pure part (phase F1): when one is due, which
 * period it covers, the WhatsApp / Telegram text, the one line a template
 * carries outside the 24-hour window, and who may receive it.
 *
 * Kept free of next/server: the sweep that uses this runs from server.ts.
 */

import type { AccountRole } from '@/lib/auth/roles'
import { hasMinRole } from '@/lib/auth/roles'
import { changeLabel, judgeChange } from '../doc/change'
import type { PeriodQueryKind } from '../doc/period-query'
import type { ReportDoc } from '../doc/types'

export type Frequency = 'daily' | 'weekly' | 'monthly'
export const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly']
const DAY_NUM: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }
/** A send missed by more than this many hours (server down) is skipped. */
const LATE_HOURS = 3

export function periodFor(f: string): PeriodQueryKind {
  return f === 'weekly' ? 'last_week' : f === 'monthly' ? 'last_month' : 'yesterday'
}

/** The key of the send that is due now, or null. Twice is once: the key
 *  already sent is never due again. */
export function dueKey(
  s: { frequency: string; day: number; send_hour: number; last_sent_key: string | null },
  local: { date: string; day: string; minutes: number },
): string | null {
  const hour = Math.floor(local.minutes / 60)
  if (hour < s.send_hour || hour >= s.send_hour + LATE_HOURS) return null
  let key: string | null = null
  if (s.frequency === 'daily') key = local.date
  else if (s.frequency === 'weekly') key = DAY_NUM[local.day] === s.day ? local.date : null
  else if (s.frequency === 'monthly') key = Number(local.date.slice(8, 10)) === s.day ? local.date.slice(0, 7) : null
  return key && key !== s.last_sent_key ? key : null
}

const dayText = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
const range = (doc: ReportDoc) => (doc.period.firstDay === doc.period.lastDay ? dayText(doc.period.firstDay) : `${dayText(doc.period.firstDay)} – ${dayText(doc.period.lastDay)}`)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The message for WhatsApp / Telegram: short, the answer first. */
export function summaryText(doc: ReportDoc, link: string): string {
  const lines: string[] = [`*${doc.title}*`, range(doc)]
  if (doc.headline) lines.push('', clip(doc.headline, 300))
  const kpis = doc.blocks.find((b) => b.kind === 'kpis')
  if (kpis && kpis.kind === 'kpis') {
    lines.push('')
    for (const it of kpis.items.slice(0, 5)) {
      const c = it.compare
      if (!c || c.before == null) { lines.push(`• ${clip(it.label, 60)}: ${clip(it.value, 40)}`); continue }
      const ch = changeLabel(judgeChange(c), String)
      const before = typeof c.before === 'number' ? `before ${Number.isInteger(c.before) ? c.before : Math.round(c.before * 10) / 10}` : ''
      lines.push(`• ${clip(it.label, 60)}: ${clip(it.value, 40)}${before ? ` (${before}${ch ? `, ${ch}` : ''})` : ''}`)
    }
  }
  const findings = doc.blocks.find((b) => b.kind === 'findings')
  if (findings && findings.kind === 'findings') {
    const serious = findings.items.filter((f) => f.severity === 'high' || f.severity === 'medium').slice(0, 3)
    if (serious.length) {
      lines.push('', 'To work on:')
      serious.forEach((f, i) => lines.push(`${i + 1}. ${clip(f.title, 140)}`))
    }
  }
  lines.push('', `Open the report: ${link}`)
  return clip(lines.join('\n'), 1500)
}

/** One line for a utility template's variable, outside WhatsApp's 24-hour window. */
export function oneLine(doc: ReportDoc): string {
  const text = `your ${doc.title} for ${range(doc)}: ${doc.headline ?? 'it is ready'}`.replace(/\s+/g, ' ').trim()
  return clip(text, 300)
}

/** A scheduled report goes only to someone who sees that report for the
 *  whole team: supervisors and above, owners and admins for money ones. */
export function recipientMayGet(reportKey: string, role: AccountRole | string): boolean {
  const def = REPORT_RULES[reportKey]
  if (!def) return false
  return hasMinRole(role as AccountRole, def.minRole)
}

/** The same roles as the registry, without loading every report builder. */
const REPORT_RULES: Record<string, { minRole: AccountRole }> = {
  all: { minRole: 'supervisor' },
  leads: { minRole: 'supervisor' },
  agents: { minRole: 'supervisor' },
  sales: { minRole: 'supervisor' },
  spending: { minRole: 'supervisor' },
  campaigns: { minRole: 'supervisor' },
  conversations: { minRole: 'supervisor' },
  automation: { minRole: 'supervisor' },
  guide: { minRole: 'supervisor' },
  ads: { minRole: 'admin' },
}
export const SCHEDULABLE = Object.keys(REPORT_RULES)
