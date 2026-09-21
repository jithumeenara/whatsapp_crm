import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { isExpired, secondsLeft } from '@/lib/agents/offer'
import { advanceStaleOffers } from '@/lib/agents/advance-offers'

/**
 * GET /api/offers
 *
 * What is being offered to me right now.
 *
 * ── Why this endpoint also pushes the rotation along ────────────────
 *
 * An offer expires because its row says when it was made, not because
 * anything is scheduled — which is what makes it survive a restart, and
 * also means somebody has to notice. This is the natural place: the
 * people whose browsers are asking this question are exactly the people
 * a waiting conversation could be offered to next.
 *
 * It is not the only place. The webhook advances it when a customer
 * writes again, and /api/offers/cron covers the case where nobody has
 * a browser open at all — which is also the case where the rotation
 * will run out and the customer needs to be asked when to call back.
 * Three triggers for one rule, because the failure mode of having only
 * one is a conversation that waits forever with nothing on any screen
 * to say so.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    // Before answering. Otherwise an agent's own screen would show them
    // an offer that ran out thirty seconds ago and let them accept it
    // while the rotation had already moved on.
    await advanceStaleOffers(ctx.accountId).catch(() => {})

    const now = new Date()
    const rows = await prisma.conversationOffer.findMany({
      where: { account_id: ctx.accountId, user_id: ctx.userId, status: 'pending' },
      orderBy: { offered_at: 'asc' },
      take: 10,
      select: {
        id: true,
        conversation_id: true,
        offered_at: true,
        window_seconds: true,
        reason: true,
        outside_speciality: true,
        conversation: {
          select: {
            last_message_text: true,
            contact: { select: { name: true, phone: true } },
          },
        },
      },
    })

    // A row that is pending but past its window has not been swept yet.
    // Filtered here rather than shown with a zero countdown, which
    // would be an offer nobody can take sitting on somebody's screen.
    const live = rows.filter((o) => !isExpired(o.offered_at, o.window_seconds, now))

    return NextResponse.json({
      offers: live.map((o) => ({
        id: o.id,
        conversation_id: o.conversation_id,
        seconds_left: secondsLeft(o.offered_at, o.window_seconds, now),
        window_seconds: o.window_seconds,
        reason: o.reason,
        outside_speciality: o.outside_speciality,
        customer_name: o.conversation?.contact?.name ?? null,
        customer_phone: o.conversation?.contact?.phone ?? null,
        customer_said: o.conversation?.last_message_text ?? null,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
