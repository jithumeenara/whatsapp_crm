import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { issueRealtimeTicket } from '@/lib/realtime-ticket'

/**
 * GET /api/realtime/ticket
 *
 * A one-minute ticket that admits this browser to its own account's live
 * updates. The socket server verifies the signature and takes the account
 * from the ticket — see src/lib/realtime-ticket.ts for why the client is
 * never allowed to name it.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    return NextResponse.json(
      { ticket: issueRealtimeTicket({ accountId: ctx.accountId, userId: ctx.userId }) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
