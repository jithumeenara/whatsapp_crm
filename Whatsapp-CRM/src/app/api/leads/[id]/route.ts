import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'

async function getLead(id: string, accountId: string) {
  return prisma.lead.findFirst({
    where: { id, account_id: accountId },
    include: {
      contact: { select: { id: true, name: true, phone: true, alternate_phone: true, avatar_url: true } },
      assignee: { select: { id: true, email: true, profile: { select: { full_name: true, avatar_url: true } } } },
      activities: { orderBy: { created_at: 'desc' }, take: 50 },
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
    }

    const isPrivileged = canViewAllLeads(ctx.role)
    const tabStatus = TAB_STATUS_MAP[fromTab]
    const navWhere: Record<string, unknown> = { account_id: ctx.accountId }
    if (tabStatus !== undefined && tabStatus !== null) navWhere.status = tabStatus
    if (fromTab === 'new_pool') {
      navWhere.assigned_to = null
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
