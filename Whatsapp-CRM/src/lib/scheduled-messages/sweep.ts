import { prisma } from '@/lib/db'
import { engineSendText, engineSendMedia, engineSendInteractiveButtons } from '@/lib/flows/meta-send'
import type { MediaKind } from '@/lib/whatsapp/meta-api'

const INTERVAL_MS: Record<string, number> = {
  minutes: 60_000,
  hours: 60 * 60_000,
  days: 24 * 60 * 60_000,
}

// A 'once' message that's still sitting unsent this long past its
// scheduled time (e.g. the server was down) is stale enough that sending
// it late would likely be wrong/confusing -- mark it expired instead.
const EXPIRY_GRACE_MS = 24 * 60 * 60_000
// After this many consecutive send failures, stop retrying and surface it
// as 'failed' with the error, instead of silently retrying forever.
const MAX_ERROR_COUNT = 3

export interface SweepResult {
  sent: number
  skipped: number
  expired: number
  failed: number
  checked: number
}

/**
 * Sends every due ScheduledMessage row. Shared by both the internal
 * server.ts interval (the primary trigger -- runs every minute for as
 * long as the Node process is alive, no external cron needed) and the
 * `/api/scheduled-messages/cron` HTTP route (kept as a manual-trigger /
 * debug entry point, and for parity with the other cron endpoints on
 * deployments that prefer an external scheduler).
 */
export async function sweepScheduledMessages(): Promise<SweepResult> {
  const now = new Date()
  let sent = 0
  let skipped = 0
  let expired = 0
  let failed = 0

  const due = await prisma.scheduledMessage.findMany({
    where: { status: 'active', next_send_at: { lte: now } },
    take: 200, // safety cap per sweep -- a minute-interval catches up fast either way
  })

  for (const sm of due) {
    // A never-sent one-time message that's badly overdue -- expire it
    // rather than send a very-late reminder.
    if (
      sm.schedule_type === 'once' &&
      sm.sends_count === 0 &&
      now.getTime() - sm.next_send_at.getTime() > EXPIRY_GRACE_MS
    ) {
      await prisma.scheduledMessage.update({
        where: { id: sm.id },
        data: { status: 'expired' },
      })
      expired++
      continue
    }

    try {
      // Recurring + stop_on_reply: skip (and end) if the customer has
      // replied since the last send.
      if (sm.stop_on_reply && sm.last_sent_at) {
        const reply = await prisma.message.findFirst({
          where: {
            conversation_id: sm.conversation_id,
            sender_type: 'customer',
            created_at: { gt: sm.last_sent_at },
          },
          select: { id: true },
        })
        if (reply) {
          await prisma.scheduledMessage.update({
            where: { id: sm.id },
            data: { status: 'completed' },
          })
          skipped++
          continue
        }
      }

      const buttons = Array.isArray(sm.buttons) ? (sm.buttons as { id: string; title: string }[]) : null

      if (buttons && buttons.length > 0) {
        await engineSendInteractiveButtons({
          accountId: sm.account_id,
          userId: sm.created_by,
          conversationId: sm.conversation_id,
          contactId: sm.contact_id,
          bodyText: sm.content_text ?? '',
          buttons,
          headerMediaUrl: sm.media_url ?? undefined,
          headerMediaType: sm.media_url ? (sm.media_type as 'image' | 'video' | 'document' | undefined) : undefined,
        })
      } else if (sm.media_url) {
        await engineSendMedia({
          accountId: sm.account_id,
          userId: sm.created_by,
          conversationId: sm.conversation_id,
          contactId: sm.contact_id,
          kind: (sm.media_type as MediaKind | null) ?? 'image',
          link: sm.media_url,
          caption: sm.content_text ?? undefined,
        })
      } else {
        await engineSendText({
          accountId: sm.account_id,
          userId: sm.created_by,
          conversationId: sm.conversation_id,
          contactId: sm.contact_id,
          text: sm.content_text ?? '',
        })
      }

      const newSendsCount = sm.sends_count + 1
      const reachedMax = newSendsCount >= sm.max_sends
      const isDone = sm.schedule_type === 'once' || reachedMax

      await prisma.scheduledMessage.update({
        where: { id: sm.id },
        data: {
          sends_count: newSendsCount,
          last_sent_at: now,
          status: isDone ? 'completed' : 'active',
          error_message: null,
          error_count: 0,
          next_send_at: isDone
            ? sm.next_send_at
            : new Date(now.getTime() + (sm.interval_value ?? 1) * (INTERVAL_MS[sm.interval_unit ?? 'days'] ?? INTERVAL_MS.days)),
        },
      })
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const newErrorCount = sm.error_count + 1
      const giveUp = newErrorCount >= MAX_ERROR_COUNT
      console.error(`[scheduled-messages] send failed for ${sm.id} (attempt ${newErrorCount}/${MAX_ERROR_COUNT}):`, err)
      await prisma.scheduledMessage.update({
        where: { id: sm.id },
        data: {
          error_message: message,
          error_count: newErrorCount,
          status: giveUp ? 'failed' : 'active',
        },
      })
      failed++
    }
  }

  return { sent, skipped, expired, failed, checked: due.length }
}
