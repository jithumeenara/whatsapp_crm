import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { loadMyTasks, MAX_ITEMS, MAX_ITEMS_ONE_GROUP } from '@/lib/leads/my-tasks'
import type { MyTasks } from '@/lib/dashboard/owner-types'

const LIMIT = { limit: 60, windowMs: 60_000 }
const GROUPS = ['all', 'overdue', 'today', 'new'] as const
type Group = (typeof GROUPS)[number]

/**
 * GET /api/my-tasks?group=all|overdue|today|new&limit=50
 *
 * The caller's own Task list, never anybody else's. `group` decides which
 * lists carry items; the counts are always there.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    assertPageAccess(ctx, '/leads')
    const rl = checkRateLimit(`my-tasks:${ctx.userId}`, LIMIT)
    if (!rl.success) return rateLimitResponse(rl)

    const q = req.nextUrl.searchParams
    const group = (q.get('group') ?? 'all') as Group
    if (!GROUPS.includes(group)) return NextResponse.json({ error: 'Choose all, overdue, today or new.' }, { status: 400 })
    const asked = parseInt(q.get('limit') ?? '', 10)
    // The limit is per list: group=all may return up to 3x the limit (3 x 50),
    // while one list asked for alone may be pulled 200 at a time ("show more").
    const cap = group === 'all' ? MAX_ITEMS : MAX_ITEMS_ONE_GROUP
    const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), cap) : MAX_ITEMS

    const tz = await businessTimezone(ctx.accountId)
    const t = await loadMyTasks({ accountId: ctx.accountId, userId: ctx.userId, tz, now: new Date(), limit, cap, only: group === 'all' ? undefined : group })
    const tasks: MyTasks = {
      ...t,
      overdue: group === 'all' || group === 'overdue' ? t.overdue : { ...t.overdue, items: [] },
      dueToday: group === 'all' || group === 'today' ? t.dueToday : { ...t.dueToday, items: [] },
      newLeads: group === 'all' || group === 'new' ? t.newLeads : { ...t.newLeads, items: [] },
    }
    return NextResponse.json({ tasks, timeZone: tz })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not load your tasks right now. Try again in a minute.' }, { status: 500 })
    return res
  }
}
