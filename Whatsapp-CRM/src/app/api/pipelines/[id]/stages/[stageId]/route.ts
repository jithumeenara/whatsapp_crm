import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> }
) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const { id: pipeline_id, stageId } = await params
    const body = await req.json()

    const pipeline = await prisma.pipeline.findFirst({ where: { id: pipeline_id, account_id: ctx.accountId } })
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const stage = await prisma.pipelineStage.update({
      where: { id: stageId },
      data: {
        name:     body.name     ?? undefined,
        color:    body.color    ?? undefined,
        position: body.position ?? undefined,
      },
    })

    return NextResponse.json({ stage })
  } catch (e) {
    return toErrorResponse(e)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> }
) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const { id: pipeline_id, stageId } = await params

    const pipeline = await prisma.pipeline.findFirst({ where: { id: pipeline_id, account_id: ctx.accountId } })
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Move deals in this stage to the first other stage before deleting
    const otherStage = await prisma.pipelineStage.findFirst({
      where: { pipeline_id, id: { not: stageId } },
      orderBy: { position: 'asc' },
    })
    if (otherStage) {
      await prisma.deal.updateMany({ where: { stage_id: stageId }, data: { stage_id: otherStage.id } })
    }

    await prisma.pipelineStage.delete({ where: { id: stageId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return toErrorResponse(e)
  }
}
