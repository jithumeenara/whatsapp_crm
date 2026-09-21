import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { acceptOffer, declineOffer } from '@/lib/agents/run-offer'
import { advanceConversation } from '@/lib/agents/advance-offers'

/**
 * PATCH /api/offers/[id]
 *
 * An agent answers: I will take it, or I will not.
 *
 * ── Why declining is worth a button ─────────────────────────────────
 *
 * It would be simpler to let an agent ignore an offer and wait out the
 * minute. But somebody who knows straight away that they cannot take
 * this one — on a call, about to leave, does not speak the language —
 * is doing the customer a favour by saying so, and making them sit
 * through a countdown to do it teaches them to ignore the alert
 * instead.
 *
 * Declining moves the rotation on immediately rather than waiting for
 * the clock, which is the whole point of offering it to them.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Any agent. Answering an offer made to you is not an administrative
    // act, and gating it would leave offers unanswered — the one way
    // this fails.
    const ctx = await requireRole('agent')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as { action?: unknown } | null
    const action = body?.action

    if (action !== 'accept' && action !== 'decline') {
      return NextResponse.json(
        { error: "Provide 'action' as 'accept' or 'decline'." },
        { status: 400 },
      )
    }

    const result =
      action === 'accept'
        ? await acceptOffer({ accountId: ctx.accountId, offerId: id, userId: ctx.userId })
        : await declineOffer({ accountId: ctx.accountId, offerId: id, userId: ctx.userId })

    if (!result.ok) {
      // 409, not 400: "somebody else got there first" is not a mistake
      // the agent made, and the screen should say so rather than
      // showing a validation error.
      return NextResponse.json({ error: result.error }, { status: 409 })
    }

    // Declining should hand the conversation to the next person now,
    // not in fifty seconds. Not awaited — the agent's screen should
    // close the card immediately, and the rotation is somebody else's
    // problem by definition.
    if (action === 'decline' && result.conversationId) {
      void advanceConversation(ctx.accountId, result.conversationId).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
