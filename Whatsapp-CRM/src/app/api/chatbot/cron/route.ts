import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { engineSendText } from '@/lib/flows/meta-send'

/**
 * Sweep chatbot sessions where the user hasn't replied within the
 * configured no_reply_delay_minutes. Sends the auto-end message (if set)
 * then marks the flow run as timed_out.
 *
 * Call this endpoint every minute via a cron job or external scheduler.
 * Auth: same AUTOMATION_CRON_SECRET as the flows cron.
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

  try {
    const now = new Date()

    // Load active chatbot runs with their parent flow's trigger_config
    const runs = await prisma.flowRun.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        account_id: true,
        user_id: true,
        contact_id: true,
        conversation_id: true,
        last_advanced_at: true,
        flow: {
          select: {
            flow_type: true,
            trigger_config: true,
          },
        },
      },
    })

    let swept = 0
    for (const run of runs) {
      // Only handle chatbots (not flows)
      if (run.flow?.flow_type !== 'chatbot') continue

      const cfg = run.flow.trigger_config as {
        no_reply_delay_enabled?: boolean
        no_reply_delay_minutes?: number
        no_reply_message?: string
      } | null

      if (!cfg?.no_reply_delay_enabled) continue

      const delayMinutes = cfg.no_reply_delay_minutes ?? 30
      const lastAdvanced = new Date(run.last_advanced_at)
      const ageMinutes = (now.getTime() - lastAdvanced.getTime()) / (1000 * 60)

      if (ageMinutes < delayMinutes) continue

      // Guard: only end if still active (race condition safety)
      const updated = await prisma.flowRun.updateMany({
        where: { id: run.id, status: 'active' },
        data: {
          status: 'timed_out',
          ended_at: now,
          end_reason: 'no_reply_timeout',
        },
      })

      if (updated.count === 0) continue

      // Send auto-end message if configured and conversation exists
      const message = cfg.no_reply_message?.trim()
      if (message && run.conversation_id && run.contact_id) {
        try {
          await engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id,
            contactId: run.contact_id,
            text: message,
          })
        } catch (err) {
          // Non-fatal — run is already ended, message failure is logged but doesn't block
          console.error(`[chatbot-cron] send auto-end message failed for run ${run.id}:`, err)
        }
      }

      console.log(`[chatbot-cron] ended run ${run.id} after ${Math.round(ageMinutes)}min of inactivity`)
      swept++
    }

    return NextResponse.json({ swept })
  } catch (err) {
    console.error('[chatbot-cron]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
