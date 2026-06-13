import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

async function requireTable(tableId: string) {
  const session = await auth()
  if (!session?.user?.id) return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return { ok: false as const, status: 403, body: { error: 'No account.' } }
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: profile.account_id },
  })
  if (!table) return { ok: false as const, status: 404, body: { error: 'Table not found.' } }
  return { ok: true as const, accountId: profile.account_id, table }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tableId } = await params
    const guard = await requireTable(tableId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const url = new URL(req.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, parseInt(url.searchParams.get('pageSize') ?? '50'))
    const search = url.searchParams.get('search') ?? ''

    const where = { table_id: tableId }

    const [records, total] = await Promise.all([
      prisma.dataRecord.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.dataRecord.count({ where }),
    ])

    // Client-side search filter on JSON data (simple implementation)
    const filtered = search
      ? records.filter((r) => JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase()))
      : records

    return NextResponse.json({ records: filtered, total, page, pageSize })
  } catch (err) {
    console.error('[GET /api/data-tables/[id]/records]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tableId } = await params
    const guard = await requireTable(tableId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const record = await prisma.dataRecord.create({
      data: {
        table_id: tableId,
        account_id: guard.accountId,
        data: body.data ?? {},
      },
    })
    return NextResponse.json({ record }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/data-tables/[id]/records]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
