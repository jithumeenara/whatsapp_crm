import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/calls/[id]
 *
 * One call, with what was said on it.
 *
 * Separate from the list on purpose: a transcript runs to thousands of
 * words, and twenty of them would be most of a page's weight for
 * something nobody has asked to read. The list says only whether there is
 * one; this fetches it when somebody opens the call.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let accountId: string
  try {
    accountId = (await requireRole('agent')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id } = await context.params

  // Scoped to the account in the query itself rather than checked after.
  // A call id is a UUID somebody could hold from another tenant, and
  // fetching first and comparing second is how that turns into a leak.
  const call = await prisma.call
    .findFirst({
      where: { id, account_id: accountId },
      select: {
        id: true,
        channel: true,
        direction: true,
        status: true,
        from_number: true,
        to_number: true,
        handled_by: true,
        transferred_at: true,
        transfer_reason: true,
        started_at: true,
        answered_at: true,
        ended_at: true,
        duration_seconds: true,
        end_reason: true,
        transcript: true,
        recording_url: true,
        conversation_id: true,
        contact: { select: { id: true, name: true, phone: true } },
        agent: { select: { id: true, profile: { select: { full_name: true } } } },
      },
    })
    .catch(() => null)

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  }
  return NextResponse.json(call)
}
