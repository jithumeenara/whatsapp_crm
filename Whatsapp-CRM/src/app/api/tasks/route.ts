import { NextRequest, NextResponse } from 'next/server'
import { isOneOf, TASK_PRIORITIES, TASK_STATUSES } from '@/lib/status-lists'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { withCallablePhones } from '@/lib/contacts/callable'
import { prisma } from '@/lib/db'
import { checkOwnedRefs } from '@/lib/leads/owned-refs'

const PAGE_SIZE = 25

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    const { searchParams } = req.nextUrl

    const status = searchParams.get('status')?.trim() ?? ''
    const priority = searchParams.get('priority')?.trim() ?? ''
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? String(PAGE_SIZE), 10) || PAGE_SIZE))

    const where: Record<string, unknown> = { account_id: ctx.accountId }
    if (status) where.status = status
    if (priority) where.priority = priority

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ due_date: 'asc' }, { created_at: 'desc' }],
        skip: page * limit,
        take: limit,
        include: {
          contact: { select: { id: true, name: true, phone: true, alternate_phone: true, avatar_url: true } },
          lead: { select: { id: true, title: true } },
          assignee: { select: { id: true, email: true, profile: { select: { full_name: true } } } },
        },
      }),
      prisma.task.count({ where }),
    ])

    return NextResponse.json(withCallablePhones({ tasks, total }))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { title, description, priority, status, due_date, contact_id, lead_id, assigned_to } =
      body as Record<string, string | undefined>
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (status !== undefined && !isOneOf(TASK_STATUSES, status)) {
      return NextResponse.json({ error: `status must be one of: ${TASK_STATUSES.join(', ')}` }, { status: 400 })
    }
    if (priority !== undefined && !isOneOf(TASK_PRIORITIES, priority)) {
      return NextResponse.json({ error: `priority must be one of: ${TASK_PRIORITIES.join(', ')}` }, { status: 400 })
    }

    const refProblem = await checkOwnedRefs(ctx.accountId, { contact_id, lead_id, assigned_to })
    if (refProblem) return NextResponse.json({ error: refProblem }, { status: 400 })

    const task = await prisma.task.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        title,
        description: description ?? null,
        priority: priority ?? 'medium',
        status: status ?? 'todo',
        due_date: due_date ? new Date(due_date) : null,
        contact_id: contact_id ?? null,
        lead_id: lead_id ?? null,
        assigned_to: assigned_to ?? null,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, alternate_phone: true } },
        lead: { select: { id: true, title: true } },
        assignee: { select: { id: true, email: true, profile: { select: { full_name: true } } } },
      },
    })

    return NextResponse.json(withCallablePhones({ task }), { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
