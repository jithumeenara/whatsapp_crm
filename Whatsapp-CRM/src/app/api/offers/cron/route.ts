import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { advanceStaleOffers } from '@/lib/agents/advance-offers'
import { isExpired } from '@/lib/agents/offer'

/**
 * GET /api/offers/cron
 *
 * Move every stalled offer along, on every account.
 *
 * ── Why this exists when two other things already do it ─────────────
 *
 * An agent's browser advances the rotation when it asks what it has
 * been offered, and an inbound message advances it too. Between them
 * they cover every case where somebody is there — which is precisely
 * not the case that matters.
 *
 * The offer that goes unanswered at ten at night is the one where the
 * rotation runs out, the customer needs telling, and a callback needs
 * scheduling. If nothing runs, none of that happens: the customer is
 * left mid-conversation, the follow-up is never created, and by morning
 * the only trace is a conversation nobody claimed. So the case with
 * nobody watching gets its own trigger.
 *
 * ── Why it does nothing when there is nothing to do ─────────────────
 *
 * Called on a schedule, so it runs mostly at times when every offer is
 * either live or answered. It looks for ripe ones first and returns
 * without touching an account that has none, rather than sweeping every
 * account on the instance every minute.
 */
export async function GET(req: NextRequest) {
  // Same shape as the other cron routes on this app: a shared secret in
  // the query, because these are called by an external scheduler that
  // cannot sign a session.
  const secret = new URL(req.url).searchParams.get('secret')
  const expected = process.env.CRON_SECRET
  if (expected && secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()

    // Only accounts with an offer that has actually run out. Cheap, and
    // it keeps a quiet minute genuinely quiet.
    const pending = await prisma.conversationOffer.findMany({
      where: { status: 'pending' },
      select: { account_id: true, offered_at: true, window_seconds: true },
      take: 500,
    })

    const accountIds = [
      ...new Set(
        pending
          .filter((o) => isExpired(o.offered_at, o.window_seconds, now))
          .map((o) => o.account_id),
      ),
    ]

    let advanced = 0
    let exhausted = 0
    for (const accountId of accountIds) {
      const result = await advanceStaleOffers(accountId).catch(() => null)
      if (!result) continue
      advanced += result.advanced
      exhausted += result.exhausted.length
    }

    return NextResponse.json({ accounts: accountIds.length, advanced, exhausted })
  } catch (err) {
    console.error('[offers/cron] failed:', err instanceof Error ? err.message : err)
    // 200 with a body saying so: a scheduler that sees a 500 will often
    // retry hard, and hammering a database that is already unhappy is
    // not an improvement.
    return NextResponse.json({ ok: false, error: 'sweep failed' })
  }
}
