import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { channelAuth, deleteAtMeta, loadComment } from '@/lib/meta/social-comments'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { emitToAccount } from '@/lib/socket'

/**
 * PATCH  /api/social/comments/[id]  { status: 'open' | 'done' }  — agent+
 * DELETE /api/social/comments/[id]                              — supervisor+
 *
 * Only this workspace's comment (loaded with the account id). Delete removes
 * it at Meta first; our row is kept with deleted_at for the record.
 */

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePageAccess('/comments', 'agent')
    const { id } = await params
    const body = (await req.json().catch(() => null)) as { status?: unknown } | null
    const status = body?.status === 'done' || body?.status === 'open' ? body.status : null
    if (!status) return NextResponse.json({ error: 'status must be open or done.' }, { status: 400 })
    const c = await loadComment(ctx.accountId, id)
    if (!c) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
    await prisma.$executeRaw`UPDATE social_comments SET status = ${status}, updated_at = now() WHERE id = ${c.id}::uuid AND account_id = ${ctx.accountId}::uuid`
    await audit(auditCtx(req, ctx), { action: 'record.status_changed', target: { type: 'social_comment', id: c.id, label: null }, meta: { channel: c.channel, status } })
    emitToAccount(ctx.accountId, 'social_comment', { id: c.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePageAccess('/comments', 'supervisor')
    const limit = checkRateLimit(`comment-mod:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const c = await loadComment(ctx.accountId, id)
    if (!c || c.deleted_at) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
    if (c.kind === 'mention') return NextResponse.json({ error: 'This is a mention on someone else\'s post: you can reply to it, but not hide, delete or message privately.' }, { status: 400 })
    const auth = await channelAuth(ctx.accountId, c.channel)
    if (!auth) return NextResponse.json({ error: `${c.channel === 'instagram' ? 'Instagram' : 'Messenger'} is not connected.` }, { status: 400 })
    const r = await deleteAtMeta(c, auth)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
    await prisma.$executeRaw`UPDATE social_comments SET deleted_at = now(), updated_at = now() WHERE id = ${c.id}::uuid AND account_id = ${ctx.accountId}::uuid`
    await audit(auditCtx(req, ctx), { action: 'message.deleted', target: { type: 'social_comment', id: c.id, label: null }, meta: { channel: c.channel, kind: 'comment' } })
    emitToAccount(ctx.accountId, 'social_comment', { id: c.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
