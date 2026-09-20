import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * How often the assistant was right, counted from what people did.
 *
 * Not a confidence score and not a vendor claim — the number of
 * suggestions somebody accepted over the number somebody decided on.
 * It is the only honest way to answer "does this work for my business",
 * because the answer genuinely differs by business.
 *
 * Auto-accepted rows — the ones from `create` mode, which nobody
 * reviewed — are deliberately excluded from both halves. Counting them
 * as correct would make the figure climb the moment an account stopped
 * checking, which is exactly backwards.
 */
export async function GET() {
  try {
    const ctx = await requireRole('agent')

    const [accepted, rejected, pending] = await Promise.all([
      prisma.aiLeadReview.count({ where: { account_id: ctx.accountId, decision: 'accepted' } }),
      prisma.aiLeadReview.count({ where: { account_id: ctx.accountId, decision: 'rejected' } }),
      prisma.lead.count({
        where: { account_id: ctx.accountId, ai_suggested: true, ai_review_result: null },
      }),
    ])

    const reviewed = accepted + rejected
    return NextResponse.json({
      reviewed,
      accepted,
      rejected,
      pending,
      percent: reviewed > 0 ? Math.round((accepted / reviewed) * 100) : 0,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
