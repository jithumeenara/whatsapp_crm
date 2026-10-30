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

    // stage_type is fixed at creation (exactly one Won + one Lost per
    // pipeline) — only the display name/color/position are editable.
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : undefined
    const color = typeof body.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(body.color) ? body.color : undefined
    const position = Number.isInteger(body.position) ? body.position : undefined

    // The stage must be in the pipeline just checked: updating by its id
    // alone let an admin rename another workspace's stage (A4-05).
    const updated = await prisma.pipelineStage.updateMany({
      where: { id: stageId, pipeline_id: pipeline.id },
      data: { name, color, position },
    })
    if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const stage = await prisma.pipelineStage.findFirst({ where: { id: stageId, pipeline_id: pipeline.id } })

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

    const stage = await prisma.pipelineStage.findFirst({ where: { id: stageId, pipeline_id } })
    if (!stage) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (stage.stage_type === 'won' || stage.stage_type === 'lost') {
      return NextResponse.json(
        { error: `The ${stage.stage_type === 'won' ? 'Won' : 'Lost'} stage can't be deleted — every pipeline needs one of each. Rename it instead.` },
        { status: 400 },
      )
    }

    const openStages = await prisma.pipelineStage.count({ where: { pipeline_id, stage_type: 'open' } })
    if (openStages <= 1) {
      return NextResponse.json(
        { error: 'Every pipeline needs at least one stage before Won/Lost.' },
        { status: 400 },
      )
    }

    // Move deals in this stage to another open stage before deleting — never
    // silently drop them into Won/Lost as a side effect of stage deletion.
    const otherStage = await prisma.pipelineStage.findFirst({
      where: { pipeline_id, id: { not: stageId }, stage_type: 'open' },
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
