import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { cleanPerson, findPerson } from '@/lib/contacts/people'

/**
 * /api/contacts/[id]/people/[personId]
 *   PATCH  (agent+)  rename / edit ONE person — never the others on the number
 *   DELETE (agent+)  remove a person; refused while any lead is for them
 *                    (rename instead), so no lead silently loses its person
 * The person is loaded with the workspace id AND the contact id.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ctx = { params: Promise<{ id: string; personId: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id, personId } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Person not found.' }, { status: 404 })
    const person = await findPerson(ctx.accountId, id, personId)
    if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 })
    const cleaned = cleanPerson(await req.json().catch(() => null), false)
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 })
    if (Object.keys(cleaned.value).length === 0) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
    const updated = await prisma.contactPerson.update({ where: { id: person.id }, data: cleaned.value })
    await audit(auditCtx(req, ctx), { action: 'record.updated', target: { type: 'contact_person', id: person.id, label: null }, meta: { contact_id: id, fields: Object.keys(cleaned.value) } })
    return NextResponse.json({ person: { id: updated.id, name: updated.name, relation: updated.relation, age: updated.age, gender: updated.gender, address: updated.address } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id, personId } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Person not found.' }, { status: 404 })
    const person = await findPerson(ctx.accountId, id, personId)
    if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 })
    const leads = await prisma.lead.count({ where: { account_id: ctx.accountId, person_id: person.id } })
    if (leads > 0) {
      return NextResponse.json({ error: `This person has ${leads} lead${leads === 1 ? '' : 's'}. Rename them instead, or move the lead${leads === 1 ? '' : 's'} first.` }, { status: 409 })
    }
    await prisma.contactPerson.delete({ where: { id: person.id } })
    await audit(auditCtx(req, ctx), { action: 'record.deleted', target: { type: 'contact_person', id: person.id, label: null }, meta: { contact_id: id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
