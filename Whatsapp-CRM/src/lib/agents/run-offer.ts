/**
 * Running an offer: making it, timing it out, moving on, stopping.
 *
 * The database side of src/lib/agents/offer.ts, which holds the rules
 * and stays pure. Split so the rules can be tested without a database,
 * because they are the part that is easy to get subtly wrong and
 * expensive to get wrong in production.
 *
 * ── Why nothing here is scheduled ───────────────────────────────────
 *
 * There is no timer anywhere. An offer expires because its row says
 * when it was made and how long it had, so any request can notice —
 * the agent's own screen polling, the next inbound message, the sweep.
 * A conversation cannot get stuck waiting on a callback that a restart
 * threw away.
 *
 * ── Why an offer never blocks anybody else ──────────────────────────
 *
 * The conversation stays unassigned and visible to the whole team while
 * it is being offered. The offer creates urgency and a named owner; it
 * does not lock anything. Anybody who is free can simply take it, which
 * cancels the outstanding offer — the one case where being beaten to it
 * is a good outcome and should not be counted as a timeout.
 */

import { prisma } from '@/lib/db'
import { presenceOf } from './presence'
import { isOnShift, parseWorkingHours } from './working-hours'
import {
  pickForOffer,
  isExpired,
  shouldKeepOffering,
  describeGivingUp,
  DEFAULT_OFFER_SECONDS,
  DEFAULT_MAX_CONCURRENT,
  type OfferCandidate,
} from './offer'

/** Roles that can actually reply. Offering to a viewer is offering to
 *  nobody — they cannot send a message. */
const REPLY_CAPABLE = ['owner', 'supervisor', 'admin', 'agent']

export interface OfferOutcome {
  /** 'offered' — somebody is being asked right now.
   *  'exhausted' — the rotation is over; the caller tells the customer
   *  and the supervisor.
   *  'disabled' / 'already_taken' — nothing to do. */
  result: 'offered' | 'exhausted' | 'disabled' | 'already_taken'
  offerId?: string
  userId?: string
  reason: string
  outsideSpeciality?: boolean
}

/**
 * Offer this conversation to the next person, or report that the
 * rotation is finished.
 *
 * Safe to call repeatedly: an existing live offer is left alone, so a
 * second inbound message from an impatient customer does not restart
 * the clock or double-alert anybody.
 */
export async function offerConversation(args: {
  accountId: string
  conversationId: string
  /** From the judgement, when it was sure enough. Null routes on
   *  availability alone. */
  category?: string | null
  now?: Date
}): Promise<OfferOutcome> {
  const now = args.now ?? new Date()

  const settings = await prisma.leadSettings.findUnique({
    where: { account_id: args.accountId },
    select: { offer_enabled: true, offer_seconds: true, max_concurrent_chats: true },
  })
  if (!settings?.offer_enabled) return { result: 'disabled', reason: 'offers are switched off' }

  const windowSeconds = settings.offer_seconds || DEFAULT_OFFER_SECONDS
  const cap = settings.max_concurrent_chats || DEFAULT_MAX_CONCURRENT

  // Somebody may have simply picked it up. That is the good outcome and
  // it ends the rotation.
  const conversation = await prisma.conversation.findUnique({
    where: { id: args.conversationId },
    select: { assigned_agent_id: true, status: true },
  })
  if (!conversation) return { result: 'already_taken', reason: 'the conversation is gone' }
  if (conversation.assigned_agent_id) {
    await cancelOpenOffers(args.conversationId, now)
    return { result: 'already_taken', reason: 'somebody already took it' }
  }

  const history = await prisma.conversationOffer.findMany({
    where: { conversation_id: args.conversationId },
    orderBy: { created_at: 'asc' },
    select: { id: true, user_id: true, status: true, offered_at: true, window_seconds: true },
  })

  // A live offer is left alone. Restarting the clock because the
  // customer sent a second message would mean an impatient person gets
  // a worse answer than a patient one.
  const live = history.find(
    (o) => o.status === 'pending' && !isExpired(o.offered_at, o.window_seconds, now),
  )
  if (live) {
    return { result: 'offered', offerId: live.id, userId: live.user_id, reason: 'already offered' }
  }

  // Anything still pending has run out. Recorded before choosing again,
  // so the rotation counts it and does not re-ask the same person.
  const stale = history.filter((o) => o.status === 'pending')
  if (stale.length > 0) {
    await prisma.conversationOffer.updateMany({
      where: { id: { in: stale.map((o) => o.id) } },
      data: { status: 'expired', answered_at: now },
    })
    // Missing an offer sets somebody aside, exactly as every contact
    // centre does: an agent at lunch will miss round two as surely as
    // they missed round one, and re-offering only costs the customer.
    await markAway(stale.map((o) => o.user_id), now)
  }

  const candidates = await loadCandidates(args.accountId, now)
  const alreadyOffered = history.map((o) => o.user_id)

  // Team size is measured from who could ever take it, not who is free
  // this second — otherwise one person going off shift mid-rotation
  // would silently shorten it.
  const teamSize = new Set([...candidates.map((c) => c.userId), ...alreadyOffered]).size
  if (!shouldKeepOffering({ offered: alreadyOffered, teamSize })) {
    return {
      result: 'exhausted',
      reason: describeGivingUp({ offered: alreadyOffered, teamSize }, 'nobody was available'),
    }
  }

  const pick = pickForOffer({
    candidates,
    category: args.category ?? null,
    alreadyOffered,
    maxConcurrent: cap,
  })

  if (!pick.agent) {
    return {
      result: 'exhausted',
      reason: describeGivingUp({ offered: alreadyOffered, teamSize }, pick.reason),
    }
  }

  let offer: { id: string }
  try {
    offer = await prisma.conversationOffer.create({
      data: {
        account_id: args.accountId,
        conversation_id: args.conversationId,
        user_id: pick.agent.userId,
        window_seconds: windowSeconds,
        reason: pick.reason,
        outside_speciality: pick.outsideSpeciality,
        offered_at: now,
      },
      select: { id: true },
    })
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002') throw error

    const existing = await prisma.conversationOffer.findFirst({
      where: { conversation_id: args.conversationId, status: 'pending' },
      select: { id: true, user_id: true, offered_at: true, window_seconds: true },
    })
    if (!existing || isExpired(existing.offered_at, existing.window_seconds, now)) throw error
    return {
      result: 'offered',
      offerId: existing.id,
      userId: existing.user_id,
      reason: 'already offered',
    }
  }

  return {
    result: 'offered',
    offerId: offer.id,
    userId: pick.agent.userId,
    reason: pick.reason,
    outsideSpeciality: pick.outsideSpeciality,
  }
}

/**
 * Everybody who could take a conversation on this account, with the
 * three things that decide whether they can take this one.
 *
 * Presence and working hours are read through the same modules the
 * Members screen uses, so what a supervisor sees and what the router
 * believes cannot disagree — they did before, and the router was the
 * one that was wrong.
 */
async function loadCandidates(accountId: string, now: Date): Promise<OfferCandidate[]> {
  const profiles = await prisma.profile.findMany({
    where: { account_id: accountId, account_role: { in: REPLY_CAPABLE as never } },
    select: {
      user_id: true,
      working_hours: true,
      handles_categories: true,
      user: { select: { last_seen_at: true, went_offline_at: true } },
    },
  })
  if (profiles.length === 0) return []

  const userIds = profiles.map((p) => p.user_id)
  const load = await prisma.conversation.groupBy({
    by: ['assigned_agent_id'],
    where: {
      account_id: accountId,
      assigned_agent_id: { in: userIds },
      status: { not: 'closed' },
    },
    _count: { _all: true },
  })
  const loadByUser = new Map(load.map((l) => [l.assigned_agent_id as string, l._count._all]))

  return profiles.map((p) => ({
    userId: p.user_id,
    online: presenceOf(p.user ?? null, now) === 'online',
    onShift: isOnShift(parseWorkingHours(p.working_hours), now),
    openConversations: loadByUser.get(p.user_id) ?? 0,
    handles: Array.isArray(p.handles_categories)
      ? (p.handles_categories as unknown[]).filter((h): h is string => typeof h === 'string')
      : [],
    lastSeenAt: p.user?.last_seen_at ?? null,
  }))
}

/**
 * Take somebody out of the running after they miss an offer.
 *
 * Implemented by moving their presence back rather than with a separate
 * "not ready" flag, so there is still exactly one answer to "is this
 * person here" and no second state that could disagree with the dot on
 * the Members screen. Any real activity — a click, a keypress — writes
 * a fresh timestamp and brings them straight back.
 */
async function markAway(userIds: string[], now: Date): Promise<void> {
  if (userIds.length === 0) return
  // Far enough back to read as 'away' rather than 'online', and nowhere
  // near far enough to read as signed out.
  const backdated = new Date(now.getTime() - 4 * 60_000)
  await prisma.user
    .updateMany({
      where: { id: { in: userIds }, last_seen_at: { gt: backdated } },
      data: { last_seen_at: backdated },
    })
    .catch(() => {})
}

/** Somebody took the conversation, so the outstanding offer is over —
 *  and not as a timeout, which would make a responsive team look slow
 *  in its own figures. */
export async function cancelOpenOffers(conversationId: string, now = new Date()): Promise<void> {
  await prisma.conversationOffer
    .updateMany({
      where: { conversation_id: conversationId, status: 'pending' },
      data: { status: 'cancelled', answered_at: now },
    })
    .catch(() => {})
}

export interface AcceptResult {
  ok: boolean
  /** Why not, in words the agent should see. */
  error?: string
  /** Which conversation this was about, so a decline can hand it
   *  straight on rather than waiting out a clock nobody is watching. */
  conversationId?: string
}

/**
 * An agent takes the conversation.
 *
 * The one place where losing a race matters: two agents can tap Accept
 * within the same second, and both must not end up believing they own
 * it. The assignment is conditional on the conversation still being
 * unassigned, so the second one is told plainly rather than silently
 * overwriting the first.
 */
export async function acceptOffer(args: {
  accountId: string
  offerId: string
  userId: string
  now?: Date
}): Promise<AcceptResult> {
  const now = args.now ?? new Date()

  const offer = await prisma.conversationOffer.findFirst({
    where: { id: args.offerId, account_id: args.accountId, user_id: args.userId },
    select: { id: true, conversation_id: true, status: true, offered_at: true, window_seconds: true },
  })
  if (!offer) return { ok: false, error: 'That offer is not yours.' }

  if (offer.status !== 'pending') {
    return { ok: false, error: 'This one has already been dealt with.' }
  }
  // Expired but not yet swept. Accepting is still allowed — the
  // customer is no worse off for somebody taking it late, and refusing
  // would be pedantry at the customer's expense.
  const late = isExpired(offer.offered_at, offer.window_seconds, now)

  const claimed = await prisma.conversation.updateMany({
    where: { id: offer.conversation_id, assigned_agent_id: null },
    data: { assigned_agent_id: args.userId, status: 'pending' },
  })
  if (claimed.count === 0) {
    await prisma.conversationOffer.update({
      where: { id: offer.id },
      data: { status: 'cancelled', answered_at: now },
    })
    return { ok: false, error: 'Somebody else got there first.' }
  }

  await prisma.conversationOffer.update({
    where: { id: offer.id },
    data: { status: 'accepted', answered_at: now },
  })
  // Everything else outstanding on this conversation is over, and none
  // of it timed out.
  await cancelOpenOffers(offer.conversation_id, now)

  return { ok: late ? true : true }
}

/** An agent says no. Treated exactly as a timeout for rotation
 *  purposes — they are set aside and it moves on — but recorded
 *  distinctly, because "declined" and "did not notice" are different
 *  facts about a person. */
export async function declineOffer(args: {
  accountId: string
  offerId: string
  userId: string
  now?: Date
}): Promise<AcceptResult> {
  const now = args.now ?? new Date()
  const offer = await prisma.conversationOffer.findFirst({
    where: {
      id: args.offerId,
      account_id: args.accountId,
      user_id: args.userId,
      status: 'pending',
    },
    select: { id: true, conversation_id: true },
  })
  if (!offer) return { ok: false, error: 'That offer is no longer open.' }

  await prisma.conversationOffer.update({
    where: { id: offer.id },
    data: { status: 'declined', answered_at: now },
  })
  return { ok: true, conversationId: offer.conversation_id }
}
