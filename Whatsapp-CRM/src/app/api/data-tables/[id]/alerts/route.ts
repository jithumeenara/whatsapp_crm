import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseAlertConfig } from '@/lib/data-store/record-alert'
import { ensureDataStoreColumns } from '@/lib/data-store/schema'

/**
 * Who is told when a new row lands in this table. Admin-only both ways:
 * the settings name staff phone numbers and email addresses, and saving
 * them decides where customers' details get sent.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function findTable(accountId: string, id: string) {
  if (!UUID.test(id)) return null
  return prisma.dataTable.findFirst({
    where: { id, account_id: accountId },
    select: { id: true, alert_config: true, fields: { select: { field_key: true } } },
  })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    await ensureDataStoreColumns().catch(() => {})
    const table = await findTable(ctx.accountId, id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    return NextResponse.json({
      config: parseAlertConfig(table.alert_config, table.fields.map((f) => f.field_key)),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    await ensureDataStoreColumns().catch(() => {})
    const table = await findTable(ctx.accountId, id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })

    const body = (await req.json().catch(() => null)) as { config?: unknown } | null
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })

    const config = parseAlertConfig(body.config, table.fields.map((f) => f.field_key))

    // Only people who are members of this account. An id from another
    // account would otherwise receive this account's customers' details
    // on their phone.
    if (config.push_user_ids.length > 0) {
      const members = await prisma.profile.findMany({
        where: { account_id: ctx.accountId, user_id: { in: config.push_user_ids } },
        select: { user_id: true },
      })
      const ok = new Set(members.map((m) => m.user_id))
      config.push_user_ids = config.push_user_ids.filter((u) => ok.has(u))
    }

    await prisma.dataTable.update({
      where: { id: table.id },
      data: { alert_config: config as unknown as Prisma.InputJsonValue },
    })
    return NextResponse.json({ config })
  } catch (err) {
    return toErrorResponse(err)
  }
}
