import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Accepting or rejecting what the assistant suggested.
 *
 * ── Why a reject deletes rather than hides ──────────────────────────
 *
 * A rejected suggestion is not a lead that went cold — it is something
 * that was never a lead. Left in the table as a closed row it would
 * drag every conversion figure down and appear in every duplicate
 * check. So the row goes, and what survives is the count: the
 * LeadActivity row and the tally the accuracy figure reads.
 *
 * ── Why the counter is its own table ────────────────────────────────
 *
 * Deleting the row would take the "rejected" tally with it, and the
 * accuracy figure would then only ever be able to count the accepts —
 * which would read as 100% forever. The decision is written to
 * ai_lead_reviews before the lead is removed.
 */
export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await req.json().catch(() => null)
  const leadIds: string[] = Array.isArray(body?.lead_ids)
    ? body.lead_ids.filter((v: unknown): v is string => typeof v === 'string')
    : typeof body?.lead_id === 'string'
      ? [body.lead_id]
      : []
  const decision = body?.decision

  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'Nothing to review.' }, { status: 400 })
  }
  if (decision !== 'accepted' && decision !== 'rejected') {
    return NextResponse.json({ error: 'Decision must be accepted or rejected.' }, { status: 400 })
  }

  try {
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, account_id: ctx.accountId, ai_suggested: true },
      select: { id: true, contact_id: true, title: true },
    })
    if (leads.length === 0) {
      return NextResponse.json({ error: 'Those suggestions are no longer there.' }, { status: 404 })
    }

    // Written first, and for both answers, because this table is what
    // the accuracy figure counts. If the work below fails, a recorded
    // decision that did not take effect is a smaller problem than a
    // figure that can only ever go up.
    await prisma.aiLeadReview.createMany({
      data: leads.map((lead) => ({
        account_id: ctx.accountId,
        contact_id: lead.contact_id,
        decision,
        reviewed_by: ctx.userId,
      })),
    })

    if (decision === 'accepted') {
      await prisma.lead.updateMany({
        where: { id: { in: leads.map((l) => l.id) }, account_id: ctx.accountId },
        data: {
          // It is an ordinary lead from here on. Clearing the flag is
          // what moves it off the Suggested tab and into the pool.
          ai_suggested: false,
          ai_review_result: 'accepted',
          ai_reviewed_at: new Date(),
        },
      })

      await prisma.leadActivity
        .createMany({
          data: leads.map((lead) => ({
            account_id: ctx.accountId,
            lead_id: lead.id,
            contact_id: lead.contact_id,
            type: 'stage_change',
            title: 'Suggestion accepted',
            description: 'Confirmed as a real lead and moved into the pool.',
            metadata: { new_status: 'new' },
          })),
        })
        .catch(() => {})

      return NextResponse.json({ accepted: leads.length })
    }

    // ── Rejected ──
    // The row goes. It was never a lead; the decision above is the
    // record that it was looked at.
    await prisma.lead.deleteMany({
      where: { id: { in: leads.map((l) => l.id) }, account_id: ctx.accountId, ai_suggested: true },
    })

    return NextResponse.json({ rejected: leads.length })
  } catch (err) {
    console.error('[leads] ai review failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not record that.' }, { status: 500 })
  }
}
