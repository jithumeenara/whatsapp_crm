import { NextRequest, NextResponse } from 'next/server'
import { onceSchemaPatch } from "@/lib/db/schema-patch"
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { reportMetaAdsOutcome } from '@/lib/meta-ads/triggers'

async function getLead(id: string, accountId: string) {
  return prisma.lead.findFirst({
    where: { id, account_id: accountId },
    include: {
      contact: { select: { id: true, name: true, phone: true, alternate_phone: true, avatar_url: true } },
      assignee: { select: { id: true, email: true, profile: { select: { full_name: true, avatar_url: true } } } },
      activities: {
        orderBy: { created_at: 'desc' },
        // 51, so the page can tell "this is all of it" from "this is
        // the most recent fifty" without a second count query. The
        // extra row is dropped before it is rendered.
        take: 51,
        // Who did it. Without this the timeline says "Status changed to
        // Follow-up" with nobody attached, which on a shared pool of
        // five agents is most of the question left unanswered.
        include: {
          user: { select: { id: true, email: true, profile: { select: { full_name: true } } } },
        },
      },
      follow_ups: { orderBy: { due_at: 'asc' } },
      tasks: { orderBy: { due_date: 'asc' } },
    },
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')
    const { id } = await params

    // Also return adjacent lead IDs for prev/next navigation
    const fromTab = req.nextUrl.searchParams.get('from') ?? 'all'
    const lead = await getLead(id, ctx.accountId)
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Fetch prev/next IDs in same tab ordering
    const TAB_STATUS_MAP: Record<string, string | null> = {
      new_pool: 'new',
      call_not_connected: 'call_not_connected',
      visited: 'visited',
      appointment_fixed: 'appointment_fixed',
      follow_up: 'follow_up',
      closed: 'closed',
      all: null,
      mine: null,
    }

    const isPrivileged = canViewAllLeads(ctx.role)
    const tabStatus = TAB_STATUS_MAP[fromTab]
    const navWhere: Record<string, unknown> = { account_id: ctx.accountId }
    if (tabStatus !== undefined && tabStatus !== null) navWhere.status = tabStatus
    // Same exclusion the list applies, or Previous/Next would walk into
    // closed leads the list never showed.
    if (fromTab !== 'closed' && tabStatus === null) {
      navWhere.status = { not: 'closed' }
    }
    if (fromTab === 'new_pool') {
      navWhere.assigned_to = null
    } else if (fromTab === 'mine') {
      navWhere.assigned_to = ctx.userId
    } else if (!isPrivileged && fromTab !== 'all') {
      navWhere.assigned_to = ctx.userId
    }

    const allIds = await prisma.lead.findMany({
      where: navWhere,
      orderBy: { created_at: 'desc' },
      select: { id: true },
    })
    const idx = allIds.findIndex((l) => l.id === id)
    const prevId = idx > 0 ? allIds[idx - 1].id : null
    const nextId = idx < allIds.length - 1 ? allIds[idx + 1].id : null

    return NextResponse.json({ lead, prevId, nextId })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params
    const existing = await prisma.lead.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const isPrivileged = canViewAllLeads(ctx.role)

    // Claim shorthand: assign this lead to the current user
    if (body.claim === true) {
      if (existing.assigned_to && existing.assigned_to !== ctx.userId && !isPrivileged) {
        return NextResponse.json({ error: 'Lead is already assigned to another agent' }, { status: 409 })
      }
      const lead = await prisma.lead.update({
        where: { id },
        data: {
          assigned_to: ctx.userId,
          claimed_at: new Date(),
        },
        include: {
          contact: { select: { id: true, name: true, phone: true, alternate_phone: true } },
          assignee: { select: { id: true, email: true, profile: { select: { full_name: true } } } },
        },
      })

      // The conversation comes with the lead.
      //
      // Claiming a lead is saying "I am handling this person", and the
      // handling happens in the Inbox — but the thread stayed
      // unassigned, so it was not in the claimer's Inbox and the
      // assistant carried on answering on their behalf. An agent had to
      // find the same customer twice, in two places, by hand.
      //
      // Only an unassigned thread is taken: one a colleague is already
      // in is theirs, and a lead claim is not a reason to take it.
      // Best effort — the claim itself has already succeeded, and a
      // conversation that cannot be assigned must not undo it.
      if (lead.contact_id) {
        await prisma.conversation
          .updateMany({
            where: {
              account_id: ctx.accountId,
              contact_id: lead.contact_id,
              assigned_agent_id: null,
            },
            data: { assigned_agent_id: ctx.userId },
          })
          .then(async ({ count }) => {
            if (count === 0) return
            const { emitToAccount } = await import('@/lib/socket')
            emitToAccount(ctx.accountId, 'conversation', {
              eventType: 'UPDATE',
              new: { contact_id: lead.contact_id, assigned_agent_id: ctx.userId },
              old: {},
            })
          })
          .catch((err) =>
            console.error(
              '[leads] claimed, but the conversation could not be assigned:',
              err instanceof Error ? err.message : err,
            ),
          )
      }
      await prisma.leadActivity.create({
        data: {
          account_id: ctx.accountId,
          lead_id: id,
          contact_id: lead.contact_id ?? null,
          user_id: ctx.userId,
          type: 'stage_change',
          title: 'Lead claimed',
          description: 'Lead was claimed from the pool',
        },
      })
      return NextResponse.json({ lead })
    }

    // Handle is_hidden toggle via raw SQL (column added on first use)
    if (typeof body.is_hidden === 'boolean') {
      // No .catch here, matching the original: if this column cannot be
      // created the UPDATE below would fail anyway, and failing loudly
      // is better than reporting a hide that did not happen.
      await onceSchemaPatch('leads.is_hidden', () => prisma.$executeRaw`
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE
      `)
      await prisma.$executeRaw`
        UPDATE leads SET is_hidden = ${body.is_hidden} WHERE id = ${id}::uuid
      `
      const lead = await getLead(id, ctx.accountId)
      return NextResponse.json({ lead })
    }

    const {
      title, contact_id, source, status, score, notes, assigned_to,
      lost_reason, converted_at, lead_quality, call_outcome,
      closing_remarks, district, place, call_note,
    } = body as Record<string, string | undefined>

    // Build update payload
    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (contact_id !== undefined) data.contact_id = contact_id || null
    if (source !== undefined) data.source = source
    if (status !== undefined) data.status = status
    if (score !== undefined) data.score = score
    if (notes !== undefined) {
      // The lead's description — what it is for and what they need.
      if (notes !== null && typeof notes !== 'string') {
        return NextResponse.json({ error: 'Description must be text' }, { status: 400 })
      }
      if (typeof notes === 'string' && notes.length > 2000) {
        return NextResponse.json({ error: 'Keep the description under 2000 characters' }, { status: 400 })
      }
      data.notes = typeof notes === 'string' ? notes.trim() || null : null
    }
    if (lead_quality !== undefined) data.lead_quality = lead_quality || null
    if (call_outcome !== undefined) data.call_outcome = call_outcome || null
    if (closing_remarks !== undefined) data.closing_remarks = closing_remarks || null
    if (district !== undefined) data.district = district || null
    if (place !== undefined) data.place = place || null
    if (assigned_to !== undefined) data.assigned_to = assigned_to || null
    if (lost_reason !== undefined) {
      data.lost_reason = lost_reason || null
      // Stamped and cleared with the reason it belongs to, so the two
      // can never disagree. Clearing matters as much as setting: a lead
      // that was lost and is now being worked again must stop counting
      // as a loss, or the week it was reopened reads worse than it was.
      data.lost_at = lost_reason ? new Date() : null
    }
    if (converted_at !== undefined) {
      data.converted_at = converted_at ? new Date(converted_at) : null
      // Won and lost are not both true. Recording a conversion clears
      // the loss, which is what reopening-then-winning actually means.
      if (converted_at) {
        data.lost_reason = null
        data.lost_at = null
      }
    }

    // ── Acting on a lead claims it ───────────────────────────────────
    //
    // An agent could open something from the pool, phone the person,
    // log the outcome and write a note, and the lead stayed unassigned
    // — still in the pool, still offered to everybody. The next agent
    // rang the same customer, who had already been called. The work was
    // done and the record said nobody had done it.
    //
    // Claiming is not a separate intention from working on it. Whoever
    // changed it owns it.
    //
    // Only from unassigned, and never when the change *is* an
    // assignment: a supervisor handing a lead to somebody else must not
    // find they have given it to themselves.
    const autoClaimed =
      Object.keys(data).length > 0 &&
      !existing.assigned_to &&
      assigned_to === undefined
    if (autoClaimed) {
      data.assigned_to = ctx.userId
      data.claimed_at = new Date()
    }

    const lead = await prisma.lead.update({
      where: { id },
      data,
      include: {
        contact: { select: { id: true, name: true, phone: true, alternate_phone: true } },
        assignee: { select: { id: true, email: true, profile: { select: { full_name: true } } } },
      },
    })

    // Click-to-WhatsApp attribution — a lead qualifying is a real outcome
    // worth reporting back to Meta, if this contact's conversation came
    // from an ad in the first place (reportMetaAdsOutcome no-ops otherwise).
    if (lead_quality === 'qualified' && existing.lead_quality !== 'qualified') {
      void reportMetaAdsOutcome({ accountId: ctx.accountId, contactId: lead.contact_id, eventName: 'QualifiedLead' })
    }

    const activities: Array<ReturnType<typeof prisma.leadActivity.create>> = []

    if (autoClaimed) {
      activities.push(
        prisma.leadActivity.create({
          data: {
            account_id: ctx.accountId,
            lead_id: id,
            contact_id: lead.contact_id ?? null,
            user_id: ctx.userId,
            type: 'note',
            title: 'Claimed by working on it',
            description: 'Assigned automatically — this agent was the one who changed it.',
          },
        }),
      )
    }

    // Log status change
    if (status && status !== existing.status) {
      const isReopening = existing.status === 'closed' && status !== 'closed'
      activities.push(
        prisma.leadActivity.create({
          data: {
            account_id: ctx.accountId,
            lead_id: id,
            contact_id: lead.contact_id ?? null,
            user_id: ctx.userId,
            type: isReopening ? 'note' : 'stage_change',
            title: isReopening
              ? 'Lead reopened'
              : `Status: ${status.replace(/_/g, ' ')}`,
            description: isReopening
              ? `Lead was reopened and status set to "${status.replace(/_/g, ' ')}"`
              : `Changed from ${existing.status.replace(/_/g, ' ')} to ${status.replace(/_/g, ' ')}`,
            metadata: { previous_status: existing.status, new_status: status, call_outcome: call_outcome ?? null },
          },
        })
      )
    }

    // Log an optional call note as a separate note activity
    if (call_note?.trim()) {
      activities.push(
        prisma.leadActivity.create({
          data: {
            account_id: ctx.accountId,
            lead_id: id,
            contact_id: lead.contact_id ?? null,
            user_id: ctx.userId,
            type: 'note',
            title: 'Call Note',
            description: call_note.trim(),
          },
        })
      )
    }

    // Log agent assignment change
    if (assigned_to !== undefined && assigned_to !== (existing.assigned_to ?? '')) {
      const newAssignee = assigned_to
        ? await prisma.profile.findUnique({
            where: { user_id: assigned_to },
            select: { full_name: true },
          })
        : null
      activities.push(
        prisma.leadActivity.create({
          data: {
            account_id: ctx.accountId,
            lead_id: id,
            contact_id: lead.contact_id ?? null,
            user_id: ctx.userId,
            type: 'note',
            title: 'Agent changed',
            description: newAssignee?.full_name
              ? `Lead assigned to ${newAssignee.full_name}`
              : assigned_to
                ? 'Lead assigned to agent'
                : 'Lead unassigned',
            metadata: { previous_agent: existing.assigned_to, new_agent: assigned_to || null },
          },
        })
      )
    }

    // Auto-create follow-up when status becomes follow_up
    if (status === 'follow_up' && existing.status !== 'follow_up' && body.due_at) {
      await prisma.followUp.create({
        data: {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          contact_id: lead.contact_id ?? null,
          lead_id: id,
          title: `Follow-up: ${lead.title}`,
          note: body.follow_up_note ?? null,
          due_at: new Date(body.due_at),
          assigned_to: lead.assigned_to ?? ctx.userId,
        },
      })
    }

    if (activities.length) await Promise.all(activities)

    // The chat comes with the lead, however the lead was claimed.
    //
    // The explicit claim path already does this. Without it here, an
    // agent who worked a lead would own the lead but not the
    // conversation — so the assistant would carry on answering their
    // customer on their behalf, which is the exact problem that rule
    // was written to end. Two ways to become the owner, one of which
    // quietly does half the job.
    //
    // Only an unassigned thread is taken, same as there: one a
    // colleague is already in is theirs.
    if (autoClaimed && lead.contact_id) {
      await prisma.conversation
        .updateMany({
          where: {
            account_id: ctx.accountId,
            contact_id: lead.contact_id,
            assigned_agent_id: null,
          },
          data: { assigned_agent_id: ctx.userId },
        })
        .catch((err) =>
          console.error(
            '[leads] auto-claimed, but the conversation could not be assigned:',
            err instanceof Error ? err.message : err,
          ),
        )
    }

    // ── Closing the lead hands the chat back to the assistant ────────
    //
    // Claiming a lead takes the conversation with it — "I am handling
    // this person" — and the assistant stays out of an owned thread.
    // Closing the lead is the same sentence in the past tense, and
    // until now nothing acted on it: the thread stayed owned, the
    // assistant stayed silent, and a customer who wrote again was
    // answered only if that one agent happened to be watching.
    //
    // Only the lead's own owner is released. A colleague who has since
    // taken the chat is handling it for a reason of their own, and one
    // person finishing their paperwork is not a reason to take it off
    // them.
    //
    // Best effort, after the lead is already saved: a conversation that
    // cannot be updated must not fail the close.
    if (status === 'closed' && existing.status !== 'closed' && lead.contact_id) {
      const owner = existing.assigned_to ?? ctx.userId
      await prisma.conversation
        .updateMany({
          where: {
            account_id: ctx.accountId,
            contact_id: lead.contact_id,
            assigned_agent_id: owner,
          },
          data: { assigned_agent_id: null },
        })
        .then(({ count }) => {
          if (count === 0) return
          emitToAccount(ctx.accountId, 'conversation', {
            eventType: 'UPDATE',
            new: { contact_id: lead.contact_id, assigned_agent_id: null },
            old: {},
          })
        })
        .catch((err) =>
          console.error(
            '[leads] closed, but the conversation could not be released:',
            err instanceof Error ? err.message : err,
          ),
        )
    }

    // Broadcast lead update to all connected clients in this account
    emitToAccount(ctx.accountId, 'lead', { eventType: 'UPDATE', new: lead })

    return NextResponse.json({ lead })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const { id } = await params
    const existing = await prisma.lead.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.lead.delete({ where: { id } })

    // Say so, or the screens keep showing it.
    //
    // Creating a lead emitted an event and changing one emitted an
    // event; removing one emitted nothing. So the waiting-leads alert,
    // which builds its list from these, went on offering a lead that no
    // longer existed until somebody reloaded the page — and clicking it
    // led to a 404.
    //
    // `old` carries the row, because `new` has nothing to carry. A
    // listener has to identify what went away, and the id is the whole
    // of what it needs.
    emitToAccount(ctx.accountId, 'lead', {
      eventType: 'DELETE',
      new: null,
      old: { id, assigned_to: existing.assigned_to, status: existing.status },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
