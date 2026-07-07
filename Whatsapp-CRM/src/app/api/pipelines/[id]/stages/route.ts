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

    const lastStage = await prisma.pipelineStage.findFirst({
      where: { pipeline_id },
      orderBy: { position: 'desc' },
    })
    const position = (lastStage?.position ?? -1) + 1

    const stage = await prisma.pipelineStage.create({
      data: { pipeline_id, name, position, color: body.color ?? '#6366f1' },
    })

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
