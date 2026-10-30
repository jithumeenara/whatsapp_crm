import { NextRequest, NextResponse } from 'next/server'
import { isOneOf, TASK_PRIORITIES, TASK_STATUSES } from '@/lib/status-lists'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { withCallablePhones } from '@/lib/contacts/callable'
import { prisma } from '@/lib/db'
import { checkOwnedRefs } from '@/lib/leads/owned-refs'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.task.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, description, priority, status, due_date, contact_id, lead_id, assigned_to } =
      body as Record<string, string | undefined>
    if (status !== undefined && !isOneOf(TASK_STATUSES, status)) {
      return NextResponse.json({ error: `status must be one of: ${TASK_STATUSES.join(', ')}` }, { status: 400 })
    }
    if (priority !== undefined && !isOneOf(TASK_PRIORITIES, priority)) {
      return NextResponse.json({ error: `priority must be one of: ${TASK_PRIORITIES.join(', ')}` }, { status: 400 })
    }

    const refProblem = await checkOwnedRefs(ctx.accountId, { contact_id, lead_id, assigned_to })
    if (refProblem) return NextResponse.json({ error: refProblem }, { status: 400 })

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(priority !== undefined && { priority }),
        ...(status !== undefined && { status }),
        ...(due_date !== undefined && { due_date: due_date ? new Date(due_date) : null }),
        ...(contact_id !== undefined && { contact_id: contact_id || null }),
        ...(lead_id !== undefined && { lead_id: lead_id || null }),
        ...(assigned_to !== undefined && { assigned_to: assigned_to || null }),
        ...(status === 'done' && !existing.completed_at && { completed_at: new Date() }),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, alternate_phone: true } },
        lead: { select: { id: true, title: true } },
        assignee: { select: { id: true, email: true, profile: { select: { full_name: true } } } },
      },
    })

    return NextResponse.json(withCallablePhones({ task }))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.task.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.task.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
