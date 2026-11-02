import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { blockContact, unblockContact } from '@/lib/whatsapp/spam-guard'
import { audit, auditCtx } from '@/lib/audit'

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
  let guard: Awaited<ReturnType<typeof requireRole>>
  try {
    guard = await requireRole('agent')
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
  await audit(auditCtx(request, guard), {
    action: 'record.updated',
    target: { type: 'contact', id, label: null },
    after: { blocked: true },
    before: { blocked: false },
    // The reason is free text a person typed; only its length is kept.
    meta: { op: 'block', reason_chars: typeof body?.reason === 'string' ? body.reason.length : 0 },
  })

  return NextResponse.json({ ok: true, blocked: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let accountId: string
  let guard: Awaited<ReturnType<typeof requireRole>>
  try {
    guard = await requireRole('agent')
    accountId = guard.accountId
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
  await audit(auditCtx(request, guard), {
    action: 'record.updated',
    target: { type: 'contact', id, label: null },
    before: { blocked: true },
    after: { blocked: false },
    meta: { op: 'unblock' },
  })
  return NextResponse.json({ ok: true, blocked: false })
}
