import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse, type AccountContext } from '@/lib/auth/account'
import { auditCtx, auditInTx } from '@/lib/audit'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // Owner only, like minting — see ../route.ts. Revocation is a hard
    // delete, and verifyApiKey reads the table on every request (no
    // cache), so the key stops working on its very next call.
    let ctx: AccountContext
    try {
      ctx = await requireRole('owner')
    } catch (err) {
      return toErrorResponse(err)
    }
    const accountId = ctx.accountId

    // Revoked and recorded together (fail closed). The key's name is in
    // its api_key.created event, found by the same id.
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.apiKey.deleteMany({ where: { id, account_id: accountId } })
      if (result.count > 0) {
        await auditInTx(tx, auditCtx(req, ctx), { action: 'api_key.revoked', target: { type: 'api_key', id } })
      }
      return result
    }, { timeout: 10_000, maxWait: 5_000 })
    if (deleted.count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/api-keys/[id]]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
