import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const { id: pipeline_id } = await params
    const body = await req.json()

    const pipeline = await prisma.pipeline.findFirst({ where: { id: pipeline_id, account_id: ctx.accountId } })
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    // New stages are always 'open' — Won/Lost are pinned, exactly one of
    // each, and only created alongside the pipeline itself. Insert this one
    // right before the first close stage so open stages always lead and
    // Won/Lost always stay last.
    const stages = await prisma.pipelineStage.findMany({
      where: { pipeline_id },
      orderBy: { position: 'asc' },
    })
    const firstCloseIdx = stages.findIndex((s) => s.stage_type !== 'open')
    const insertPosition = firstCloseIdx === -1 ? stages.length : stages[firstCloseIdx].position

    const [stage] = await prisma.$transaction([
      prisma.pipelineStage.create({
        data: { pipeline_id, name, position: insertPosition, color: body.color ?? '#6366f1', stage_type: 'open' },
      }),
      ...stages
        .filter((s) => s.position >= insertPosition)
        .map((s) => prisma.pipelineStage.update({ where: { id: s.id }, data: { position: s.position + 1 } })),
    ])

    return NextResponse.json({ stage }, { status: 201 })
  } catch (e) {
    return toErrorResponse(e)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const { id: pipeline_id } = await params
    const body = await req.json()

    const pipeline = await prisma.pipeline.findFirst({ where: { id: pipeline_id, account_id: ctx.accountId } })
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Reorder: body.order = [{ id, position }]
    if (Array.isArray(body.order)) {
      await Promise.all(
        body.order.map((item: { id: string; position: number }) =>
          prisma.pipelineStage.updateMany({
            where: { id: item.id, pipeline_id },
            data: { position: item.position },
          })
        )
      )
    }

    const stages = await prisma.pipelineStage.findMany({
      where: { pipeline_id },
      orderBy: { position: 'asc' },
    })

    return NextResponse.json({ stages })
  } catch (e) {
    return toErrorResponse(e)
  }
}
