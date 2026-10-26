/**
 * The automatic side of broadcasts, run every minute by the broadcast
 * sweep (sweep.ts):
 *
 *   1. Automatic follow-ups (schedule_type 'after_parent') — once the
 *      first broadcast has finished and the wait has passed, the group it
 *      names is read *then*, and the follow-up is sent to it.
 *   2. Event-based broadcasts (schedule_type 'event') — the recipients
 *      whose wait is over are sent.
 *   3. Meta's per-person marketing limit (131049) — retried once, a day
 *      after it was hit, when the account allows it (settings.ts).
 *
 * Every start is claimed with a conditional update, so two sweeps (or a
 * slow one) never send the same thing twice. All three respect the
 * broadcast's send window in the business's time zone.
 */

import { prisma } from '@/lib/db'
import { runBroadcast } from './run-broadcast'
import { contactsInOutcome } from './outcome-audience'
import { isOutcome } from './outcomes'
import { liveSendableContactWhere } from './sendable'
import { followUpDue, inSendWindow } from './rules'
import { getBroadcastSettings } from './settings'
import { businessTimezone } from '@/lib/ai/human-date'
import { minutesNowIn } from '@/lib/agents/working-hours'

const BATCH = 25

async function windowOpen(accountId: string, window: string | null, now: Date): Promise<boolean> {
  if (!window) return true
  return inSendWindow(window, minutesNowIn(await businessTimezone(accountId), now))
}

function start(broadcastId: string, accountId: string, onError: string) {
  runBroadcast(broadcastId, accountId).catch(async (err) => {
    console.error(`[broadcasts/auto] ${broadcastId} failed:`, err)
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: onError } }).catch(() => {})
  })
}

export async function sweepFollowUps(now: Date = new Date()): Promise<number> {
  const waiting = await prisma.broadcast.findMany({
    where: { status: 'waiting', schedule_type: 'after_parent' },
    select: {
      id: true, account_id: true, parent_broadcast_id: true, parent_outcome: true,
      follow_up_delay_minutes: true, send_window: true,
      parent: { select: { status: true, finished_at: true, account_id: true } },
    },
    take: BATCH,
  })
  let started = 0
  for (const f of waiting) {
    const parent = f.parent && f.parent.account_id === f.account_id ? f.parent : null
    const due = followUpDue(parent, f.follow_up_delay_minutes ?? 0, now)
    if (due === 'cancel' || !isOutcome(f.parent_outcome) || !f.parent_broadcast_id) {
      await prisma.broadcast.updateMany({ where: { id: f.id, status: 'waiting' }, data: { status: 'cancelled' } })
      continue
    }
    if (due === 'wait' || !(await windowOpen(f.account_id, f.send_window, now))) continue

    const claimed = await prisma.broadcast.updateMany({ where: { id: f.id, status: 'waiting' }, data: { status: 'sending' } })
    if (claimed.count === 0) continue

    // The group as it is now — people who replied since are no longer in
    // "Read, no reply".
    const ids = (await contactsInOutcome(prisma, f.account_id, f.parent_broadcast_id, f.parent_outcome)) ?? []
    const contacts = ids.length
      ? await prisma.contact.findMany({ where: { AND: [liveSendableContactWhere(f.account_id), { id: { in: ids } }] }, select: { id: true } })
      : []
    if (contacts.length > 0) {
      for (let i = 0; i < contacts.length; i += 500) {
        await prisma.broadcastRecipient.createMany({
          data: contacts.slice(i, i + 500).map((c) => ({ broadcast_id: f.id, contact_id: c.id, status: 'pending' })),
        })
      }
    }
    await prisma.broadcast.update({ where: { id: f.id }, data: { total_recipients: contacts.length, scheduled_at: now } })
    if (contacts.length === 0) {
      await prisma.broadcast.update({ where: { id: f.id }, data: { status: 'sent', finished_at: now } })
      continue
    }
    started++
    start(f.id, f.account_id, 'failed')
  }
  return started
}

export async function sweepEventBroadcasts(now: Date = new Date()): Promise<number> {
  const due = await prisma.broadcast.findMany({
    where: {
      status: 'active',
      schedule_type: 'event',
      recipients: { some: { status: 'pending', OR: [{ send_after: null }, { send_after: { lte: now } }] } },
    },
    select: { id: true, account_id: true, send_window: true },
    take: BATCH,
  })
  let started = 0
  for (const b of due) {
    if (!(await windowOpen(b.account_id, b.send_window, now))) continue
    const claimed = await prisma.broadcast.updateMany({ where: { id: b.id, status: 'active' }, data: { status: 'sending' } })
    if (claimed.count === 0) continue
    started++
    start(b.id, b.account_id, 'failed')
  }
  return started
}

const DAY = 86_400_000

export async function sweepDailyLimitRetries(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DAY)
  const oldest = new Date(now.getTime() - 7 * DAY)
  const rows = await prisma.broadcastRecipient.findMany({
    where: {
      status: 'failed',
      auto_retried_at: null,
      error_message: { contains: '(code 131049)' },
      OR: [
        { sent_at: { lte: cutoff, gte: oldest } },
        { sent_at: null, broadcast: { finished_at: { lte: cutoff, gte: oldest } } },
      ],
      broadcast: { status: { in: ['sent', 'failed', 'active'] } },
    },
    select: { id: true, broadcast_id: true, broadcast: { select: { account_id: true, status: true, send_window: true } } },
    take: 2000,
  })
  const byBroadcast = new Map<string, { accountId: string; status: string; window: string | null; ids: string[] }>()
  for (const r of rows) {
    const g = byBroadcast.get(r.broadcast_id) ?? { accountId: r.broadcast.account_id, status: r.broadcast.status, window: r.broadcast.send_window, ids: [] }
    g.ids.push(r.id)
    byBroadcast.set(r.broadcast_id, g)
  }

  let started = 0
  const allowed = new Map<string, boolean>()
  for (const [broadcastId, g] of byBroadcast) {
    if (!allowed.has(g.accountId)) allowed.set(g.accountId, (await getBroadcastSettings(g.accountId)).auto_retry_daily_limit)
    if (!allowed.get(g.accountId)) continue
    if (!(await windowOpen(g.accountId, g.window, now))) continue
    const claimed = await prisma.broadcast.updateMany({ where: { id: broadcastId, status: g.status }, data: { status: 'sending' } })
    if (claimed.count === 0) continue
    await prisma.broadcastRecipient.updateMany({
      where: { id: { in: g.ids }, status: 'failed', auto_retried_at: null },
      data: { status: 'pending', auto_retried_at: now, error_message: null, send_after: null },
    })
    started++
    start(broadcastId, g.accountId, g.status === 'active' ? 'active' : 'failed')
  }
  return started
}

/** All three, each failing on its own without stopping the others. */
export async function sweepAutomaticBroadcasts(): Promise<void> {
  for (const [name, fn] of [
    ['follow-ups', sweepFollowUps],
    ['events', sweepEventBroadcasts],
    ['daily-limit retries', sweepDailyLimitRetries],
  ] as const) {
    try {
      await fn()
    } catch (err) {
      console.error(`[broadcasts/auto] ${name} sweep failed:`, err instanceof Error ? err.message : err)
    }
  }
}
