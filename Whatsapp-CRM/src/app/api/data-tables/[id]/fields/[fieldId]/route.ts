import { NextResponse } from 'next/server'
import { dataStoreMember } from '@/lib/data-store/access'
import { prisma } from '@/lib/db'
import { invalidateRegistrationForms } from '@/lib/ai/registration'

async function requireField(tableId: string, fieldId: string) {
  const member = await dataStoreMember('supervisor')
  if (!member.ok) return member
  const accountIdOf = member.ctx.accountId
  const field = await prisma.dataField.findFirst({
    where: { id: fieldId, table_id: tableId, account_id: accountIdOf },
  })
  if (!field) return { ok: false as const, status: 404, body: { error: 'Field not found.' } }
  return { ok: true as const, field }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; fieldId: string }> },
) {
  try {
    const { id: tableId, fieldId } = await params
    const guard = await requireField(tableId, fieldId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => ({}))
    const field = await prisma.dataField.update({
      where: { id: fieldId },
      data: {
        ...(body.label ? { label: body.label.trim() } : {}),
        ...(body.field_type ? { field_type: body.field_type } : {}),
        ...(body.options !== undefined ? { options: body.options } : {}),
        ...(body.relation_table_id !== undefined ? { relation_table_id: body.relation_table_id } : {}),
        ...(body.relation_label_field !== undefined ? { relation_label_field: body.relation_label_field } : {}),
        ...(body.required !== undefined ? { required: body.required } : {}),
        ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      },
    })
    // A field becoming Required changes what the assistant asks for,
    // so the cached form definition has to go with it.
    invalidateRegistrationForms(guard.field.account_id)
    return NextResponse.json({ field })
  } catch (err) {
    console.error('[PUT /api/data-tables/[id]/fields/[fieldId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; fieldId: string }> },
) {
  try {
    const { id: tableId, fieldId } = await params
    const guard = await requireField(tableId, fieldId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    await prisma.dataField.delete({ where: { id: fieldId } })
    // A field becoming Required changes what the assistant asks for,
    // so the cached form definition has to go with it.
    invalidateRegistrationForms(guard.field.account_id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/data-tables/[id]/fields/[fieldId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
