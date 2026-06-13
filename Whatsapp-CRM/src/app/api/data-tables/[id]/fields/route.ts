import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { slugify } from '@/lib/data-store/slugify'

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tableId } = await params
    const guard = await requireTable(tableId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body?.label?.trim()) return NextResponse.json({ error: 'label is required' }, { status: 400 })
    if (!body?.field_type) return NextResponse.json({ error: 'field_type is required' }, { status: 400 })

    const baseKey = slugify(body.label.trim()).replace(/-/g, '_') || 'field'
    const existing = await prisma.dataField.findMany({
      where: { table_id: tableId, field_key: { startsWith: baseKey } },
      select: { field_key: true },
    })
    const keys = new Set(existing.map((f) => f.field_key))
    let fieldKey = baseKey
    let i = 2
    while (keys.has(fieldKey)) { fieldKey = `${baseKey}_${i++}` }

    const maxOrder = await prisma.dataField.aggregate({
      where: { table_id: tableId },
      _max: { sort_order: true },
    })

    const field = await prisma.dataField.create({
      data: {
        table_id: tableId,
        account_id: guard.accountId,
        label: body.label.trim(),
        field_key: fieldKey,
        field_type: body.field_type,
        options: body.options ?? null,
        relation_table_id: body.relation_table_id ?? null,
        relation_label_field: body.relation_label_field ?? null,
        required: body.required ?? false,
        sort_order: (maxOrder._max.sort_order ?? -1) + 1,
      },
    })
    return NextResponse.json({ field }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/data-tables/[id]/fields]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
