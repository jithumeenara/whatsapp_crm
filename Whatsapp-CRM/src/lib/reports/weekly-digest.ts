/**
 * The weekly owner digest (reports plan, Phase 4): on Monday, the admin's
 * morning brief (src/lib/admin-chat/brief-sweep.ts) also carries last
 * week's report — the numbers, up to three things to do, and a link.
 *
 * Rules from the plan:
 * - Code writes it, not AI. Every number comes from buildSummary.
 * - No customer name or number, ever: only counts. The leak rows the
 *   screen shows (lead titles) are never read here.
 * - Team numbers only for someone who is still an admin or owner of this
 *   account at the moment it is sent — a demoted member gets the plain
 *   brief. The link needs a login.
 * - Sent after the week has closed (Monday), and it says which days.
 *
 * Loaded by server.ts through brief-sweep: no next/server in this graph.
 */

import { prisma } from '@/lib/db'
import { hasMinRole, isAccountRole } from '@/lib/auth/roles'
import { resolvePeriod } from './period'
import { buildSummary, type ReportSummary } from './summary'
import { actions, change, formatMoney } from './headline'

/** Monday, the first day of the report week (period.ts weekStart). */
export function isDigestDay(localDate: string): boolean {
  const [y, m, d] = localDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1
}

/** The week that just closed: the seven days before this Monday. */
export function lastWeek(localDate: string): { from: string; to: string } {
  const [y, m, d] = localDate.split('-').map(Number)
  const day = (offset: number) => new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10)
  return { from: day(-7), to: day(-1) }
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function vs(now: number, before: number): string {
  const c = change(now, before)
  if (c == null) return ''
  if (c === 0) return ' (same as the week before)'
  return ` (${c > 0 ? '↑' : '↓'}${Math.abs(c)}% on the week before)`
}

/** The text added to Monday's brief. Pure. */
export function composeWeekly(s: ReportSummary, week: { from: string; to: string }, link: string): string {
  const lines = [`📅 *Last week* — ${dayLabel(week.from)} to ${dayLabel(week.to)}`]
  lines.push(`• Leads: *${s.cohort.total.toLocaleString('en-IN')}*${vs(s.cohort.total, s.previousCohort.total)}`)
  lines.push(`• Won: *${s.wonInPeriod.toLocaleString('en-IN')}*${vs(s.wonInPeriod, s.previousWonInPeriod)} · Lost: *${s.lostInPeriod.toLocaleString('en-IN')}*`)
  const revenue = s.revenue.filter((m) => m.amount > 0)
  if (revenue.length) lines.push(`• Revenue won: *${revenue.map(formatMoney).join(' + ')}*`)
  if (s.calls.total > 0) lines.push(`• Calls: *${s.calls.total.toLocaleString('en-IN')}*, connected ${s.calls.connected.toLocaleString('en-IN')}`)
  const todo = actions(s)
  if (todo.length) {
    lines.push('', '*To do now:*')
    todo.slice(0, 3).forEach((a, i) => lines.push(`${i + 1}. ${a.text}`))
  } else {
    lines.push('', 'Nothing is leaking right now.')
  }
  if (link) lines.push('', `Full report: ${link}`)
  return lines.join('\n')
}

function reportLink(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  return /^https?:\/\//.test(base) ? `${base}/reports` : ''
}

/**
 * Last week's digest for one admin, or null when it should not go: not
 * Monday, the person is no longer an admin of this account, or the
 * report could not be built (the plain brief still goes; logged).
 */
export async function weeklyDigestFor(args: {
  accountId: string
  userId: string
  localDate: string
  timeZone: string
  now: Date
  cache?: Map<string, string | null>
}): Promise<string | null> {
  if (!isDigestDay(args.localDate)) return null
  const profile = await prisma.profile.findUnique({ where: { user_id: args.userId }, select: { account_id: true, account_role: true } })
  if (!profile || profile.account_id !== args.accountId || !isAccountRole(profile.account_role) || !hasMinRole(profile.account_role, 'admin')) return null

  // One build per account per run, however many admins get it.
  const key = `${args.accountId}:${args.localDate}`
  if (args.cache?.has(key)) return args.cache.get(key) ?? null
  let text: string | null = null
  try {
    const week = lastWeek(args.localDate)
    const period = resolvePeriod({ kind: 'custom', from: week.from, to: week.to }, args.now, args.timeZone)
    if (period) {
      const summary = await buildSummary({ accountId: args.accountId, userId: null, period, now: args.now, tz: args.timeZone })
      text = composeWeekly(summary, week, reportLink())
    }
  } catch (err) {
    console.error('[reports] weekly digest failed:', err instanceof Error ? err.message : err)
  }
  args.cache?.set(key, text)
  return text
}
