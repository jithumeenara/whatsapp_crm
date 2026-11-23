/**
 * Tells somebody when an error keeps happening (app_errors, migration 195).
 *
 * Every five minutes: an error seen REPEAT_THRESHOLD or more times that
 * nobody has been told about (or was told about over RE_ALERT_MS ago and
 * is still happening) sends one push notification —
 *   - to the workspace's owners and admins when it happened in a
 *     workspace (a browser error from a signed-in person);
 *   - to the server's owner (PLATFORM_ADMIN_EMAILS, or the first
 *     workspace's owner) for a server-wide error.
 * One notification lists up to three errors, so a bad deploy is one buzz,
 * not fifty. The claim on each row is a conditional update, so two
 * sweeps never alert the same error twice.
 */

import { prisma } from '@/lib/db'

export const REPEAT_THRESHOLD = 5
export const RE_ALERT_MS = 6 * 60 * 60 * 1000

async function serverOwnerIds(): Promise<string[]> {
  const listed = (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (listed.length > 0) {
    const users = await prisma.user.findMany({
      where: { OR: listed.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })), password_hash: { not: null } },
      select: { id: true },
    })
    return users.map((u) => u.id)
  }
  const first = await prisma.account.findFirst({ orderBy: { created_at: 'asc' }, select: { owner_user_id: true } })
  return first?.owner_user_id ? [first.owner_user_id] : []
}

async function workspaceAdminIds(accountId: string): Promise<string[]> {
  const people = await prisma.profile.findMany({
    where: { account_id: accountId, account_role: { in: ['owner', 'admin'] } },
    select: { user_id: true },
  })
  return people.map((p) => p.user_id)
}

export async function sweepErrorAlerts(now: Date = new Date()): Promise<number> {
  const reAlertBefore = new Date(now.getTime() - RE_ALERT_MS)
  const due = await prisma.appError.findMany({
    where: {
      resolved_at: null,
      count: { gte: REPEAT_THRESHOLD },
      OR: [{ alerted_at: null }, { alerted_at: { lt: reAlertBefore }, last_seen: { gt: reAlertBefore } }],
    },
    orderBy: { last_seen: 'desc' },
    take: 50,
    select: { id: true, account_id: true, where_at: true, message: true, count: true, alerted_at: true },
  })
  if (due.length === 0) return 0

  // Claim each row first; only the claimed ones are announced.
  const claimed: typeof due = []
  for (const row of due) {
    const r = await prisma.appError.updateMany({
      where: { id: row.id, alerted_at: row.alerted_at },
      data: { alerted_at: now },
    })
    if (r.count === 1) claimed.push(row)
  }

  const groups = new Map<string, typeof due>()
  for (const row of claimed) {
    const key = row.account_id ?? ''
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  const { sendPushToUser } = await import('@/lib/push')
  for (const [accountId, rows] of groups) {
    const people = accountId ? await workspaceAdminIds(accountId) : await serverOwnerIds()
    const lines = rows.slice(0, 3).map((r) => `• ${r.where_at || 'Error'}: ${r.message.slice(0, 80)} (${r.count}×)`)
    const more = rows.length > 3 ? `\n…and ${rows.length - 3} more` : ''
    const title = rows.length === 1 ? 'An error keeps happening' : `${rows.length} errors keep happening`
    await Promise.all(
      people.map((id) => sendPushToUser(id, { title, body: lines.join('\n') + more, tag: 'app-errors', data: { url: '/settings?tab=errors' } }).catch(() => {})),
    )
  }
  return claimed.length
}
