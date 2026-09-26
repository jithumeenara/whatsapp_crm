/**
 * Sending an email from a conversation — the one place that decides the
 * subject and whether it is a reply.
 *
 *  - reply (default): answers the customer's latest email, or the one
 *    chosen. The subject is "Re: <theirs>" and, with a Microsoft mailbox,
 *    it goes out in that email's own thread, so it lands under the
 *    customer's message in their mail app as well as ours.
 *  - new: a fresh email with a subject of its own, not threaded — for
 *    starting a different topic with the same person, as HubSpot, Front
 *    and respond.io all offer beside Reply.
 *
 * The subject is user-supplied text going into an email header, so line
 * breaks are removed and its length capped.
 */

import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/messaging/channels/email'

export type EmailMode = 'reply' | 'new'

const MAX_SUBJECT = 250

/** One line, no control characters, capped — safe as a header value. */
export function cleanSubject(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT)
}

/** "Re: Re: FW: Admission" → "Admission". */
export function baseSubject(subject: string): string {
  let s = subject.trim()
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|wg)\s*:\s*/i, '')
    if (next === s) return s
    s = next
  }
}

export function replySubject(original: string | null | undefined): string | null {
  const base = original ? baseSubject(cleanSubject(original)) : ''
  return base ? `Re: ${base}` : null
}

export async function sendConversationEmail(args: {
  accountId: string
  conversationId: string
  to: string
  text: string
  mode?: EmailMode
  subject?: string | null
  /** Our id of the customer's email being answered; the latest if absent. */
  replyToMessageId?: string | null
}): Promise<{ messageId: string; subject: string }> {
  const mode: EmailMode = args.mode === 'new' ? 'new' : 'reply'
  const given = cleanSubject(args.subject)

  if (mode === 'new') {
    if (!given) throw new Error('A new email needs a subject')
    const { messageId } = await sendEmail({ accountId: args.accountId, to: args.to, subject: given, text: args.text })
    return { messageId, subject: given }
  }

  const target = await prisma.message.findFirst({
    where: {
      conversation_id: args.conversationId,
      sender_type: 'customer',
      ...(args.replyToMessageId ? { id: args.replyToMessageId } : {}),
    },
    orderBy: { created_at: 'desc' },
    select: { email_subject: true, message_id: true },
  })
  // With nothing of theirs to answer, the thread's latest subject of ours.
  const lastOurs = target
    ? null
    : await prisma.message.findFirst({
        where: { conversation_id: args.conversationId, email_subject: { not: null } },
        orderBy: { created_at: 'desc' },
        select: { email_subject: true },
      })

  const subject =
    given ||
    replySubject(target?.email_subject ?? lastOurs?.email_subject) ||
    cleanSubject(args.text.slice(0, 60)) ||
    'Message'

  const { messageId } = await sendEmail({
    accountId: args.accountId,
    to: args.to,
    subject,
    text: args.text,
    inReplyTo: target?.message_id ?? null,
  })
  return { messageId, subject }
}
