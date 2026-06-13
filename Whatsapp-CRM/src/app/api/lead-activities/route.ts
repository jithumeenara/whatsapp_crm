import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

const PAGE_SIZE = 50

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    const { searchParams } = req.nextUrl

    const lead_id = searchParams.get('lead_id')?.trim() ?? ''
    const contact_id = searchParams.get('contact_id')?.trim() ?? ''
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? String(PAGE_SIZE), 10) || PAGE_SIZE))

    const where: Record<string, unknown> = { account_id: ctx.accountId }
    if (lead_id) where.lead_id = lead_id
    if (contact_id) where.contact_id = contact_id

    const [activities, total] = await Promise.all([
      prisma.leadActivity.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: page * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.leadActivity.count({ where }),
    ])

    return NextResponse.json({ activities, total })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { lead_id, contact_id, type, title, description, metadata } = body as Record<string, unknown>
    if (!type || !title) return NextResponse.json({ error: 'type and title are required' }, { status: 400 })

    const activity = await prisma.leadActivity.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        lead_id: (lead_id as string) ?? null,
        contact_id: (contact_id as string) ?? null,
        type: type as string,
        title: title as string,
        description: (description as string) ?? null,
        metadata: (metadata as object) ?? {},
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json({ activity }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
