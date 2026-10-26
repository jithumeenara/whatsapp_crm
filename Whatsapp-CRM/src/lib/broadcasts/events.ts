/**
 * Event-based broadcasts: "when the tag Paid is added, send the welcome
 * template an hour later".
 *
 * An event broadcast is an ordinary broadcast with schedule_type 'event'
 * that stays 'active'. A tag event adds the person as a recipient with
 * send_after = now + delay — once per person, ever, so a tag taken off and
 * put back does not send the welcome twice. The sweep (sweep.ts) sends the
 * recipients that are due, inside the broadcast's send window, through the
 * same runBroadcast as every campaign: same template mapping, same opt-out,
 * blocked and frequency-cap rules, same report with its groups and
 * follow-ups.
 *
 * The opposite event calls off a wait that has not gone yet: a "Tag
 * added" welcome is not sent to someone whose tag was removed in the
 * meantime.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { liveSendableContactWhere } from './sendable'

export type TagEvent = 'tag_added' | 'tag_removed'

export async function onTagEvent(args: {
  accountId: string
  event: TagEvent
  pairs: ReadonlyArray<{ contactId: string; tagId: string }>
}): Promise<{ queued: number; calledOff: number }> {
  const byTag = new Map<string, string[]>()
  for (const p of args.pairs) {
    const list = byTag.get(p.tagId) ?? []
    if (!list.includes(p.contactId)) list.push(p.contactId)
    byTag.set(p.tagId, list)
  }
  if (byTag.size === 0) return { queued: 0, calledOff: 0 }

  let queued = 0
  const campaigns = await prisma.broadcast.findMany({
    where: {
      account_id: args.accountId,
      schedule_type: 'event',
      status: { in: ['active', 'sending'] },
      event_trigger: args.event,
      event_tag_id: { in: [...byTag.keys()] },
    },
    select: { id: true, event_tag_id: true, event_delay_minutes: true },
  })
  for (const c of campaigns) {
    const contactIds = byTag.get(c.event_tag_id ?? '') ?? []
    queued += await enqueueEventRecipients(args.accountId, c.id, contactIds, c.event_delay_minutes)
  }

  // The opposite event calls off waits that have not been sent yet.
  const opposite: TagEvent = args.event === 'tag_added' ? 'tag_removed' : 'tag_added'
  let calledOff = 0
  for (const [tagId, contactIds] of byTag) {
    const r = await prisma.broadcastRecipient.updateMany({
      where: {
        status: 'pending',
        contact_id: { in: contactIds },
        broadcast: { account_id: args.accountId, schedule_type: 'event', event_trigger: opposite, event_tag_id: tagId },
      },
      data: {
        status: 'skipped',
        error_message: args.event === 'tag_removed' ? 'Left out: tag removed before it was sent' : 'Left out: tag added back before it was sent',
      },
    })
    calledOff += r.count
  }
  return { queued, calledOff }
}

/**
 * Adds people to an event broadcast, once each. Serialised per broadcast
 * with a transaction-level advisory lock, so two tag events for the same
 * person at the same moment still make one recipient.
 */
export async function enqueueEventRecipients(
  accountId: string,
  broadcastId: string,
  contactIds: readonly string[],
  delayMinutes: number,
  now: Date = new Date(),
): Promise<number> {
  if (contactIds.length === 0) return 0
  // Only people who can get a broadcast at all — not website visitors or
  // email-only contacts. Opt-outs are checked again at send time.
  const sendable = await prisma.contact.findMany({
    where: { AND: [liveSendableContactWhere(accountId), { id: { in: [...contactIds] } }] },
    select: { id: true },
  })
  if (sendable.length === 0) return 0
  const sendAfter = new Date(now.getTime() + Math.max(0, delayMinutes) * 60_000)

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${broadcastId}))`)
    const already = new Set(
      (
        await tx.broadcastRecipient.findMany({
          where: { broadcast_id: broadcastId, contact_id: { in: sendable.map((c) => c.id) } },
          select: { contact_id: true },
        })
      ).map((r) => r.contact_id),
    )
    const fresh = sendable.filter((c) => !already.has(c.id))
    if (fresh.length === 0) return 0
    await tx.broadcastRecipient.createMany({
      data: fresh.map((c) => ({ broadcast_id: broadcastId, contact_id: c.id, status: 'pending', send_after: sendAfter })),
    })
    await tx.broadcast.update({ where: { id: broadcastId }, data: { total_recipients: { increment: fresh.length } } })
    return fresh.length
  })
}
