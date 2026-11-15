/**
 * Red alerts — run every 30 minutes from server.ts (phase F3).
 *
 * For each business with Admin Chat members who switched alerts on: build
 * today's Performance guide (compared fairly with the same hours of the day
 * before) and, for each red card, tell the owners and supervisors on their
 * own channel — once per issue per day. The day's row is inserted before
 * sending (ON CONFLICT DO NOTHING); only the process that wins it sends.
 *
 * Only members inside their own allowed days and hours get it; outside
 * WhatsApp's 24-hour window it goes as the approved utility template.
 * Kept free of next/server: server.ts loads this.
 */

import { prisma } from '@/lib/db'
import { businessTimezone } from '@/lib/ai/human-date'
import { localNow, windowCheck } from '@/lib/admin-chat/rules'
import { hasMinRole, type AccountRole } from '@/lib/auth/roles'
import { resolveQuery } from '../doc/period-query'
import { loadGuide } from '../doc/reports/guide'
import { alertLine, alertText, mayGetAlert, pickAlerts } from './rules'

let running = false

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
}

export async function sweepReportAlerts(now: Date = new Date()): Promise<{ sent: number }> {
  if (running) return { sent: 0 }
  running = true
  try {
    const members = await prisma.adminChatMember.findMany({ where: { status: 'active', verified_at: { not: null }, alerts_enabled: true } })
    const byAccount = new Map<string, typeof members>()
    for (const m of members) byAccount.set(m.account_id, [...(byAccount.get(m.account_id) ?? []), m])
    let sent = 0
    for (const [accountId, list] of byAccount) {
      try {
        sent += await alertAccount(accountId, list, now)
      } catch (err) {
        console.error('[report-alerts] account failed:', accountId, err instanceof Error ? err.message : err)
      }
    }
    return { sent }
  } finally {
    running = false
  }
}

async function alertAccount(accountId: string, members: Awaited<ReturnType<typeof prisma.adminChatMember.findMany>>, now: Date): Promise<number> {
  const [settings, tz, roles] = await Promise.all([
    prisma.adminChatSettings.findUnique({ where: { account_id: accountId } }),
    businessTimezone(accountId).catch(() => 'Asia/Kolkata'),
    prisma.profile.findMany({ where: { account_id: accountId, user_id: { in: members.map((m) => m.user_id) } }, select: { user_id: true, account_role: true } }),
  ])
  if (!settings) return 0
  const local = localNow(tz, now)
  const role = new Map(roles.map((r) => [r.user_id, r.account_role as string]))
  // Owners, admins and supervisors inside their own allowed days and hours.
  const reachable = members.filter((m) => hasMinRole((role.get(m.user_id) ?? 'viewer') as AccountRole, 'supervisor') && windowCheck(m, local).ok)
  if (!reachable.length) return 0

  const q = resolveQuery({ period: 'today', compare: 'previous' }, now, tz)
  if (!q) return 0
  const { findings } = await loadGuide({ accountId, userId: null, role: 'owner', tz, now, q, subject: null }, {}, true)
  const alerts = pickAlerts(findings)
  if (!alerts.length) return 0

  const { sendToAdmin } = await import('@/lib/admin-chat/brief-sweep')
  const link = `${appBase()}/reports/guide?period=today&compare=previous`
  let sent = 0
  for (const f of alerts) {
    const to = reachable.filter((m) => mayGetAlert(f, role.get(m.user_id) ?? 'viewer'))
    if (!to.length) continue
    // Claim today's announcement of this issue; a duplicate means it went already.
    const claimed = await prisma.reportAlertLog.createMany({
      data: [{ account_id: accountId, code: f.code.slice(0, 200), sent_on: new Date(`${local.date}T00:00:00Z`), recipients: to.length }],
      skipDuplicates: true,
    })
    if (claimed.count === 0) continue
    for (const m of to) {
      try {
        const how = await sendToAdmin(m, settings, alertText(f, link), alertLine(f), now)
        if (how === 'text' || how === 'template') sent += 1
      } catch (err) {
        console.error('[report-alerts] send failed:', err instanceof Error ? err.message : err)
      }
    }
  }
  return sent
}
