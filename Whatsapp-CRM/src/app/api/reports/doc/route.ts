import { NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { goalsLinkFor, menuFor, scheduledLinkFor } from '@/lib/reports/doc/registry'

/**
 * GET /api/reports/doc
 *
 * The Reports menu: only the reports this person may open, in order, and
 * which exports they may take from each (none below supervisor).
 */
export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    assertPageAccess(ctx, '/reports')
    const who = { userId: ctx.userId, role: ctx.role }
    // The reports, then the Goals and Scheduled links for owners and admins.
    return NextResponse.json({ reports: [...menuFor(who), ...goalsLinkFor(who), ...scheduledLinkFor(who)] })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not load the reports list right now.' }, { status: 500 })
    return res
  }
}
