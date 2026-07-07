import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { verifyApiKey } from '@/lib/auth/api-key'
import { dispatchWebhooks } from '@/lib/webhooks/deliver'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

async function requireRecord(req: Request, tableId: string, recordId: string): Promise<
  | { ok: true; accountId: string; tableName: string }
  | { ok: false; status: number; body: { error: string } }
> {
  const authHeader = req.headers.get('authorization') ?? ''
  let accountId: string | null = null

  if (authHeader.startsWith('Bearer wcrm_')) {
    const raw = authHeader.slice('Bearer '.length)
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

  const record = await prisma.dataRecord.findFirst({
    where: { id: recordId, table_id: tableId, account_id: accountId },
    select: { id: true },
  })
  if (!record) return { ok: false, status: 404, body: { error: 'Record not found.' } }

  const table = await prisma.dataTable.findUnique({
    where: { id: tableId },
    select: { name: true },
  })

  return { ok: true, accountId, tableName: table?.name ?? '' }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id: tableId, recordId } = await params
    const guard = await requireRecord(req, tableId, recordId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })

    const record = await prisma.dataRecord.update({
      where: { id: recordId },
      data: { data: body.data ?? {} },
    })

    dispatchWebhooks(guard.accountId, 'record.updated', tableId, {
      id: record.id,
      data: record.data as Record<string, unknown>,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
    }, guard.tableName)

    return NextResponse.json({ record })
  } catch (err) {
    console.error('[PUT /api/data-tables/[id]/records/[recordId]]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id: tableId, recordId } = await params
    const guard = await requireRecord(req, tableId, recordId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    // Capture record data before deleting so the webhook payload is complete
    const record = await prisma.dataRecord.findUnique({ where: { id: recordId } })

    await prisma.dataRecord.delete({ where: { id: recordId } })

    if (record) {
      dispatchWebhooks(guard.accountId, 'record.deleted', tableId, {
        id: record.id,
        data: record.data as Record<string, unknown>,
        created_at: record.created_at.toISOString(),
        updated_at: record.updated_at.toISOString(),
      }, guard.tableName)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/data-tables/[id]/records/[recordId]]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
