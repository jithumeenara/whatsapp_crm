/**
 * A WhatsApp status update (sent → delivered → read, or failed) for one
 * of our messages.
 */

import { prisma } from '@/lib/db'

const LADDER = ['pending', 'sent', 'delivered', 'read', 'replied'] as const

function level(s: string): number {
  return (LADDER as readonly string[]).indexOf(s)
}

/** May a message (or broadcast recipient) move from `current` to `incoming`?
 *  Forward along the ladder only; "failed" only before delivery. */
export function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') return current === 'pending' || current === 'sent'
  if (current === 'failed') return false
  const ci = level(current)
  const ii = level(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

/**
 * Moves our message(s) with this WhatsApp id forward to `status` and tells
 * the open Inbox at once, so blue ticks appear without reopening the chat.
 * Out-of-order reports (a "delivered" after "read") change nothing. Each
 * write is conditional on the status it read, so two reports racing can't
 * step back either.
 */
export async function applyMessageStatus(wamid: string, status: string): Promise<void> {
  const rows = await prisma.message.findMany({
    where: { message_id: wamid },
    select: { id: true, status: true, conversation_id: true, conversation: { select: { account_id: true } } },
  })
  if (rows.length === 0) return
  const { emitToAccount } = await import('@/lib/socket')
  for (const row of rows) {
    if (!isValidStatusTransition(row.status, status)) continue
    const res = await prisma.message.updateMany({
      where: { id: row.id, status: row.status },
      data: { status },
    })
    if (res.count === 0) continue
    const accountId = row.conversation?.account_id
    if (accountId) {
      emitToAccount(accountId, 'message', {
        eventType: 'UPDATE',
        new: { id: row.id, status, conversation_id: row.conversation_id },
        old: {},
      })
    }
  }
}
