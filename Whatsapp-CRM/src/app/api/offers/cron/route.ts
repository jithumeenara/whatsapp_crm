import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { sweepStaleOffers } from '@/lib/agents/advance-offers'

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
 * the only trace is a conversation nobody claimed.
 *
 * server.ts now runs the same sweep every minute (sweepStaleOffers), so
 * this route is only a manual trigger. It used to compare a query-string
 * CRON_SECRET and let everyone through when that was unset; it now takes
 * the same x-cron-secret header as the other crons and refuses without it.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const want = Buffer.from(expected)
  if (supplied.length !== want.length || !timingSafeEqual(supplied, want)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await sweepStaleOffers())
  } catch (err) {
    console.error('[offers/cron] failed:', err instanceof Error ? err.message : err)
    // 200 with a body saying so: a scheduler that sees a 500 will often
    // retry hard, and hammering a database that is already unhappy is
    // not an improvement.
    return NextResponse.json({ ok: false, error: 'sweep failed' })
  }
}
