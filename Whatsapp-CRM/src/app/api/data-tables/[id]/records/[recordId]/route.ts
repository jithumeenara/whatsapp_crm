import { NextResponse } from 'next/server'
import { scheduleKnowledgeRefresh } from '@/lib/ai/knowledge-refresh'
import { afterRecordsChanged } from '@/lib/data-store/record-events'
import { dataStoreMember } from '@/lib/data-store/access'
import { prisma } from '@/lib/db'
import { verifyApiKey } from '@/lib/auth/api-key'
import { dispatchWebhooks } from '@/lib/webhooks/deliver'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { checkRecordData } from '@/lib/data-store/record-data'
import { audit, auditCtx } from '@/lib/audit'
import { changedRecordFields, recordFieldNames } from '@/lib/data-store/audit-fields'

interface Actor { accountId: string; userId: string; role: string; apiKeyId?: string }

async function requireRecord(req: Request, tableId: string, recordId: string): Promise<
  | { ok: true; accountId: string; tableName: string; actor: Actor; data: unknown }
  | { ok: false; status: number; body: { error: string } }
> {
  const authHeader = req.headers.get('authorization') ?? ''
  let accountId: string | null = null
  let actor: Actor

  if (authHeader.startsWith('Bearer wcrm_')) {
    const raw = authHeader.slice('Bearer '.length)
    const keyPrefix = raw.slice(0, 12)
    const isWrite = req.method !== 'GET'
    const rl = checkRateLimit(`api:${keyPrefix}`, isWrite ? RATE_LIMITS.apiWrite : RATE_LIMITS.apiRead)
    if (!rl.success) return { ok: false, status: 429, body: { error: 'Rate limit exceeded.' } }

    const result = await verifyApiKey(raw)
    if (!result) return { ok: false, status: 401, body: { error: 'Invalid API key.' } }
    accountId = result.accountId
    actor = { accountId: result.accountId, userId: result.creatorUserId, role: 'supervisor', apiKeyId: result.keyId }
  } else {
    const member = await dataStoreMember('agent')
    if (!member.ok) return member
    const accountIdOf = member.ctx.accountId
    accountId = accountIdOf
    actor = { accountId: accountIdOf, userId: member.ctx.userId, role: member.ctx.role }
  }

  const record = await prisma.dataRecord.findFirst({
    where: { id: recordId, table_id: tableId, account_id: accountId },
    select: { id: true, data: true },
  })
  if (!record) return { ok: false, status: 404, body: { error: 'Record not found.' } }

  const table = await prisma.dataTable.findUnique({
    where: { id: tableId },
    select: { name: true },
  })

  return { ok: true, accountId, tableName: table?.name ?? '', actor, data: record.data }
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
    const fieldTypes = await prisma.dataField.findMany({
      where: { table_id: tableId, account_id: guard.accountId },
      select: { field_key: true, field_type: true },
    })
    const checked = checkRecordData(body.data, fieldTypes)
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

    const record = await prisma.dataRecord.update({
      where: { id: recordId },
      data: { data: checked.data as never },
    })
    scheduleKnowledgeRefresh(guard.accountId, tableId)
    afterRecordsChanged(tableId, guard.accountId)

    dispatchWebhooks(guard.accountId, 'record.updated', tableId, {
      id: record.id,
      data: record.data as Record<string, unknown>,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
    }, guard.tableName)

    // Field NAMES only — never the values (registrations, IDs, bank details).
    await audit(auditCtx(req, guard.actor), {
      action: 'record.updated',
      target: { type: 'data_record', id: record.id, label: guard.tableName },
      changes: null,
      meta: { table_id: tableId, fields: changedRecordFields(guard.data, checked.data) },
    })

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
    scheduleKnowledgeRefresh(guard.accountId, tableId)
    afterRecordsChanged(tableId, guard.accountId)

    if (record) {
      dispatchWebhooks(guard.accountId, 'record.deleted', tableId, {
        id: record.id,
        data: record.data as Record<string, unknown>,
        created_at: record.created_at.toISOString(),
        updated_at: record.updated_at.toISOString(),
      }, guard.tableName)
    }

    await audit(auditCtx(req, guard.actor), {
      action: 'record.deleted',
      target: { type: 'data_record', id: recordId, label: guard.tableName },
      changes: null,
      meta: { table_id: tableId, fields: recordFieldNames(guard.data) },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/data-tables/[id]/records/[recordId]]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
