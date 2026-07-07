import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { verifyApiKey } from '@/lib/auth/api-key'
import { dispatchWebhooks } from '@/lib/webhooks/deliver'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

async function requireTable(req: Request, tableId: string): Promise<
  | { ok: true; accountId: string; tableName: string }
  | { ok: false; status: number; body: { error: string } }
> {
  // Accept session OR Bearer API key
  const authHeader = req.headers.get('authorization') ?? ''
  let accountId: string | null = null

  if (authHeader.startsWith('Bearer wcrm_')) {
    const raw = authHeader.slice('Bearer '.length)
    // Rate-limit API key requests
    const keyPrefix = raw.slice(0, 12)
    const isWrite = req.method !== 'GET'
    const rl = checkRateLimit(`api:${keyPrefix}`, isWrite ? RATE_LIMITS.apiWrite : RATE_LIMITS.apiRead)
    if (!rl.success) return { ok: false, status: 429, body: { error: 'Rate limit exceeded.' } }

    const result = await verifyApiKey(raw)
    if (!result) return { ok: false, status: 401, body: { error: 'Invalid API key.' } }
    accountId = result.accountId
  } else {
    const session = await auth()
    if (!session?.user?.id) return { ok: false, status: 401, body: { error: 'Unauthorized.' } }
    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    if (!profile?.account_id) return { ok: false, status: 403, body: { error: 'No account.' } }
    accountId = profile.account_id
  }

  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: accountId },
    select: { id: true, name: true },
  })
  if (!table) return { ok: false, status: 404, body: { error: 'Table not found.' } }
  return { ok: true, accountId, tableName: table.name }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tableId } = await params
    const guard = await requireTable(req, tableId)
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

    const filtered = search
      ? records.filter((r) => JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase()))
      : records

    return NextResponse.json({ records: filtered, total, page, pageSize })
  } catch (err) {
    console.error('[GET /api/data-tables/[id]/records]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tableId } = await params
    const guard = await requireTable(req, tableId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })

    const record = await prisma.dataRecord.create({
      data: {
        table_id: tableId,
        account_id: guard.accountId,
        data: body.data ?? {},
      },
    })

    dispatchWebhooks(guard.accountId, 'record.created', tableId, {
      id: record.id,
      data: record.data as Record<string, unknown>,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
    }, guard.tableName)

    return NextResponse.json({ record }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/data-tables/[id]/records]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
