import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * PATCH /api/judgements/[id]
 *
 * Telling the assistant whether it was right.
 *
 * ── Why one endpoint for every kind of correction ───────────────────
 *
 * The assistant decides five things at once about a conversation, and
 * a person can disagree with any of them. Five endpoints would mean
 * five accuracy figures that could quietly diverge, and five places to
 * get the "who may do this" check wrong. It is one judgement, so it is
 * one correction.
 *
 * ── Why agreeing is worth a click ───────────────────────────────────
 *
 * It would be easier to record only disagreements and assume the rest
 * were right. That inflates accuracy toward 100% the moment people stop
 * looking, which is precisely when the number most needs to fall. So
 * agreement is recorded explicitly, and an untouched judgement counts
 * for neither side.
 *
 * ── Why correcting does not, by itself, create anything ─────────────
 *
 * Saying "this was really a lead" records a fact about the assistant.
 * Creating the lead is a separate action with its own button, because
 * a person may well want to fix the record without taking on the work —
 * and a correction that silently created a row would make people stop
 * correcting.
 */

type Body = {
  /** 'agreed' — the assistant was right about all of it.
   *  'corrected' — at least one of the fields below differs. */
  verdict?: unknown
  /** What it really was. Omitted means "the assistant had this right". */
  is_lead?: unknown
  category?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Any agent may answer this. Reviewing is the job of whoever is
    // working the conversations, and gating it to admins would leave
    // the queue unanswered, which is the one way this fails.
    const ctx = await requireRole('agent')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as Body | null
    const verdict = body?.verdict
    if (verdict !== 'agreed' && verdict !== 'corrected') {
      return NextResponse.json(
        { error: "Provide 'verdict' as 'agreed' or 'corrected'." },
        { status: 400 },
      )
    }

    const existing = await prisma.aiJudgement.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, is_lead: true, category: true, reviewed_at: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // A category the account does not have cannot be stored: it would
    // route to nobody and would appear in the confusion report as a
    // label nobody recognises.
    let humanCategory: string | null | undefined
    if (body?.category !== undefined) {
      const key = typeof body.category === 'string' ? body.category.trim() : ''
      if (key) {
        const known = await prisma.serviceCategory.findFirst({
          where: { account_id: ctx.accountId, key },
          select: { id: true },
        })
        if (!known) {
          return NextResponse.json({ error: 'Unknown category.' }, { status: 400 })
        }
        humanCategory = key
      } else {
        humanCategory = null
      }
    }

    // Agreeing means agreeing with what it said, so the human columns
    // are filled with the assistant's own answers rather than left
    // null. That keeps one shape for every reviewed row: the accuracy
    // figure and the examples both read the human columns and never
    // have to work out which case they are in.
    const humanIsLead =
      verdict === 'agreed'
        ? existing.is_lead
        : typeof body?.is_lead === 'boolean'
          ? body.is_lead
          : existing.is_lead

    const resolvedCategory =
      verdict === 'agreed' ? existing.category : (humanCategory ?? existing.category)

    await prisma.aiJudgement.update({
      where: { id },
      data: {
        human_verdict: verdict,
        human_is_lead: humanIsLead,
        human_category: resolvedCategory,
        reviewed_at: new Date(),
        reviewed_by: ctx.userId,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
