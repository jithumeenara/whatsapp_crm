import { NextRequest, NextResponse } from 'next/server'
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
      await prisma.$executeRaw`
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE
      `
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
    if (notes !== undefined) data.notes = notes
    if (lead_quality !== undefined) data.lead_quality = lead_quality || null
    if (call_outcome !== undefined) data.call_outcome = call_outcome || null
    if (closing_remarks !== undefined) data.closing_remarks = closing_remarks || null
    if (district !== undefined) data.district = district || null
    if (place !== undefined) data.place = place || null
    if (assigned_to !== undefined) data.assigned_to = assigned_to || null
    if (lost_reason !== undefined) data.lost_reason = lost_reason || null
    if (converted_at !== undefined) data.converted_at = converted_at ? new Date(converted_at) : null

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
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
