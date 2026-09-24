import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { canViewAllLeads } from '@/lib/auth/roles'
import { checkOwnedRefs, FOLLOW_UP_STATUSES } from '@/lib/leads/owned-refs'
import { claimIfUnassigned } from '@/lib/leads/claim'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params
    const existing = await prisma.followUp.findFirst({
      where: { id, account_id: ctx.accountId },
      include: { lead: { select: { assigned_to: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Same rule as the Done / Reschedule / Couldn't reach buttons: an
    // agent changes their own follow-ups, their own leads', or ones
    // nobody holds; supervisors and above, any in the account.
    const holder = existing.assigned_to ?? existing.lead?.assigned_to ?? null
    if (holder && holder !== ctx.userId && !canViewAllLeads(ctx.role)) {
      return NextResponse.json({ error: 'This follow-up belongs to another agent' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, note, due_at, status, contact_id, lead_id, assigned_to } = body as Record<string, string | undefined>
    if (status !== undefined && !(FOLLOW_UP_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    if (due_at !== undefined && Number.isNaN(new Date(due_at).getTime())) {
      return NextResponse.json({ error: 'Invalid due_at' }, { status: 400 })
    }
    if ((title !== undefined && (typeof title !== 'string' || title.length > 300)) ||
        (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 2000))) {
      return NextResponse.json({ error: 'Invalid title or note' }, { status: 400 })
    }
    const refProblem = await checkOwnedRefs(ctx.accountId, { contact_id, lead_id, assigned_to })
    if (refProblem) return NextResponse.json({ error: refProblem }, { status: 400 })

    // Editing a call-back on a lead nobody holds is picking it up.
    if (existing.lead_id && !existing.lead?.assigned_to) {
      const claimed = await claimIfUnassigned({
        accountId: ctx.accountId,
        leadId: existing.lead_id,
        userId: ctx.userId,
        how: 'by editing a follow-up',
      })
      // Somebody else picked it in the same moment: it is theirs now.
      if (!claimed && !canViewAllLeads(ctx.role)) {
        const now = await prisma.lead.findFirst({ where: { id: existing.lead_id }, select: { assigned_to: true } })
        if (now?.assigned_to && now.assigned_to !== ctx.userId) {
          return NextResponse.json({ error: 'A colleague has just picked this lead' }, { status: 409 })
        }
      }
    }

    const isCompleting = status === 'done' && existing.status !== 'done'
    const isSkipping   = status === 'skipped' && existing.status !== 'skipped'

    const followUp = await prisma.followUp.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(note !== undefined && { note }),
        ...(due_at !== undefined && { due_at: new Date(due_at) }),
        ...(status !== undefined && { status }),
        ...(contact_id !== undefined && { contact_id: contact_id || null }),
        ...(lead_id !== undefined && { lead_id: lead_id || null }),
        ...(assigned_to !== undefined && { assigned_to: assigned_to || null }),
        ...(isCompleting && { completed_at: new Date() }),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        lead: { select: { id: true, title: true } },
        assignee: { select: { id: true, email: true, profile: { select: { full_name: true } } } },
      },
    })

    // Log to lead timeline when follow-up is completed or skipped
    if ((isCompleting || isSkipping) && followUp.lead_id) {
      await prisma.leadActivity.create({
        data: {
          account_id: ctx.accountId,
          lead_id: followUp.lead_id,
          contact_id: followUp.contact_id ?? null,
          user_id: ctx.userId,
          type: 'follow_up',
          title: isCompleting ? 'Follow-up completed' : 'Follow-up skipped',
          description: followUp.title + (followUp.note ? ` — ${followUp.note}` : ''),
          metadata: { follow_up_id: id, due_at: followUp.due_at, status },
        },
      })
    }

    return NextResponse.json({ followUp })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params
    const existing = await prisma.followUp.findFirst({
      where: { id, account_id: ctx.accountId },
      include: { lead: { select: { assigned_to: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const holder = existing.assigned_to ?? existing.lead?.assigned_to ?? null
    if (holder && holder !== ctx.userId && !canViewAllLeads(ctx.role)) {
      return NextResponse.json({ error: 'This follow-up belongs to another agent' }, { status: 403 })
    }
    await prisma.followUp.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
