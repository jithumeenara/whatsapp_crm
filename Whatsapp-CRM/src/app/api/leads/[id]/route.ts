import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

async function getLead(id: string, accountId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id, account_id: accountId },
    include: {
      contact: { select: { id: true, name: true, phone: true, avatar_url: true } },
      assignee: { select: { id: true, name: true, email: true } },
      activities: { orderBy: { created_at: 'desc' }, take: 50 },
      follow_ups: { orderBy: { due_at: 'asc' } },
      tasks: { orderBy: { due_date: 'asc' } },
    },
  })
  return lead
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params
    const lead = await getLead(id, ctx.accountId)
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ lead })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.lead.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, contact_id, source, status, score, notes, assigned_to, lost_reason, converted_at } =
      body as Record<string, string | undefined>

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(contact_id !== undefined && { contact_id: contact_id || null }),
        ...(source !== undefined && { source }),
        ...(status !== undefined && { status }),
        ...(score !== undefined && { score }),
        ...(notes !== undefined && { notes }),
        ...(assigned_to !== undefined && { assigned_to: assigned_to || null }),
        ...(lost_reason !== undefined && { lost_reason }),
        ...(converted_at !== undefined && { converted_at: converted_at ? new Date(converted_at) : null }),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    })

    // Log status change activity
    if (status && status !== existing.status) {
      await prisma.leadActivity.create({
        data: {
          account_id: ctx.accountId,
          lead_id: id,
          contact_id: lead.contact_id ?? null,
          user_id: ctx.userId,
          type: 'stage_change',
          title: `Status changed to ${status}`,
          description: `Status changed from ${existing.status} to ${status}`,
        },
      })
    }

    return NextResponse.json({ lead })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.lead.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.lead.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
