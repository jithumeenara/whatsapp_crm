import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.followUp.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, note, due_at, status, contact_id, lead_id, assigned_to } = body as Record<string, string | undefined>

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
        ...(status === 'done' && !existing.completed_at && { completed_at: new Date() }),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        lead: { select: { id: true, title: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json({ followUp })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.followUp.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.followUp.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
