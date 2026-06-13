import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'

type FilterRule = { field: string; op: string; value: string }
type FilterConfig = { match?: 'all' | 'any'; rules?: FilterRule[] }

function buildContactWhere(config: FilterConfig, accountId: string): Prisma.ContactWhereInput {
  const { match = 'all', rules = [] } = config
  const clauses: Prisma.ContactWhereInput[] = rules.map((rule) => {
    const { field, op, value } = rule
    switch (op) {
      case 'contains':
        return { [field]: { contains: value, mode: 'insensitive' } }
      case 'not_contains':
        return { NOT: { [field]: { contains: value, mode: 'insensitive' } } }
      case 'equals':
        return { [field]: { equals: value, mode: 'insensitive' } }
      case 'not_equals':
        return { NOT: { [field]: { equals: value, mode: 'insensitive' } } }
      case 'starts_with':
        return { [field]: { startsWith: value, mode: 'insensitive' } }
      case 'is_empty':
        return { OR: [{ [field]: null }, { [field]: '' }] }
      case 'is_not_empty':
        return { AND: [{ NOT: { [field]: null } }, { NOT: { [field]: '' } }] }
      default:
        return {}
    }
  })

  return {
    account_id: accountId,
    ...(clauses.length > 0 ? (match === 'all' ? { AND: clauses } : { OR: clauses }) : {}),
  }
}

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

    const segment = await prisma.segment.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name as string }),
        ...(description !== undefined && { description: (description as string) || null }),
        ...(color !== undefined && { color: color as string }),
        ...(filter_config !== undefined && { filter_config: filter_config as object }),
      },
    })

    return NextResponse.json({ segment })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await prisma.segment.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.segment.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
