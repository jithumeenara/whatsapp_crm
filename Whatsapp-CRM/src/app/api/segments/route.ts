import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')

    const segments = await prisma.segment.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ segments })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { name, description, color, filter_config } = body as Record<string, unknown>
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const segment = await prisma.segment.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name: name as string,
        description: (description as string) ?? null,
        color: (color as string) ?? '#3b82f6',
        filter_config: (filter_config as object) ?? {},
      },
    })

    return NextResponse.json({ segment }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
