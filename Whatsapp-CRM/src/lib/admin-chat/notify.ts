/**
 * Tells the account's owners and admins about Admin Chat sign-ins,
 * lockouts and enrolments (push notification to the CRM app). More than
 * one person hears of every sign-in, so a stolen phone is noticed.
 */

import { prisma } from '@/lib/db'
import { sendPushToUser } from '@/lib/push'

export async function notifyAdmins(args: { accountId: string; exceptUserId: string | null; title: string; body: string }): Promise<void> {
  try {
    const people = await prisma.profile.findMany({
      where: { account_id: args.accountId, account_role: { in: ['owner', 'admin'] } },
      select: { user_id: true },
    })
    await Promise.all(
      people
        .filter((p) => p.user_id !== args.exceptUserId)
        .map((p) => sendPushToUser(p.user_id, { title: args.title, body: args.body, tag: 'admin-chat', data: { url: '/settings?tab=admin-chat' } }).catch(() => {})),
    )
  } catch (err) {
    console.error('[admin-chat] notify failed:', err instanceof Error ? err.message : err)
  }
}
