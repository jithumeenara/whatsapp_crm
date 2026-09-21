/**
 * Moving every stalled offer along, wherever somebody happens to ask.
 *
 * ── Why this is a function and not a job ────────────────────────────
 *
 * An offer times out because its row says when it was made and how long
 * it had. That is what lets it survive a restart — but it also means
 * nothing happens on its own, so the rule has to be run from wherever
 * the app is already doing something. Three callers do it: an agent's
 * browser asking what it has been offered, a customer writing again,
 * and a cron for the case where neither is happening.
 *
 * Three triggers for one rule is deliberate. The failure mode of having
 * one is a conversation waiting forever with nothing on any screen to
 * say so, and that failure looks exactly like nothing happening — so
 * nobody reports it.
 *
 * ── What "exhausted" does, since it is not silence ──────────────────
 *
 * When the rotation ends, three things happen and none of them is
 * giving up: a note goes on the thread saying who was asked, the
 * conversation stays claimable by anybody, and the caller is told so it
 * can ask the customer when they would like to be called back. The
 * ringing stops; the obligation does not.
 */

import { prisma } from '@/lib/db'
import { isExpired } from './offer'
import { offerConversation } from './run-offer'

/** One account's stalled offers. Bounded because an account that was
 *  offline for a day should not turn one request into a hundred model
 *  calls and a hundred socket messages. */
const MAX_PER_SWEEP = 20

export interface AdvanceResult {
  advanced: number
  exhausted: Array<{ conversationId: string; reason: string }>
}

/**
 * Hand one conversation to the next person, right now.
 *
 * The sweep below only looks at offers whose clock has run out, which
 * is correct for a timeout and wrong for a decline: an agent who says
 * "not me" has freed the conversation this second, and making the
 * customer wait out the rest of a minute that nobody is watching would
 * waste the one thing declining was supposed to save.
 */
export async function advanceConversation(
  accountId: string,
  conversationId: string,
): Promise<void> {
  const outcome = await offerConversation({
    accountId,
    conversationId,
    category: await categoryFor(conversationId),
  })

  if (outcome.result === 'offered') {
    await announceOffer(accountId, conversationId, outcome.offerId, outcome.userId)
  } else if (outcome.result === 'exhausted') {
    await giveUp(accountId, conversationId, outcome.reason)
  }
}

/**
 * What the assistant said this was about, if it was sure.
 *
 * Only 'high'. An unsure category would send the conversation to a
 * speciality that may well be the wrong one, which is worse than
 * sending it to whoever is free — and the assistant says unsure
 * precisely when the message does not settle it.
 */
async function categoryFor(conversationId: string): Promise<string | null> {
  const judgement = await prisma.aiJudgement
    .findFirst({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'desc' },
      select: { category: true, category_confidence: true },
    })
    .catch(() => null)
  return judgement?.category && judgement.category_confidence === 'high'
    ? judgement.category
    : null
}

export async function advanceStaleOffers(accountId: string): Promise<AdvanceResult> {
  const now = new Date()

  const stale = await prisma.conversationOffer.findMany({
    where: { account_id: accountId, status: 'pending' },
    orderBy: { offered_at: 'asc' },
    take: MAX_PER_SWEEP,
    select: { conversation_id: true, offered_at: true, window_seconds: true },
  })

  const ripe = stale.filter((o) => isExpired(o.offered_at, o.window_seconds, now))
  if (ripe.length === 0) return { advanced: 0, exhausted: [] }

  // One conversation can hold only one pending offer, but a sweep can
  // pick up several rows for it if something went wrong earlier.
  // Deduplicated so it is not offered twice in the same pass.
  const conversationIds = [...new Set(ripe.map((o) => o.conversation_id))]

  let advanced = 0
  const exhausted: AdvanceResult['exhausted'] = []

  for (const conversationId of conversationIds) {
    const outcome = await offerConversation({
      accountId,
      conversationId,
      category: await categoryFor(conversationId),
      now,
    })

    if (outcome.result === 'offered') {
      advanced += 1
      await announceOffer(accountId, conversationId, outcome.offerId, outcome.userId)
    } else if (outcome.result === 'exhausted') {
      exhausted.push({ conversationId, reason: outcome.reason })
      await giveUp(accountId, conversationId, outcome.reason)
    }
  }

  return { advanced, exhausted }
}

/**
 * Tell the team an offer exists.
 *
 * Broadcast to the account rather than to one person, because the
 * socket rooms are per account and adding per-user rooms for this alone
 * would be a second addressing scheme to keep correct. The browser
 * ignores anything not addressed to it, and the payload carries nothing
 * a colleague could not already see on the Inbox.
 */
async function announceOffer(
  accountId: string,
  conversationId: string,
  offerId?: string,
  userId?: string,
): Promise<void> {
  if (!offerId || !userId) return
  try {
    const { emitToAccount } = await import('@/lib/socket')
    emitToAccount(accountId, 'offer', { offerId, userId, conversationId })
  } catch {
    // The browser polls as well. A dropped announcement costs a few
    // seconds, not the offer.
  }
}

/**
 * The rotation is over.
 *
 * Three things happen, and none of them is silence. The thread gets a
 * note saying who was asked; the customer is told and offered times to
 * be rung back; and a follow-up is created whether or not they answer.
 *
 * That last one is the rule this whole path exists to keep: if the
 * system makes a promise, something has to be scheduled to keep it.
 * Without it, "we will get back to you" is a sentence the app sends and
 * then forgets, which is worse than never having said it.
 *
 * Asked at most once per conversation. A customer who has already been
 * offered times and then writes again should not be offered them a
 * second time — that reads as a machine that is not listening.
 */
async function giveUp(accountId: string, conversationId: string, reason: string): Promise<void> {
  await noteExhausted(conversationId, reason)

  const alreadyAsked = await prisma.followUp
    .findFirst({
      where: {
        account_id: accountId,
        contact: { conversations: { some: { id: conversationId } } },
        status: 'pending',
        title: { startsWith: 'Call back' },
      },
      select: { id: true },
    })
    .catch(() => null)
  if (alreadyAsked) return

  const { askForCallbackTime } = await import('./ask-callback')
  await askForCallbackTime({ accountId, conversationId })
}

/**
 * Write on the thread what happened, for whoever opens it later.
 *
 * Without this the conversation simply sits unassigned, and the honest
 * question "why did nobody answer this for twenty minutes?" has no
 * answer anywhere in the app.
 */
async function noteExhausted(conversationId: string, reason: string): Promise<void> {
  try {
    await prisma.message.create({
      data: {
        conversation_id: conversationId,
        sender_type: 'system',
        content_type: 'text',
        content_text: `Nobody picked this up. ${reason} It is still open for anyone to take.`,
        status: 'sent',
      },
    })
  } catch {
    // A missing note must not stop the rotation ending.
  }
}
