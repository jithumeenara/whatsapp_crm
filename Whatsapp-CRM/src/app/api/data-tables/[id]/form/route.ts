import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseFormConfig } from '@/lib/data-store/public-form'
import { newFormToken, signPersonalLink } from '@/lib/data-store/public-form-server'
import { ensureDataStoreColumns } from '@/lib/data-store/schema'

/**
 * The table's public form: its settings, its link, and personal links
 * for named customers. Admin-only — switching this on lets anybody with
 * the link write into the table.
 *
 * PUT  { config }                 save settings (a token is minted the
 *                                  first time the form is switched on)
 * POST { action: 'new_link' }     replace the link; the old one stops
 * POST { action: 'personal_link', contact_id }
 *                                  a link that files the answer under
 *                                  that customer
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function findTable(accountId: string, id: string) {
  if (!UUID.test(id)) return null
  return prisma.dataTable.findFirst({
    where: { id, account_id: accountId },
    select: { id: true, form_config: true, form_token: true, fields: { select: { field_key: true } } },
  })
}

function view(table: { id: string; form_config: unknown; form_token: string | null; fields: { field_key: string }[] }, responses: number) {
  return {
    config: parseFormConfig(table.form_config, table.fields.map((f) => f.field_key)),
    path: table.form_token ? `/f/${table.form_token}` : null,
    responses,
  }
}

function countResponses(tableId: string, accountId: string) {
  return prisma.dataRecord.count({ where: { table_id: tableId, account_id: accountId, source: 'web_form' } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    await ensureDataStoreColumns().catch(() => {})
    const table = await findTable(ctx.accountId, id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    return NextResponse.json(view(table, await countResponses(table.id, ctx.accountId)))
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
    if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
    const config = parseFormConfig(body.config, table.fields.map((f) => f.field_key))

    const updated = await prisma.dataTable.update({
      where: { id: table.id },
      data: {
        form_config: config as unknown as Prisma.InputJsonValue,
        ...(config.enabled && !table.form_token ? { form_token: newFormToken() } : {}),
      },
      select: { id: true, form_config: true, form_token: true, fields: { select: { field_key: true } } },
    })
    return NextResponse.json(view(updated, await countResponses(table.id, ctx.accountId)))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    await ensureDataStoreColumns().catch(() => {})
    const table = await findTable(ctx.accountId, id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })

    const body = (await req.json().catch(() => null)) as { action?: string; contact_id?: string } | null

    if (body?.action === 'new_link') {
      const updated = await prisma.dataTable.update({
        where: { id: table.id },
        data: { form_token: newFormToken() },
        select: { id: true, form_config: true, form_token: true, fields: { select: { field_key: true } } },
      })
      return NextResponse.json(view(updated, await countResponses(table.id, ctx.accountId)))
    }

    if (body?.action === 'personal_link') {
      if (!table.form_token) {
        return NextResponse.json({ error: 'Switch the form on first.' }, { status: 400 })
      }
      const contactId = typeof body.contact_id === 'string' && UUID.test(body.contact_id) ? body.contact_id : null
      const contact = contactId
        ? await prisma.contact.findFirst({
            where: { id: contactId, account_id: ctx.accountId },
            select: { id: true, name: true, phone: true },
          })
        : null
      if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
      return NextResponse.json({
        path: `/f/${table.form_token}?c=${encodeURIComponent(signPersonalLink(table.id, contact.id))}`,
        contact,
      })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
