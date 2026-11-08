import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { loadBell } from '@/lib/notifications/bell'

/** The bell polls about once a minute per open tab; this leaves room for a few tabs. */
const LIMIT = { limit: 30, windowMs: 60_000 }

/**
 * GET /api/notifications/bell
 *
 * The caller's own waiting work as counts, for the bell in the menu.
 * Each item is left out when the person may not open the page behind it.
 */
export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    const rl = checkRateLimit(`bell:${ctx.userId}`, LIMIT)
    if (!rl.success) return rateLimitResponse(rl)
    const tz = await businessTimezone(ctx.accountId)
    const bell = await loadBell({ accountId: ctx.accountId, userId: ctx.userId, role: ctx.role, pageAccess: ctx.pageAccess, tz, now: new Date() })
    return NextResponse.json(bell, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not load notifications right now.' }, { status: 500 })
    return res
  }
}
