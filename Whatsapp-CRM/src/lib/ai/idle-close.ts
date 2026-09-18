/**
 * Closing a chat the customer has walked away from.
 *
 * ── What this is for ────────────────────────────────────────────────
 *
 * The assistant answers, the customer reads it and gets on with their
 * day, and the conversation stays Open forever. Nobody owes anybody
 * anything, but it sits in the Inbox looking like work — and once there
 * are two hundred of them, "Open" has stopped meaning anything and the
 * three threads that genuinely need a person are lost among them.
 *
 * ── What it must never do ───────────────────────────────────────────
 *
 * Everything difficult here is in the *not* closing. An auto-close that
 * is slightly too eager does not annoy anybody; it hides a customer who
 * was waiting for an answer, and nobody finds out. So three rules, each
 * of which excludes a case that looks idle and is not:
 *
 *   - **Pending is never touched.** That is where a handover leaves a
 *     conversation. It means a person here still owes the customer a
 *     reply, and it is silent precisely because that reply has not
 *     happened yet. This is the single most important exclusion in the
 *     file: Pending threads are the ones most likely to look abandoned
 *     and least safe to close.
 *   - **An assigned conversation is never touched.** Somebody has it,
 *     whatever its status says.
 *   - **A conversation whose last message came from the customer is
 *     never touched.** They asked something and got nothing back.
 *     Closing that would file a failure as if it were a finished chat.
 *
 * What is left is exactly the intended case: we spoke last, nobody
 * replied, nobody is on it.
 *
 * ── The last word ───────────────────────────────────────────────────
 *
 * The goodbye message is optional and off unless an account writes one,
 * because most of these conversations ended because the customer was
 * satisfied — and telling somebody you are closing a chat they consider
 * finished is a notification they did not ask for. When it is set it is
 * only sent inside Meta's 24-hour service window; outside it a free-form
 * message is neither delivered nor rejected, so sending one would look
 * like it worked.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { engineSendText } from '@/lib/flows/meta-send'

/** Meta's service window, measured from the customer's own last
 *  message. Outside it, only a template is deliverable. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Bounds one sweep. A backlog is worked through over several ticks
 *  rather than in one burst that could hold a connection for minutes. */
const MAX_PER_ACCOUNT = 200

export interface IdleCloseResult {
  accountsChecked: number
  closed: number
  messaged: number
}

/**
 * Runs one pass over every account that has asked for this.
 *
 * Never throws: it runs on a timer in the same process that serves
 * WhatsApp, and a bad tick must cost a log line rather than the server.
 */
export async function sweepIdleConversations(): Promise<IdleCloseResult> {
  const result: IdleCloseResult = { accountsChecked: 0, closed: 0, messaged: 0 }

  let configs: Array<{
    account_id: string
    user_id: string
    idle_close_after_minutes: number
    idle_close_message: string | null
  }>
  try {
    configs = await prisma.aiConfig.findMany({
      where: { idle_close_enabled: true },
      select: {
        account_id: true,
        user_id: true,
        idle_close_after_minutes: true,
        idle_close_message: true,
      },
    })
  } catch (err) {
    console.error('[idle-close] could not read settings:', err instanceof Error ? err.message : err)
    return result
  }

  for (const config of configs) {
    result.accountsChecked += 1
    try {
      const closed = await closeForAccount(config)
      result.closed += closed.closed
      result.messaged += closed.messaged
    } catch (err) {
      // One account's failure must not stop the others.
      console.error(
        '[idle-close] account',
        config.account_id,
        'failed:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  if (result.closed > 0) {
    console.log(`[idle-close] closed ${result.closed} conversation(s), ${result.messaged} told`)
  }
  return result
}

async function closeForAccount(config: {
  account_id: string
  user_id: string
  idle_close_after_minutes: number
  idle_close_message: string | null
}): Promise<{ closed: number; messaged: number }> {
  const cutoff = new Date(Date.now() - config.idle_close_after_minutes * 60_000)

  const candidates = await prisma.conversation.findMany({
    where: {
      account_id: config.account_id,
      // Open only. Pending means a person still owes an answer — see
      // this file's header for why that exclusion is the important one.
      status: 'open',
      assigned_agent_id: null,
      last_message_at: { lt: cutoff },
    },
    select: { id: true, contact_id: true },
    orderBy: { last_message_at: 'asc' },
    take: MAX_PER_ACCOUNT,
  })
  if (candidates.length === 0) return { closed: 0, messaged: 0 }

  // Every id cast, one by one.
  //
  // Joining them as bare parameters sends text, and
  // messages.conversation_id is uuid — Postgres has no uuid = text
  // operator, so the whole query failed with 42883 on every tick and
  // the sweep silently did nothing, saying so only in the error log.
  // Found live, five minutes at a time.
  //
  // Casting the column instead would also work, and would give up the
  // index — the wrong trade on a messages table.
  const ids = Prisma.join(candidates.map((c) => Prisma.sql`${c.id}::uuid`))

  // Who spoke last, and when the customer last did — two facts, two
  // queries, rather than one query per conversation. DISTINCT ON is
  // Postgres's own idiom for "the newest row per group" and this app is
  // Postgres-only.
  const lastSpeakers = await prisma.$queryRaw<Array<{ conversation_id: string; sender_type: string }>>(
    Prisma.sql`
      SELECT DISTINCT ON (conversation_id) conversation_id, sender_type
      FROM messages
      WHERE conversation_id IN (${ids})
      ORDER BY conversation_id, created_at DESC
    `,
  )
  const lastSpeakerBy = new Map(lastSpeakers.map((r) => [r.conversation_id, r.sender_type]))

  const lastCustomer = await prisma.$queryRaw<Array<{ conversation_id: string; at: Date }>>(
    Prisma.sql`
      SELECT conversation_id, MAX(created_at) AS at
      FROM messages
      WHERE conversation_id IN (${ids}) AND sender_type = 'customer'
      GROUP BY conversation_id
    `,
  )
  const lastCustomerBy = new Map(lastCustomer.map((r) => [r.conversation_id, r.at]))

  const goodbye = config.idle_close_message?.trim() || null
  let closed = 0
  let messaged = 0

  for (const conversation of candidates) {
    const lastSpeaker = lastSpeakerBy.get(conversation.id)

    // No messages at all, or the customer spoke last. The first is an
    // empty row worth nothing; the second is somebody waiting.
    if (!lastSpeaker || lastSpeaker === 'customer') continue

    // Said before the status changes, so a reply that races it lands in
    // a conversation that is still open rather than one already filed.
    if (goodbye && conversation.contact_id) {
      const customerAt = lastCustomerBy.get(conversation.id)
      const windowOpen = customerAt ? Date.now() - customerAt.getTime() < SERVICE_WINDOW_MS : false
      if (windowOpen) {
        try {
          await engineSendText({
            accountId: config.account_id,
            userId: config.user_id,
            conversationId: conversation.id,
            contactId: conversation.contact_id,
            text: goodbye,
          })
          messaged += 1
        } catch (err) {
          // The close still happens. A goodbye that could not be
          // delivered is not a reason to leave the thread open forever.
          console.error(
            '[idle-close] goodbye failed for',
            conversation.id,
            '—',
            err instanceof Error ? err.message : err,
          )
        }
      }
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'closed' },
    })

    // A line on the thread, so somebody opening it later can see this
    // was closed by a rule rather than by a colleague who forgot to say
    // anything.
    await prisma.message
      .create({
        data: {
          conversation_id: conversation.id,
          sender_type: 'system',
          content_type: 'text',
          content_text: `Closed automatically — no reply from the customer for ${describeMinutes(config.idle_close_after_minutes)}. It reopens on its own if they write again.`,
          status: 'sent',
        },
      })
      .catch(() => {})

    closed += 1

    try {
      const { emitToAccount } = await import('@/lib/socket')
      emitToAccount(config.account_id, 'conversation', {
        eventType: 'UPDATE',
        new: { id: conversation.id, status: 'closed' },
        old: {},
      })
    } catch {
      // The Inbox refreshes on its own; a missed socket event costs a
      // stale tab, not a wrong database.
    }
  }

  return { closed, messaged }
}

/** "90 minutes" is worse than "an hour and a half", and "2880 minutes"
 *  is worse than "2 days". This note is read by a person. */
export function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  if (minutes < 60 * 24) {
    const hours = minutes / 60
    const rounded = Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10
    return `${rounded} hour${rounded === 1 ? '' : 's'}`
  }
  const days = minutes / (60 * 24)
  const rounded = Number.isInteger(days) ? days : Math.round(days * 10) / 10
  return `${rounded} day${rounded === 1 ? '' : 's'}`
}
