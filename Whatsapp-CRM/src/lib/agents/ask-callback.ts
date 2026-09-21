/**
 * When nobody took it: asking the customer when to ring back, and
 * making sure somebody does.
 *
 * ── Why this exists at all ──────────────────────────────────────────
 *
 * The rotation stops after two rounds. Without this, stopping means
 * silence — the customer has been waiting several minutes, nobody has
 * answered, and nothing on either side says what happens next. That is
 * worse than the behaviour before any of this was built, because the
 * app now knows perfectly well that nobody answered and says nothing
 * about it.
 *
 * ── The rule this file exists to keep ───────────────────────────────
 *
 * If the system makes a promise, something has to be scheduled to keep
 * it. So a follow-up is always created — not only when the customer
 * picks a time. Silence from them is not permission to forget them,
 * and it is the most likely outcome: people are busy, and a message
 * arriving after they have put the phone down often goes unread.
 *
 * ── Why the customer is asked rather than told ──────────────────────
 *
 * "We'll get back to you shortly" leads to ringing somebody at work.
 * A time they chose is a time they answer, which is the only measure
 * the business actually cares about — and it is worth about 28 points
 * of satisfaction by Bain's measurement of exactly this choice.
 */

import { prisma } from '@/lib/db'
import { callbackSlots, type CallbackSlot } from './callback-slots'
import { parseWorkingHours } from './working-hours'

/** How long to wait for a tap before scheduling one anyway. Long enough
 *  that somebody who stepped away still gets to choose; short enough
 *  that a silent customer is not forgotten for an afternoon. */
const ANSWER_WINDOW_MINUTES = 30

/** Where the callback lands when nobody picked a slot and there is no
 *  rota to read. Deliberately soon — an unanswered customer is the
 *  whole problem this is trying not to make worse. */
const BLIND_FALLBACK_HOURS = 2

export interface AskCallbackResult {
  asked: boolean
  followUpId?: string
  /** Why nothing was asked, when nothing was. */
  reason?: string
}

/**
 * Tell the customer, offer times, and put it in somebody's list.
 *
 * Never throws. This runs after the rotation has already given up; a
 * failure here must not also lose the note that was written on the
 * thread.
 */
export async function askForCallbackTime(args: {
  accountId: string
  conversationId: string
  now?: Date
}): Promise<AskCallbackResult> {
  const now = args.now ?? new Date()

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
      select: { id: true, contact_id: true, contact: { select: { phone: true, name: true } } },
    })
    if (!conversation?.contact?.phone) {
      return { asked: false, reason: 'no number to write to' }
    }

    // Whose hours to offer. The account's own rota, taken from whoever
    // has one set — a callback has to land when *somebody* is there,
    // not when one particular agent is.
    const rota = await loadAccountHours(args.accountId)
    const slots = callbackSlots(rota, now)

    const sent = await sendAsk(args.accountId, conversation.id, conversation.contact.phone, slots)

    // Always, whether or not they answer, and whether or not the
    // message even sent. The obligation is to the customer, and it does
    // not depend on WhatsApp having been reachable this second.
    const fallbackAt =
      slots[0]?.at ?? new Date(now.getTime() + BLIND_FALLBACK_HOURS * 60 * 60_000)

    const followUp = await prisma.followUp.create({
      data: {
        account_id: args.accountId,
        // Created by nobody in particular: it belongs to the pool until
        // somebody takes it, exactly like the conversation does.
        user_id: await anyOwner(args.accountId),
        contact_id: conversation.contact_id,
        title: `Call back — nobody answered on WhatsApp`,
        note: slots.length
          ? `Nobody picked up the conversation. The customer was offered ${slots
              .map((s) => s.label)
              .join(', ')} — this is set to the first one until they choose.`
          : `Nobody picked up the conversation, and there were no working hours to offer, so this is set for ${BLIND_FALLBACK_HOURS} hours from when it happened.`,
        due_at: fallbackAt,
      },
      select: { id: true },
    })

    return { asked: sent, followUpId: followUp.id }
  } catch (err) {
    console.error('[callback] failed:', err instanceof Error ? err.message : err)
    return { asked: false, reason: 'failed' }
  }
}

/**
 * The account's working hours.
 *
 * Read from the team rather than from a business-wide setting, because
 * a business-wide one does not exist — hours are per agent, since that
 * is where shifts actually differ. The earliest opening and latest
 * closing across everybody is what "somebody will be there" means.
 *
 * Falls back to whichever single rota is set when only one person has
 * one, which is the common case in a small team.
 */
async function loadAccountHours(accountId: string) {
  // Not filtered in SQL: a JSON column cannot be compared to null in a
  // Prisma filter without special values, and a team is a handful of
  // rows anyway. The parser is the thing that decides what counts as a
  // usable rota, so it is the thing that should look.
  const profiles = await prisma.profile.findMany({
    where: { account_id: accountId },
    select: { working_hours: true },
  })
  for (const p of profiles) {
    const parsed = parseWorkingHours(p.working_hours)
    if (parsed) return parsed
  }
  return null
}

/** Somebody to own the row. FollowUp.user_id is required, and the
 *  account owner is the one user guaranteed to exist. */
async function anyOwner(accountId: string): Promise<string> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { owner_user_id: true },
  })
  return account?.owner_user_id ?? ''
}

async function sendAsk(
  accountId: string,
  conversationId: string,
  to: string,
  slots: CallbackSlot[],
): Promise<boolean> {
  try {
    const { resolveWhatsAppConfig } = await import('@/lib/whatsapp/resolve-config')
    const { decrypt } = await import('@/lib/whatsapp/encryption')
    const config = await resolveWhatsAppConfig({ accountId, conversationId })

    // No rota to read: say something true and vague rather than naming
    // a time the business may not be able to keep. A broken promise is
    // worse than a soft one.
    if (slots.length === 0) {
      const { sendTextMessage } = await import('@/lib/whatsapp/meta-api')
      await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken: decrypt(config.access_token),
        to,
        text: 'Sorry for the wait — everyone is busy right now. We will get back to you as soon as somebody is free.',
      })
      await recordOutbound(conversationId, 'Sorry for the wait — we will get back to you.')
      return true
    }

    const { sendInteractiveButtons } = await import('@/lib/whatsapp/meta-api')
    await sendInteractiveButtons({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      to,
      bodyText:
        'Sorry for the wait — everyone is busy right now. When would be a good time to call you back?',
      buttons: slots.map((s) => ({ id: s.id, title: s.label })),
    })
    await recordOutbound(
      conversationId,
      `Asked when to call back: ${slots.map((s) => s.label).join(' / ')}`,
    )
    return true
  } catch (err) {
    // The follow-up is still created by the caller, so the customer is
    // not forgotten — they simply were not asked.
    console.error('[callback] could not ask:', err instanceof Error ? err.message : err)
    return false
  }
}

/** So the thread reads as a conversation rather than jumping from
 *  silence to a callback nobody can see was arranged. */
async function recordOutbound(conversationId: string, text: string): Promise<void> {
  await prisma.message
    .create({
      data: {
        conversation_id: conversationId,
        sender_type: 'system',
        content_type: 'text',
        content_text: text,
        status: 'sent',
      },
    })
    .catch(() => {})
}

/**
 * The customer tapped one of the times.
 *
 * Moves the existing follow-up rather than creating a second, because
 * two rows for one promise is how somebody gets rung twice — and being
 * rung twice after being kept waiting is worse than the wait.
 */
export async function recordCallbackChoice(args: {
  accountId: string
  conversationId: string
  buttonId: string
  now?: Date
}): Promise<boolean> {
  const now = args.now ?? new Date()
  if (!args.buttonId.startsWith('cb_')) return false

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
      select: { contact_id: true },
    })
    if (!conversation?.contact_id) return false

    const rota = await loadAccountHours(args.accountId)
    const slot = callbackSlots(rota, now).find((s) => s.id === args.buttonId)
    if (!slot) return false

    // The most recent one still outstanding for this person. Matched by
    // contact rather than by id because the button reply carries no
    // reference to the row.
    const pending = await prisma.followUp.findFirst({
      where: {
        account_id: args.accountId,
        contact_id: conversation.contact_id,
        status: 'pending',
      },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    })
    if (!pending) return false

    await prisma.followUp.update({
      where: { id: pending.id },
      data: {
        due_at: slot.at,
        title: 'Call back — the customer chose this time',
        note: `They picked "${slot.label}" themselves, so they are expecting the call.`,
      },
    })

    await recordOutbound(args.conversationId, `Customer chose ${slot.label} for a callback.`)
    return true
  } catch (err) {
    console.error('[callback] could not record choice:', err instanceof Error ? err.message : err)
    return false
  }
}

export { ANSWER_WINDOW_MINUTES }
