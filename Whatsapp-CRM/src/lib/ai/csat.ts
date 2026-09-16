/**
 * Asking the customer whether that actually helped.
 *
 * The app could already say how many conversations ended without a human
 * — containment — and nothing about whether the people in them were
 * satisfied. On its own, containment rewards a bot for being hard to
 * escape, which is the opposite of the point. This is the other half of
 * the measurement, and the only one the customer gets a say in.
 *
 * Three buttons, because WhatsApp allows three. They carry 5 / 3 / 1 so
 * the average is an ordinary 1-5 CSAT and stays comparable with how every
 * other platform reports it.
 *
 * The ask is deliberately cheap to ignore. No follow-up, no second
 * attempt, and a long silence between asks — a survey that nags is a
 * survey people learn to dismiss, and then the number means nothing.
 */

import { prisma } from '@/lib/db'
import { engineSendInteractiveButtons, engineSendText } from '@/lib/flows/meta-send'

/** Marks a button as ours, so the webhook can claim it before the flow
 *  runner sees it and treats it as an unmatched reply. */
export const CSAT_REPLY_PREFIX = 'csat:'

/** Long enough that nobody is asked twice about the same spell of
 *  contact, short enough that a customer coming back next month is worth
 *  asking again. */
const ASK_COOLDOWN_DAYS = 7

const CSAT_BUTTONS = [
  { id: `${CSAT_REPLY_PREFIX}5`, title: '😊 Good' },
  { id: `${CSAT_REPLY_PREFIX}3`, title: '🙂 Okay' },
  { id: `${CSAT_REPLY_PREFIX}1`, title: '😕 Not good' },
]

export function isCsatReply(replyId: string | null | undefined): boolean {
  return typeof replyId === 'string' && replyId.startsWith(CSAT_REPLY_PREFIX)
}

/** 5, 3 or 1 — or null if this is not one of ours. */
export function ratingFromReplyId(replyId: string): number | null {
  if (!isCsatReply(replyId)) return null
  const rating = Number(replyId.slice(CSAT_REPLY_PREFIX.length))
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null
}

export type FeedbackRequestOutcome =
  | 'sent'
  | 'skipped_recently_asked'
  | 'skipped_no_contact'
  | 'failed'

/**
 * Ask one conversation how it went.
 *
 * Returns rather than throws. This is called at the end of something that
 * has already succeeded — a conversation closed, a chatbot finished — and
 * a survey that could not be sent must never turn that into a failure.
 */
export async function requestFeedback(args: {
  accountId: string
  conversationId: string
  question?: string
}): Promise<FeedbackRequestOutcome> {
  const conversation = await prisma.conversation
    .findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
      select: { id: true, user_id: true, contact_id: true },
    })
    .catch(() => null)
  if (!conversation?.contact_id) return 'skipped_no_contact'

  const since = new Date(Date.now() - ASK_COOLDOWN_DAYS * 86_400_000)
  const recent = await prisma.conversationFeedback
    .findFirst({
      where: { conversation_id: conversation.id, asked_at: { gte: since } },
      select: { id: true },
    })
    .catch(() => null)
  if (recent) return 'skipped_recently_asked'

  try {
    await engineSendInteractiveButtons({
      accountId: args.accountId,
      userId: conversation.user_id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      bodyText: args.question ?? 'Before you go — how did we do?',
      footerText: 'One tap. It helps us get better.',
      buttons: CSAT_BUTTONS,
    })
  } catch (err) {
    console.warn(
      '[csat] could not send the question:',
      err instanceof Error ? err.message : err,
    )
    return 'failed'
  }

  // Written only after the question is actually on its way, so an
  // unanswered row always means "asked and ignored" rather than "we
  // meant to ask".
  await prisma.conversationFeedback
    .create({
      data: {
        account_id: args.accountId,
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
      },
    })
    .catch((err: unknown) => {
      console.warn(
        '[csat] question sent but not recorded:',
        err instanceof Error ? err.message : err,
      )
    })

  return 'sent'
}

/**
 * Store a rating the customer just tapped, and thank them.
 *
 * Only ever attaches to an ask that is still open. A tap with no open ask
 * is ignored, and that is a security decision rather than tidiness: a
 * survey button stays in the chat history forever, so anyone can scroll
 * back and tap it again — and again — and an implementation that wrote a
 * fresh row each time would let one determined customer flood the table
 * and set the account's satisfaction score to whatever they liked.
 *
 * One open ask, one rating. The cost is losing the occasional late tap on
 * an old survey, which is worth far less than a number nobody can trust.
 */
export async function recordFeedback(args: {
  accountId: string
  conversationId: string
  replyId: string
}): Promise<boolean> {
  const rating = ratingFromReplyId(args.replyId)
  if (rating === null) return false

  const conversation = await prisma.conversation
    .findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
      select: { id: true, user_id: true, contact_id: true },
    })
    .catch(() => null)
  if (!conversation) return false

  const open = await prisma.conversationFeedback
    .findFirst({
      where: { conversation_id: conversation.id, answered_at: null },
      orderBy: { asked_at: 'desc' },
      select: { id: true },
    })
    .catch(() => null)

  if (!open) {
    console.log(
      `[csat] ignoring a rating on ${conversation.id} with no open question — ` +
        'most likely an old survey tapped again.',
    )
    return false
  }

  try {
    // Conditional on still being unanswered, so two taps arriving at once
    // cannot both win. The second updates zero rows and is dropped.
    const claimed = await prisma.conversationFeedback.updateMany({
      where: { id: open.id, answered_at: null },
      data: { rating, answered_at: new Date() },
    })
    if (claimed.count === 0) return false
  } catch (err) {
    console.error('[csat] could not record the rating:', err instanceof Error ? err.message : err)
    return false
  }

  // A reply, because a tap that produces silence reads as a tap that did
  // not register. Different words for a bad score: thanking somebody for
  // telling you they are unhappy is the wrong note.
  const reply =
    rating <= 1
      ? 'Thank you for telling us. Someone will look at this.'
      : 'Thank you — that helps.'
  await engineSendText({
    accountId: args.accountId,
    userId: conversation.user_id,
    conversationId: conversation.id,
    contactId: conversation.contact_id!,
    text: reply,
  }).catch((err: unknown) => {
    console.warn('[csat] rating saved, acknowledgement not sent:', err)
  })

  return true
}
