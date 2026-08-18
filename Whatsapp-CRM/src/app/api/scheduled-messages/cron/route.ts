import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { engineSendText, engineSendMedia, engineSendInteractiveButtons } from '@/lib/flows/meta-send'
import type { MediaKind } from '@/lib/whatsapp/meta-api'

// See chatbot/cron/route.ts for why this is needed -- reading
// `request.headers` directly doesn't count as a Next.js "dynamic" signal,
// so this route could otherwise get statically cached and freeze on its
// first response.
export const dynamic = 'force-dynamic'

const INTERVAL_MS: Record<string, number> = {
  minutes: 60_000,
  hours: 60 * 60_000,
  days: 24 * 60 * 60_000,
}

/**
 * Sweep due ScheduledMessage rows and send them. Call every minute via
 * cron, same secret as the other cron endpoints.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let sent = 0
  let skipped = 0
  let failed = 0

  try {
    const due = await prisma.scheduledMessage.findMany({
      where: { status: 'active', next_send_at: { lte: now } },
      take: 200, // safety cap per sweep -- a minute-cron catches up fast either way
    })

    for (const sm of due) {
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
            next_send_at: isDone
              ? sm.next_send_at
              : new Date(now.getTime() + (sm.interval_value ?? 1) * (INTERVAL_MS[sm.interval_unit ?? 'days'] ?? INTERVAL_MS.days)),
          },
        })
        sent++
      } catch (err) {
        console.error(`[scheduled-messages/cron] send failed for ${sm.id}:`, err)
        failed++
      }
    }

    return NextResponse.json({ sent, skipped, failed, checked: due.length })
  } catch (err) {
    console.error('[scheduled-messages/cron]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
