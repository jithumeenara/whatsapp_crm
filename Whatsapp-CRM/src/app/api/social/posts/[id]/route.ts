import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'

/**
 * DELETE /api/social/posts/[id] — cancel a scheduled post (supervisor+).
 * Only while it is still waiting: a conditional update, so a post the job
 * has already started is never "cancelled" half-way. Nothing is deleted.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePageAccess('/social', 'supervisor')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
    const n = await prisma.$executeRaw`
      UPDATE social_posts SET status = 'cancelled', updated_at = now()
      WHERE id = ${id}::uuid AND account_id = ${ctx.accountId}::uuid AND status = 'scheduled'`
    if (n !== 1) return NextResponse.json({ error: 'Only a post that is still waiting can be cancelled.' }, { status: 409 })
    await audit(auditCtx(req, ctx), { action: 'record.status_changed', target: { type: 'social_post', id, label: null }, meta: { status: 'cancelled' } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
