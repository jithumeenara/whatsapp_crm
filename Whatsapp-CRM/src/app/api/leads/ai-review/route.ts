import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Telling the assistant whether it was right.
 *
 * ── Two shapes of the same question ─────────────────────────────────
 *
 * A row reaches this endpoint one of two ways. Either the assistant
 * proposed it and it is waiting on the Suggested tab, or it was already
 * in the pool and the assistant read it and said it was probably not an
 * enquiry. The question a person answers is the same in both cases —
 * was the assistant right? — so `accepted` always means yes and
 * `rejected` always means no, whichever kind of row it was. That is
 * what keeps the accuracy figure a single, comparable number.
 *
 * What agreeing *does* differs, because the rows are in different
 * places:
 *
 *   a suggestion, agreed      → it becomes an ordinary lead
 *   a suggestion, overruled   → the row goes; it was never a lead
 *   a flagged lead, agreed    → closed as "Not an enquiry"
 *   a flagged lead, overruled → the flag is cleared, the lead stays
 *
 * Note that a flagged lead is closed rather than deleted. Somebody
 * created it — the auto-capture rule did, deliberately — and quietly
 * destroying a row a person can see is a different promise from marking
 * it.
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
      where: {
        id: { in: leadIds },
        account_id: ctx.accountId,
        OR: [{ ai_suggested: true }, { ai_verdict: 'not_enquiry' }],
      },
      select: { id: true, contact_id: true, title: true, ai_suggested: true },
    })
    if (leads.length === 0) {
      return NextResponse.json({ error: 'Those are no longer waiting for an answer.' }, { status: 404 })
    }

    const suggestions = leads.filter((l) => l.ai_suggested)
    const flagged = leads.filter((l) => !l.ai_suggested)

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

    const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

    if (decision === 'accepted') {
      // ── The assistant was right ──
      if (suggestions.length > 0) {
        await prisma.lead.updateMany({
          where: { id: { in: ids(suggestions) }, account_id: ctx.accountId },
          data: {
            // An ordinary lead from here on. Clearing the flag is what
            // moves it off the Suggested tab and into the pool.
            ai_suggested: false,
            ai_review_result: 'accepted',
            ai_reviewed_at: new Date(),
          },
        })
      }

      if (flagged.length > 0) {
        // Agreeing that it was never an enquiry. Closed with a reason,
        // not deleted — the auto-capture rule created this row on
        // purpose, and a person can see it.
        await prisma.lead.updateMany({
          where: { id: { in: ids(flagged) }, account_id: ctx.accountId },
          data: {
            status: 'closed',
            lost_reason: 'Not an enquiry',
            // Stamped wherever a loss is recorded, not only on the lead
            // page. A reason without a time is a loss the dashboard
            // cannot see, and these are the losses an account gets most
            // of — so leaving it out here would quietly flatter every
            // conversion rate in the place.
            lost_at: new Date(),
            ai_review_result: 'accepted',
            ai_reviewed_at: new Date(),
          },
        })
      }

      await prisma.leadActivity
        .createMany({
          data: leads.map((lead) => ({
            account_id: ctx.accountId,
            lead_id: lead.id,
            contact_id: lead.contact_id,
            type: 'stage_change',
            title: lead.ai_suggested ? 'Suggestion accepted' : 'Closed — not an enquiry',
            description: lead.ai_suggested
              ? 'Confirmed as a real lead and moved into the pool.'
              : 'Agreed with the assistant that this was never an enquiry.',
            metadata: { new_status: lead.ai_suggested ? 'new' : 'closed' },
          })),
        })
        .catch(() => {})

      return NextResponse.json({ accepted: leads.length })
    }

    // ── The assistant was wrong ──

    if (flagged.length > 0) {
      // The flag goes and the lead stays exactly where it was. Nothing
      // about its status or owner changes — overruling a guess should
      // not move somebody's work.
      await prisma.lead.updateMany({
        where: { id: { in: ids(flagged) }, account_id: ctx.accountId },
        data: { ai_verdict: null, ai_review_result: 'rejected', ai_reviewed_at: new Date() },
      })

      await prisma.leadActivity
        .createMany({
          data: flagged.map((lead) => ({
            account_id: ctx.accountId,
            lead_id: lead.id,
            contact_id: lead.contact_id,
            type: 'note',
            title: 'Kept — this is a real enquiry',
            description: 'The assistant read it as not an enquiry; overruled.',
          })),
        })
        .catch(() => {})
    }

    if (suggestions.length > 0) {
      // The row goes. It was never a lead; the decision recorded above
      // is the record that it was looked at.
      await prisma.lead.deleteMany({
        where: { id: { in: ids(suggestions) }, account_id: ctx.accountId, ai_suggested: true },
      })
    }

    return NextResponse.json({ rejected: leads.length })
  } catch (err) {
    console.error('[leads] ai review failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not record that.' }, { status: 500 })
  }
}
