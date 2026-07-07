import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params
    const existing = await prisma.followUp.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, note, due_at, status, contact_id, lead_id, assigned_to } = body as Record<string, string | undefined>

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
    const existing = await prisma.followUp.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.followUp.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
