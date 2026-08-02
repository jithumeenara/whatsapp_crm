import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.deal.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Moving a deal into a Won/Lost stage marks it won/lost; moving it back
    // into an open stage reopens it — unless the caller explicitly passed
    // its own status. This is what makes dragging a deal into the Won/Lost
    // column on the board actually close it.
    let status = body.status ?? undefined
    if (status === undefined && body.stage_id && body.stage_id !== existing.stage_id) {
      const targetStage = await prisma.pipelineStage.findFirst({ where: { id: body.stage_id, pipeline_id: existing.pipeline_id } })
      if (targetStage) status = targetStage.stage_type
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: {
        stage_id:            body.stage_id            ?? undefined,
        title:               body.title               ?? undefined,
        value:               body.value               ?? undefined,
        currency:            body.currency            ?? undefined,
        notes:               body.notes               ?? undefined,
        expected_close_date: body.expected_close_date ? new Date(body.expected_close_date) : undefined,
        status,
        assigned_to:         body.assigned_to         ?? undefined,
        contact_id:          body.contact_id          ?? undefined,
      },
      include: {
        stage:   { select: { id: true, name: true, color: true } },
        contact: { select: { id: true, name: true, phone: true } },
        lead:    { select: { id: true, title: true, score: true, status: true } },
      },
    })

    return NextResponse.json({ deal })
  } catch (e) {
    return toErrorResponse(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params

    const existing = await prisma.deal.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.deal.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return toErrorResponse(e)
  }
}
