import { prisma } from '@/lib/db'
import { runBroadcast } from '@/lib/broadcasts/run-broadcast'

const INTERVAL_MS: Record<string, number> = {
  minutes: 60_000,
  hours: 60 * 60_000,
  days: 24 * 60 * 60_000,
}

export interface BroadcastSweepResult {
  started: number
  checked: number
}

/**
 * Kicks off every due scheduled/recurring Broadcast row. Shared by both the
 * internal server.ts interval (the primary trigger -- runs every minute for
 * as long as the Node process is alive) and any future manual-trigger route,
 * mirroring src/lib/scheduled-messages/sweep.ts's shape.
 *
 * Unlike that sweep, sending itself is NOT awaited here -- runBroadcast is
 * the same long-running, per-recipient-paced loop the immediate-send path
 * (`POST /api/broadcasts/[id]/process`) already fires with setImmediate, so
 * this function only *starts* each due broadcast and returns; the send
 * itself, and the bookkeeping for what happens after it finishes (advance
 * to the next cycle, or finish for good), happens in the .then() below.
 */
export async function sweepScheduledBroadcasts(): Promise<BroadcastSweepResult> {
  const now = new Date()
  let started = 0

  const due = await prisma.broadcast.findMany({
    where: { status: 'scheduled', next_send_at: { lte: now } },
    take: 50, // safety cap per sweep -- a minute-interval catches up fast either way
  })

  for (const b of due) {
    // Atomic claim so a slow-ticking sweep never double-fires the same row.
    const claimed = await prisma.broadcast.updateMany({
      where: { id: b.id, status: 'scheduled' },
      data: { status: 'sending' },
    })
    if (claimed.count === 0) continue

    // A recurring broadcast's 2nd+ cycle reuses the same BroadcastRecipient
    // rows from the first cycle (materialized once at creation, same as the
    // one-time-send path) -- runBroadcast only ever sends to rows still
    // "pending", so every recipient needs resetting back to pending (and
    // the campaign's own rolled-up counters back to 0) before each re-run.
    if (b.sends_count > 0) {
      await prisma.broadcastRecipient.updateMany({
        where: { broadcast_id: b.id },
        data: {
          status: 'pending',
          sent_at: null,
          delivered_at: null,
          read_at: null,
          replied_at: null,
          error_message: null,
          whatsapp_message_id: null,
          rendered_body: null,
        },
      })
      await prisma.broadcast.update({
        where: { id: b.id },
        data: { sent_count: 0, delivered_count: 0, read_count: 0, replied_count: 0, failed_count: 0 },
      })
    }

    started++
    runBroadcast(b.id, b.account_id)
      .then(() => advanceAfterRun(b.id))
      .catch(async (err) => {
        console.error(`[broadcasts/sweep] fatal error running ${b.id}:`, err)
        await prisma.broadcast.update({ where: { id: b.id }, data: { status: 'failed' } }).catch(() => {})
      })
  }

  return { started, checked: due.length }
}

/**
 * runBroadcast already sets status to 'sent'/'failed'/'cancelled' once the
 * loop finishes. For a recurring campaign that hasn't hit max_sends yet
 * (and wasn't cancelled), this flips it back to 'scheduled' with the next
 * cycle's next_send_at -- otherwise (one-time, or a recurring campaign's
 * final cycle) the status runBroadcast already wrote is left as-is.
 */
async function advanceAfterRun(broadcastId: string) {
  const b = await prisma.broadcast.findFirst({
    where: { id: broadcastId },
    select: { status: true, schedule_type: true, sends_count: true, max_sends: true, interval_value: true, interval_unit: true },
  })
  if (!b || b.status === 'cancelled') return

  const newSendsCount = b.sends_count + 1
  const reachedMax = newSendsCount >= b.max_sends
  const isRecurring = b.schedule_type === 'recurring'
  const now = new Date()

  if (isRecurring && !reachedMax && b.status !== 'failed') {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        sends_count: newSendsCount,
        last_sent_at: now,
        status: 'scheduled',
        next_send_at: new Date(now.getTime() + (b.interval_value ?? 1) * (INTERVAL_MS[b.interval_unit ?? 'days'] ?? INTERVAL_MS.days)),
      },
    })
  } else {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { sends_count: newSendsCount, last_sent_at: now },
    })
  }
}
