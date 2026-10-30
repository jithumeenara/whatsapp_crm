import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // Owner only, like minting — see ../route.ts. Revocation is a hard
    // delete, and verifyApiKey reads the table on every request (no
    // cache), so the key stops working on its very next call.
    let accountId: string
    try {
      accountId = (await requireRole('owner')).accountId
    } catch (err) {
      return toErrorResponse(err)
    }

    const deleted = await prisma.apiKey.deleteMany({
      where: { id, account_id: accountId },
    })
    if (deleted.count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/api-keys/[id]]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
