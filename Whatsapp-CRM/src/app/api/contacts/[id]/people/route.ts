import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { cleanPerson, createPerson, type PersonFields } from '@/lib/contacts/people'

/**
 * /api/contacts/[id]/people — the people booked through this phone number.
 *   GET   (viewer+)  the list, with how many leads each has
 *   POST  (agent+)   { name, relation?, age?, gender?, address? } add one
 * Only this workspace's contact (loaded with the account id).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PEOPLE = 50

async function ownedContact(accountId: string, id: string) {
  if (!UUID.test(id)) return null
  return prisma.contact.findFirst({ where: { id, account_id: accountId }, select: { id: true } })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')
    const { id } = await params
    const contact = await ownedContact(ctx.accountId, id)
    if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    const people = await prisma.contactPerson.findMany({
      where: { account_id: ctx.accountId, contact_id: contact.id },
      orderBy: { created_at: 'asc' },
      select: { id: true, name: true, relation: true, age: true, gender: true, address: true, _count: { select: { leads: true } } },
    })
    return NextResponse.json({
      people: people.map(({ _count, ...p }) => ({ ...p, leads: _count.leads })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params
    const contact = await ownedContact(ctx.accountId, id)
    if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    const cleaned = cleanPerson(await req.json().catch(() => null), true)
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 })
    const count = await prisma.contactPerson.count({ where: { account_id: ctx.accountId, contact_id: contact.id } })
    if (count >= MAX_PEOPLE) return NextResponse.json({ error: `A number can have at most ${MAX_PEOPLE} people.` }, { status: 400 })
    const person = await createPerson(ctx.accountId, contact.id, ctx.userId, cleaned.value as PersonFields & { name: string })
    await audit(auditCtx(req, ctx), { action: 'record.created', target: { type: 'contact_person', id: person.id, label: null }, meta: { contact_id: contact.id } })
    return NextResponse.json({ person: { id: person.id, name: person.name, relation: person.relation, age: person.age, gender: person.gender, address: person.address, leads: 0 } }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
