import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { emitToAccount } from '@/lib/socket'

/**
 * POST /api/calls/[id]/respond — an agent answers or declines.
 *
 * Two agents can be looking at the same ringing popup: an unassigned
 * call rings everyone on purpose, because two people answering is a far
 * smaller problem than nobody. So accepting is a claim, and the claim
 * has to be decided by the database rather than by whoever's click
 * arrives first at the application.
 *
 * The updateMany below carries the whole race in its `where`: it only
 * matches a call that is still ringing and still unclaimed. The second
 * agent's request updates zero rows and is told, plainly, that somebody
 * else has it — rather than both being told they are connected.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let accountId: string
  let userId: string
  try {
    const guard = await requireRole('agent')
    accountId = guard.accountId
    userId = guard.userId
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { action?: string } | null
  const action = body?.action
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })
  }

  const call = await prisma.call.findFirst({
    where: { id, account_id: accountId },
    select: { id: true, status: true, agent_id: true, conversation_id: true },
  })
  if (!call) return NextResponse.json({ error: 'Call not found.' }, { status: 404 })

  if (action === 'decline') {
    // Declining does not end the call. It steps this agent out of it —
    // the call stays ringing for whoever else it went to, and only the
    // ring timeout decides it was missed.
    emitToAccount(accountId, 'call', { type: 'cancelled', callId: call.id, agentId: userId })
    return NextResponse.json({ ok: true, declined: true })
  }

  const claimed = await prisma.call.updateMany({
    // The race, expressed as a condition: still ringing, and not already
    // claimed by somebody else.
    where: {
      id: call.id,
      account_id: accountId,
      status: 'ringing',
      OR: [{ agent_id: null }, { agent_id: userId }],
    },
    data: {
      status: 'in_progress',
      agent_id: userId,
      handled_by: 'agent',
      answered_at: new Date(),
    },
  })

  if (claimed.count === 0) {
    const current = await prisma.call.findUnique({
      where: { id: call.id },
      select: { status: true, agent: { select: { profile: { select: { full_name: true } } } } },
    })
    const takenBy = current?.agent?.profile?.full_name
    return NextResponse.json(
      {
        error:
          current?.status === 'ringing'
            ? 'Someone else is answering this call.'
            : takenBy
              ? `${takenBy} already took this call.`
              : 'This call has already ended.',
      },
      { status: 409 },
    )
  }

  // Everyone else's popup stops ringing immediately. Without this the
  // losers of the race keep ringing until their own countdown expires,
  // for a call that is already being spoken on.
  emitToAccount(accountId, 'call', { type: 'ended', callId: call.id, agentId: userId })

  return NextResponse.json({
    ok: true,
    call_id: call.id,
    conversation_id: call.conversation_id,
    // Null until the media bridge exists. The popup opens a window only
    // when there is something to open, rather than an empty tab that
    // looks like the feature is broken.
    join_url: null,
  })
}
