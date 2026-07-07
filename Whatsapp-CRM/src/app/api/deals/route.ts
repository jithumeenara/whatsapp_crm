import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')
    const { searchParams } = req.nextUrl

    const pipeline_id = searchParams.get('pipeline_id') ?? undefined
    const stage_id    = searchParams.get('stage_id')    ?? undefined
    const status      = searchParams.get('status')      ?? undefined

    const deals = await prisma.deal.findMany({
      where: {
        account_id:  ctx.accountId,
        pipeline_id: pipeline_id ?? undefined,
        stage_id:    stage_id    ?? undefined,
        status:      status      ?? undefined,
      },
      include: {
        stage:   { select: { id: true, name: true, color: true } },
        contact: { select: { id: true, name: true, phone: true } },
        lead:    { select: { id: true, title: true, score: true, status: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ deals })
  } catch (e) {
    return toErrorResponse(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const body = await req.json()

    const title = (body.title ?? '').trim()
    if (!title)              return NextResponse.json({ error: 'title required' },       { status: 400 })
    if (!body.pipeline_id)   return NextResponse.json({ error: 'pipeline_id required' }, { status: 400 })
    if (!body.stage_id)      return NextResponse.json({ error: 'stage_id required' },    { status: 400 })

    // Verify pipeline belongs to account
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: body.pipeline_id, account_id: ctx.accountId },
    })
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const deal = await prisma.deal.create({
      data: {
        account_id:          ctx.accountId,
        user_id:             ctx.userId,
        pipeline_id:         body.pipeline_id,
        stage_id:            body.stage_id,
        contact_id:          body.contact_id   ?? null,
        lead_id:             body.lead_id      ?? null,
        conversation_id:     body.conversation_id ?? null,
        assigned_to:         body.assigned_to  ?? null,
        title,
        value:               body.value ?? 0,
        currency:            body.currency ?? 'USD',
        notes:               body.notes ?? null,
        expected_close_date: body.expected_close_date ? new Date(body.expected_close_date) : null,
        status:              'open',
      },
      include: {
        stage:   { select: { id: true, name: true, color: true } },
        contact: { select: { id: true, name: true, phone: true } },
        lead:    { select: { id: true, title: true, score: true, status: true } },
      },
    })

    return NextResponse.json({ deal }, { status: 201 })
  } catch (e) {
    return toErrorResponse(e)
  }
}
