import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { blockContact, unblockContact } from '@/lib/whatsapp/spam-guard'

/**
 * POST   /api/contacts/[id]/block — stop responding to this contact.
 * DELETE /api/contacts/[id]/block — start again.
 *
 * Agent-level on purpose. The person being shouted at is the person who
 * should be able to stop it, and a block that needs a manager is one
 * that happens an hour too late. It is fully reversible and records who
 * did it, which is the safeguard that makes the low bar reasonable.
 */

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let accountId: string
  let userId: string
  try {
    const guard = await requireRole('agent')
    accountId = guard.accountId
    userId = guard.userId
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { reason?: string } | null

  const contact = await prisma.contact.findFirst({
    where: { id, account_id: accountId },
    select: { id: true, name: true, phone: true },
  })
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })

  await blockContact({ contactId: id, accountId, userId, reason: body?.reason })
  console.log(`[spam] ${contact.name ?? contact.phone} blocked by a person`)

  return NextResponse.json({ ok: true, blocked: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let accountId: string
  try {
    accountId = (await requireRole('agent')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id } = await params
  const contact = await prisma.contact.findFirst({
    where: { id, account_id: accountId },
    select: { id: true },
  })
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })

  await unblockContact({ contactId: id, accountId })
  return NextResponse.json({ ok: true, blocked: false })
}
