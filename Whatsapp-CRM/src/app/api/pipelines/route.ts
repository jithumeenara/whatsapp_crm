import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')

    const pipelines = await prisma.pipeline.findMany({
      where: { account_id: ctx.accountId },
      include: {
        stages: { orderBy: { position: 'asc' } },
        _count: { select: { deals: true } },
      },
      orderBy: { created_at: 'asc' },
    })

    return NextResponse.json({ pipelines })
  } catch (e) {
    return toErrorResponse(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const body = await req.json()
    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const pipeline = await prisma.pipeline.create({
      data: { account_id: ctx.accountId, user_id: ctx.userId, name },
      include: { stages: true, _count: { select: { deals: true } } },
    })

    // Create default stages
    const defaultStages = body.stages ?? ['New', 'In Progress', 'Won', 'Lost']
    await prisma.pipelineStage.createMany({
      data: defaultStages.map((name: string, i: number) => ({
        pipeline_id: pipeline.id,
        name,
        position: i,
        color: ['#6366f1', '#f59e0b', '#10b981', '#f43f5e'][i] ?? '#6366f1',
      })),
    })

    const full = await prisma.pipeline.findUnique({
      where: { id: pipeline.id },
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { deals: true } } },
    })

    return NextResponse.json({ pipeline: full }, { status: 201 })
  } catch (e) {
    return toErrorResponse(e)
  }
}
