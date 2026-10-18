/**
 * Which broadcast a customer's message is a reply to.
 *
 * The latest broadcast they got that they have not answered yet — but only
 * within the reply window. A message weeks later is a new conversation,
 * not an answer to the campaign, and counting it made "Replied" look better
 * and "Read, no reply" (the people worth following up) look smaller than
 * they were.
 *
 * Best effort: never breaks the inbound message it was called for.
 */

import { prisma } from '@/lib/db'
import { refreshBroadcastCounts } from './counts'

/** 3 days — long enough for a considered answer, short enough that a
 *  later, unrelated message is not taken for one. */
export const REPLY_WINDOW_HOURS = 72

export async function attributeBroadcastReply(accountId: string, contactId: string, now: Date = new Date()): Promise<void> {
  try {
    const rec = await prisma.broadcastRecipient.findFirst({
      where: {
        contact_id: contactId,
        status: { in: ['sent', 'delivered', 'read'] },
        broadcast: { account_id: accountId },
        sent_at: { gte: new Date(now.getTime() - REPLY_WINDOW_HOURS * 3600_000) },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    })
    if (!rec) return

    const updated = await prisma.broadcastRecipient.update({
      where: { id: rec.id },
      data: { status: 'replied', replied_at: now },
      select: { broadcast_id: true },
    })
    await refreshBroadcastCounts(updated.broadcast_id)
  } catch (err) {
    console.error('[broadcast] reply attribution failed:', err instanceof Error ? err.message : err)
  }
}
