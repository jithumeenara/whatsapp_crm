/**
 * Blocking a contact, and noticing a flood before a person has to.
 *
 * Two separate mechanisms, deliberately not merged:
 *
 *   - **A manual block** is somebody's decision. Nothing here ever
 *     overturns it, and it has no expiry.
 *   - **A flood block** is a guess made by counting. Guesses are wrong
 *     sometimes — a customer pasting a long enquiry in ten short lines
 *     looks exactly like a flood — so it is recorded as automatic, is
 *     trivially reversible, and never escalates into a manual block.
 *
 * The check runs on every inbound message, so it is one indexed read and
 * nothing else. Everything expensive — the assistant, the chatbot, the
 * notifications — happens after it and is skipped when it fires.
 *
 * What blocking deliberately does NOT do is tell the sender. Meta offers
 * no way to silently reject, and a reply saying "you are blocked" is an
 * invitation to try another number. The message is simply stored and
 * nothing acts on it, so the thread stays complete for whoever reviews
 * the block later.
 */

import { prisma } from '@/lib/db'

/** Messages from one contact within the window that trip the rule. */
const FLOOD_MESSAGE_COUNT = 25
/** The window, in seconds. */
const FLOOD_WINDOW_SECONDS = 60

export interface BlockCheck {
  blocked: boolean
  reason?: string | null
  source?: string | null
}

/**
 * Is this contact blocked?
 *
 * One indexed read on a column that is null for almost every contact.
 */
export async function isContactBlocked(contactId: string): Promise<BlockCheck> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { blocked_at: true, block_reason: true, blocked_source: true },
  })
  if (!contact?.blocked_at) return { blocked: false }
  return { blocked: true, reason: contact.block_reason, source: contact.blocked_source }
}

/**
 * Counts recent inbound messages and blocks the contact if there are too
 * many.
 *
 * Called after the message is stored, never before — the message that
 * trips the rule is part of the evidence, and an agent reviewing the
 * block needs to see it.
 *
 * Returns true when it just blocked them, so the caller can stop.
 */
export async function checkForFlood(args: {
  contactId: string
  conversationId: string
}): Promise<boolean> {
  const since = new Date(Date.now() - FLOOD_WINDOW_SECONDS * 1000)

  const recent = await prisma.message.count({
    where: {
      conversation_id: args.conversationId,
      sender_type: 'customer',
      created_at: { gt: since },
    },
  })
  if (recent < FLOOD_MESSAGE_COUNT) return false

  // Guarded on blocked_at being null so this never overwrites a manual
  // block — whose reason and author are a record of somebody's decision
  // and must not be replaced by a machine's count.
  const blocked = await prisma.contact.updateMany({
    where: { id: args.contactId, blocked_at: null },
    data: {
      blocked_at: new Date(),
      blocked_source: 'flood',
      block_reason: `${recent} messages in ${FLOOD_WINDOW_SECONDS} seconds`,
    },
  })

  if (blocked.count > 0) {
    console.warn(
      `[spam] blocked contact ${args.contactId}: ${recent} messages in ${FLOOD_WINDOW_SECONDS}s. ` +
        'Automatic — unblock from the contact if this was a real customer.',
    )
    return true
  }
  return false
}

/** Blocks a contact because a person said so. */
export async function blockContact(args: {
  contactId: string
  accountId: string
  userId: string
  reason?: string | null
}): Promise<void> {
  await prisma.contact.updateMany({
    where: { id: args.contactId, account_id: args.accountId },
    data: {
      blocked_at: new Date(),
      blocked_source: 'manual',
      blocked_by: args.userId,
      block_reason: args.reason?.trim() || null,
    },
  })
}

/** Lifts a block, whoever set it. */
export async function unblockContact(args: {
  contactId: string
  accountId: string
}): Promise<void> {
  await prisma.contact.updateMany({
    where: { id: args.contactId, account_id: args.accountId },
    data: {
      blocked_at: null,
      blocked_source: null,
      blocked_by: null,
      block_reason: null,
    },
  })
}
