import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { outcomeTitle, parseOutcomeInput } from '@/lib/leads/follow-up-outcome'

/**
 * POST /api/follow-ups/:id/outcome — Done, Reschedule or Couldn't reach.
 *
 * One call records what happened, writes it on the lead's timeline and,
 * for a retry, sets the next reminder — so the lead page, the Follow-ups
 * page and the callback alert all agree afterwards.
 *
 * An agent may act on a follow-up that is theirs, on a lead that is
 * theirs, or that nobody holds yet; supervisors and above on any in the
 * account.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params
    const input = parseOutcomeInput(await req.json().catch(() => null))
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })

    const existing = await prisma.followUp.findFirst({
      where: { id, account_id: ctx.accountId },
      select: {
        id: true, title: true, status: true, due_at: true, lead_id: true, contact_id: true,
        assigned_to: true, lead: { select: { assigned_to: true } },
      },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const holder = existing.assigned_to ?? existing.lead?.assigned_to ?? null
    if (holder && holder !== ctx.userId && !canViewAllLeads(ctx.role)) {
      return NextResponse.json({ error: 'This follow-up belongs to another agent' }, { status: 403 })
    }
    if (existing.status !== 'pending') {
      return NextResponse.json({ error: 'This follow-up is already closed' }, { status: 409 })
    }

    const profile = await prisma.companyProfile
      .findUnique({ where: { account_id: ctx.accountId }, select: { timezone: true } })
      .catch(() => null)
    const timezone = profile?.timezone?.trim() || 'Asia/Kolkata'
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(d)

    const { outcome, note, nextAt } = input
    const assignee = existing.assigned_to ?? ctx.userId

    const description = [
      outcome === 'rescheduled' && nextAt ? `Moved from ${fmt(existing.due_at)} to ${fmt(nextAt)}` : null,
      outcome === 'not_reached' && nextAt ? `Try again ${fmt(nextAt)}` : null,
      note,
    ].filter(Boolean).join(' — ') || existing.title

    await prisma.$transaction(async (tx) => {
      if (outcome === 'rescheduled') {
        await tx.followUp.update({
          where: { id },
          data: { due_at: nextAt as Date, assigned_to: assignee },
        })
      } else {
        await tx.followUp.update({
          where: { id },
          data: {
            status: outcome === 'done' ? 'done' : 'skipped',
            // The original note — what the call was about — is kept;
            // what happened goes on the lead's timeline below.
            completed_at: new Date(),
          },
        })
        if (outcome === 'not_reached' && nextAt) {
          await tx.followUp.create({
            data: {
              account_id: ctx.accountId,
              user_id: ctx.userId,
              contact_id: existing.contact_id,
              lead_id: existing.lead_id,
              title: existing.title,
              note: note ? `Couldn't reach last time — ${note}` : "Couldn't reach last time",
              due_at: nextAt,
              assigned_to: assignee,
            },
          })
        }
      }

      if (existing.lead_id) {
        await tx.leadActivity.create({
          data: {
            account_id: ctx.accountId,
            lead_id: existing.lead_id,
            contact_id: existing.contact_id,
            user_id: ctx.userId,
            type: 'follow_up',
            title: outcomeTitle(outcome),
            description,
            metadata: {
              follow_up_id: id,
              outcome,
              due_at: existing.due_at.toISOString(),
              ...(nextAt ? { next_at: nextAt.toISOString() } : {}),
            },
          },
        })
      }
    })

    if (existing.lead_id) {
      emitToAccount(ctx.accountId, 'lead', {
        eventType: 'UPDATE',
        new: { id: existing.lead_id },
        old: {},
      })
    }
    return NextResponse.json({ ok: true, outcome })
  } catch (err) {
    return toErrorResponse(err)
  }
}
