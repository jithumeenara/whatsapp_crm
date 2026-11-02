import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { buildContactWhere, type FilterConfig } from '@/lib/segments/filter'
import { audit, auditCtx } from '@/lib/audit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params
    const { searchParams } = req.nextUrl
    const resolveContacts = searchParams.get('contacts') === '1'

    const segment = await prisma.segment.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!resolveContacts) return NextResponse.json({ segment })

    const config = segment.filter_config as FilterConfig
    const where = buildContactWhere(config, ctx.accountId)
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 }),
      prisma.contact.count({ where }),
    ])

    return NextResponse.json({ segment, contacts, total })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.segment.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { name, description, color, filter_config } = body as Record<string, unknown>

    const data = {
        ...(name !== undefined && { name: name as string }),
        ...(description !== undefined && { description: (description as string) || null }),
        ...(color !== undefined && { color: color as string }),
        ...(filter_config !== undefined && { filter_config: filter_config as object }),
    }
    const segment = await prisma.segment.update({ where: { id }, data })

    await audit(auditCtx(req, ctx), {
      action: 'record.updated',
      target: { type: 'segment', id, label: segment.name },
      before: existing as unknown as Record<string, unknown>,
      after: data,
    })

    return NextResponse.json({ segment })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.segment.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.segment.delete({ where: { id } })
    await audit(auditCtx(req, ctx), { action: 'record.deleted', target: { type: 'segment', id, label: existing.name } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
