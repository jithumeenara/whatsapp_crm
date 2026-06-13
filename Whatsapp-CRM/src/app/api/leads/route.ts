import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

const PAGE_SIZE = 25

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    const { searchParams } = req.nextUrl

    const search = searchParams.get('search')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const score = searchParams.get('score')?.trim() ?? ''
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? String(PAGE_SIZE), 10) || PAGE_SIZE))

    const where: Record<string, unknown> = { account_id: ctx.accountId }
    if (status) where.status = status
    if (score) where.score = score
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { contact: { name: { contains: search, mode: 'insensitive' } } },
        { contact: { phone: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: page * limit,
        take: limit,
        include: {
          contact: { select: { id: true, name: true, phone: true, avatar_url: true } },
          assignee: { select: { id: true, name: true, email: true } },
          _count: { select: { activities: true, follow_ups: true, tasks: true } },
        },
      }),
      prisma.lead.count({ where }),
    ])

    return NextResponse.json({ leads, total })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, contact_id, source, status, score, notes, assigned_to } = body as Record<string, string | undefined>
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })

    const lead = await prisma.lead.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        title,
        contact_id: contact_id ?? null,
        source: source ?? 'manual',
        status: status ?? 'new',
        score: score ?? 'warm',
        notes: notes ?? null,
        assigned_to: assigned_to ?? null,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    })

    // Log activity
    await prisma.leadActivity.create({
      data: {
        account_id: ctx.accountId,
        lead_id: lead.id,
        contact_id: lead.contact_id ?? null,
        user_id: ctx.userId,
        type: 'created',
        title: 'Lead created',
        description: `Lead "${lead.title}" was created`,
      },
    })

    return NextResponse.json({ lead }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
