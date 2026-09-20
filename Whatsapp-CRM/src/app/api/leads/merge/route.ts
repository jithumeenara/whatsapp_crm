import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'

/**
 * Folding duplicate leads into one.
 *
 * ── What "merge" has to mean ────────────────────────────────────────
 *
 * Not "delete the extra one". A duplicate lead is not empty — somebody
 * called from it, left a note on it, booked a follow-up against it. Drop
 * the row and that history goes with it, and the agent who made the call
 * finds no record of having made it.
 *
 * So everything that points at the duplicates is moved to the survivor
 * first — activities, follow-ups, tasks, deals, ad submissions — and
 * only then are the duplicates removed. The survivor ends up with the
 * whole story on one timeline, which is the point of merging at all.
 *
 * ── Why it is one transaction ───────────────────────────────────────
 *
 * Halfway through is the worst possible state: history moved to a lead
 * that still has a twin, or a lead deleted with its follow-ups
 * orphaned. Either it all happens or none of it does.
 *
 * ── What is deliberately kept ───────────────────────────────────────
 *
 * The survivor's own fields. Merging does not average two statuses or
 * pick the "better" score — a merge is about combining history, and
 * quietly changing the status of a lead somebody is working would be a
 * surprise they did not ask for. The duplicates' notes are appended
 * rather than dropped, because a note is something a person wrote.
 */

/** More than a handful at once is a sign of an import gone wrong, which
 *  wants looking at rather than merging in bulk. */
const MAX_MERGE = 10

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await req.json().catch(() => null)) as
    | { keep_id?: string; merge_ids?: unknown }
    | null
  if (!body?.keep_id) return NextResponse.json({ error: 'No lead to keep.' }, { status: 400 })

  const mergeIds = Array.isArray(body.merge_ids)
    ? [...new Set(body.merge_ids.filter((i): i is string => typeof i === 'string'))].filter(
        (i) => i !== body.keep_id,
      )
    : []
  if (mergeIds.length === 0) return NextResponse.json({ error: 'Nothing to merge in.' }, { status: 400 })
  if (mergeIds.length > MAX_MERGE) {
    return NextResponse.json(
      { error: `That is more than ${MAX_MERGE} at once. Merge them in smaller groups.` },
      { status: 400 },
    )
  }

  const scope: Record<string, unknown> = { account_id: ctx.accountId }
  if (!canViewAllLeads(ctx.role)) scope.assigned_to = ctx.userId

  try {
    const [keep, duplicates] = await Promise.all([
      prisma.lead.findFirst({
        where: { id: body.keep_id, ...scope },
        select: { id: true, contact_id: true, notes: true, title: true },
      }),
      prisma.lead.findMany({
        where: { id: { in: mergeIds }, ...scope },
        select: { id: true, contact_id: true, notes: true, title: true, created_at: true },
      }),
    ])

    if (!keep) return NextResponse.json({ error: 'That lead is not yours to merge into.' }, { status: 403 })
    if (duplicates.length === 0) {
      return NextResponse.json({ error: 'None of those leads are yours to merge.' }, { status: 403 })
    }

    // The same person, or it is not a duplicate. Two leads for two
    // different contacts merged into one loses a customer entirely, and
    // there is no undo for that.
    const wrongContact = duplicates.filter((d) => d.contact_id !== keep.contact_id)
    if (wrongContact.length > 0) {
      return NextResponse.json(
        { error: 'Those leads are for different contacts. Merge the contacts first.' },
        { status: 400 },
      )
    }

    const ids = duplicates.map((d) => d.id)

    // Notes are things people wrote; they are carried across rather than
    // deleted, each under the date it was written.
    const carriedNotes = duplicates
      .filter((d) => d.notes?.trim())
      .map((d) => `— from a merged lead (${new Date(d.created_at).toLocaleDateString()}):\n${d.notes!.trim()}`)
      .join('\n\n')

    const result = await prisma.$transaction(async (tx) => {
      // Everything that points at a duplicate now points at the
      // survivor. Ordered before the delete, so nothing is ever orphaned
      // even for the length of the transaction.
      const moved = {
        activities: (await tx.leadActivity.updateMany({ where: { lead_id: { in: ids } }, data: { lead_id: keep.id } })).count,
        followUps: (await tx.followUp.updateMany({ where: { lead_id: { in: ids } }, data: { lead_id: keep.id } })).count,
        tasks: (await tx.task.updateMany({ where: { lead_id: { in: ids } }, data: { lead_id: keep.id } })).count,
        deals: (await tx.deal.updateMany({ where: { lead_id: { in: ids } }, data: { lead_id: keep.id } })).count,
        adSubmissions: (await tx.leadAdSubmission.updateMany({ where: { lead_id: { in: ids } }, data: { lead_id: keep.id } })).count,
      }

      if (carriedNotes) {
        await tx.lead.update({
          where: { id: keep.id },
          data: { notes: [keep.notes?.trim(), carriedNotes].filter(Boolean).join('\n\n') },
        })
      }

      // Written before the delete so it is inside the transaction, and
      // so the timeline explains where the extra history came from.
      await tx.leadActivity.create({
        data: {
          lead_id: keep.id,
          contact_id: keep.contact_id,
          account_id: ctx.accountId,
          user_id: ctx.userId,
          type: 'stage_change',
          title: `Merged ${duplicates.length} duplicate lead${duplicates.length === 1 ? '' : 's'}`,
          description: duplicates.map((d) => d.title).join(', '),
          metadata: { merged_ids: ids, moved },
        },
      })

      await tx.lead.deleteMany({ where: { id: { in: ids }, account_id: ctx.accountId } })

      return moved
    })

    return NextResponse.json({ merged: ids.length, kept: keep.id, moved: result })
  } catch (err) {
    console.error('[leads] merge failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not merge those leads.' }, { status: 500 })
  }
}
