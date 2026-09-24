import { prisma } from '@/lib/db'

/**
 * A broadcast's sent / delivered / read / replied / failed figures,
 * always worked out from its recipients.
 *
 * They used to be kept as running totals, added to from four places —
 * the send loop, the client send route, the status webhook and the reply
 * handler. Any status Meta delivered twice, any send counted by both the
 * loop and a webhook, any recurring cycle that reset the recipients but
 * not every total, added again. A live campaign of 23 recipients showed
 * "46 sent, 40 delivered, 22 read, 6 failed" in the list while its own
 * page, which counted recipients, said 20, 20, 11 and 3.
 *
 * Counting the recipients cannot drift: each person is in exactly one
 * state. The funnel is cumulative — somebody who read it was also sent it
 * and had it delivered.
 */

export interface BroadcastCounts {
  sent_count: number
  delivered_count: number
  read_count: number
  replied_count: number
  failed_count: number
}

const LADDER = ['sent', 'delivered', 'read', 'replied'] as const

export function countsFromStatuses(rows: Array<{ status: string; count: number }>): BroadcastCounts {
  const out: BroadcastCounts = { sent_count: 0, delivered_count: 0, read_count: 0, replied_count: 0, failed_count: 0 }
  for (const { status, count } of rows) {
    if (status === 'failed') { out.failed_count += count; continue }
    const rank = LADDER.indexOf(status as (typeof LADDER)[number])
    if (rank >= 0) out.sent_count += count
    if (rank >= 1) out.delivered_count += count
    if (rank >= 2) out.read_count += count
    if (rank >= 3) out.replied_count += count
  }
  return out
}

/** Live figures for several broadcasts in one query, keyed by id. */
export async function liveCounts(broadcastIds: string[]): Promise<Map<string, BroadcastCounts>> {
  const result = new Map<string, BroadcastCounts>()
  if (broadcastIds.length === 0) return result
  const groups = await prisma.broadcastRecipient.groupBy({
    by: ['broadcast_id', 'status'],
    where: { broadcast_id: { in: broadcastIds } },
    _count: { _all: true },
  })
  const byBroadcast = new Map<string, Array<{ status: string; count: number }>>()
  for (const g of groups) {
    const list = byBroadcast.get(g.broadcast_id) ?? []
    list.push({ status: g.status, count: g._count._all })
    byBroadcast.set(g.broadcast_id, list)
  }
  for (const id of broadcastIds) result.set(id, countsFromStatuses(byBroadcast.get(id) ?? []))
  return result
}

/** Rewrites the stored figures from the recipients. Call after any
 *  recipient changes state, instead of adding to a total. */
export async function refreshBroadcastCounts(broadcastId: string): Promise<BroadcastCounts> {
  const counts = (await liveCounts([broadcastId])).get(broadcastId)!
  await prisma.broadcast.update({ where: { id: broadcastId }, data: counts })
  return counts
}
