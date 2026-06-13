import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

const PAGE_SIZE = 25

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    const { searchParams } = req.nextUrl

    const status = searchParams.get('status')?.trim() ?? ''
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? String(PAGE_SIZE), 10) || PAGE_SIZE))

    const where: Record<string, unknown> = { account_id: ctx.accountId }
    if (status) where.status = status

    const [followUps, total] = await Promise.all([
      prisma.followUp.findMany({
        where,
        orderBy: { due_at: 'asc' },
        skip: page * limit,
        take: limit,
        include: {
          contact: { select: { id: true, name: true, phone: true, avatar_url: true } },
          lead: { select: { id: true, title: true } },
          assignee: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.followUp.count({ where }),
    ])

    return NextResponse.json({ followUps, total })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, note, due_at, contact_id, lead_id, assigned_to } = body as Record<string, string | undefined>
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (!due_at) return NextResponse.json({ error: 'due_at is required' }, { status: 400 })

    const followUp = await prisma.followUp.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        title,
        note: note ?? null,
        due_at: new Date(due_at),
        contact_id: contact_id ?? null,
        lead_id: lead_id ?? null,
        assigned_to: assigned_to ?? null,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        lead: { select: { id: true, title: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json({ followUp }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
