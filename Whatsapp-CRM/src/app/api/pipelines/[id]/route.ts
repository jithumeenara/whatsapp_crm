import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')
    const { id } = await params

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      include: {
        stages: { orderBy: { position: 'asc' } },
        _count: { select: { deals: true } },
      },
    })
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ pipeline })
  } catch (e) {
    return toErrorResponse(e)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const { id } = await params
    const body = await req.json()

    const exists = await prisma.pipeline.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const pipeline = await prisma.pipeline.update({
      where: { id },
      data: { name: body.name ?? undefined },
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { deals: true } } },
    })

    return NextResponse.json({ pipeline })
  } catch (e) {
    return toErrorResponse(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const { id } = await params

    const exists = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, _count: { select: { deals: true } } },
    })
    if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Deleting a pipeline deleted every deal in it, values and all.
    if (exists._count.deals > 0) {
      return NextResponse.json(
        { error: `This pipeline still has ${exists._count.deals} deal${exists._count.deals === 1 ? '' : 's'}. Move or close them first.` },
        { status: 409 },
      )
    }

    await prisma.pipeline.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return toErrorResponse(e)
  }
}
