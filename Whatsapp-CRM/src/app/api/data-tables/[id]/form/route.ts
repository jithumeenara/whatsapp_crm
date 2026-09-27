import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseFormConfig } from '@/lib/data-store/public-form'
import {
  describeSources,
  newFormToken,
  rulesWithinSources,
  signPersonalLink,
  type FormSource,
} from '@/lib/data-store/public-form-server'
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

const TABLE_SELECT = {
  id: true,
  form_config: true,
  form_token: true,
  // In the table's order: a rule may only look at an earlier question.
  fields: {
    orderBy: [{ sort_order: 'asc' as const }, { created_at: 'asc' as const }],
    select: { field_key: true, field_type: true, options: true },
  },
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

async function findTable(accountId: string, id: string) {
  if (!UUID.test(id)) return null
  return prisma.dataTable.findFirst({ where: { id, account_id: accountId }, select: TABLE_SELECT })
}

type Row = NonNullable<Awaited<ReturnType<typeof findTable>>>

async function view(accountId: string, table: Row, sources?: FormSource[]) {
  const config = parseFormConfig(table.form_config, table.fields.map((f) => f.field_key))
  const logo = config.brand.logo_file_id
    ? await prisma.fileUpload.findFirst({
        where: { id: config.brand.logo_file_id, account_id: accountId },
        select: { id: true, url: true, original_name: true },
      })
    : null
  return {
    config,
    path: table.form_token ? `/f/${table.form_token}` : null,
    responses: await prisma.dataRecord.count({ where: { table_id: table.id, account_id: accountId, source: 'web_form' } }),
    sources: sources ?? (await describeSources(accountId, table.fields)),
    logo: logo ? { id: logo.id, url: logo.url, name: logo.original_name } : null,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    await ensureDataStoreColumns().catch(() => {})
    const table = await findTable(ctx.accountId, id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    return NextResponse.json(await view(ctx.accountId, table))
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

    // Rules may only use columns the public page is allowed to carry.
    const sources = await describeSources(ctx.accountId, table.fields)
    config.rules = rulesWithinSources(config.rules, sources)

    // The logo must be one of this account's own images — the public
    // page serves it to anybody, so nothing else may be named here.
    if (config.brand.logo_file_id) {
      const logo = await prisma.fileUpload.findFirst({
        where: { id: config.brand.logo_file_id, account_id: ctx.accountId, mime_type: { in: IMAGE_TYPES } },
        select: { id: true, size: true, scan_status: true },
      })
      if (!logo || logo.size > 2 * 1024 * 1024 || logo.scan_status === 'infected') config.brand.logo_file_id = null
    }

    const updated = await prisma.dataTable.update({
      where: { id: table.id },
      data: {
        form_config: config as unknown as Prisma.InputJsonValue,
        ...(config.enabled && !table.form_token ? { form_token: newFormToken() } : {}),
      },
      select: TABLE_SELECT,
    })
    return NextResponse.json(await view(ctx.accountId, updated, sources))
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
        select: TABLE_SELECT,
      })
      return NextResponse.json(await view(ctx.accountId, updated))
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
