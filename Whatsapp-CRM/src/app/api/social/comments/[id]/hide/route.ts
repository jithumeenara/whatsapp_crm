import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { channelAuth, loadComment, setHidden } from '@/lib/meta/social-comments'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { emitToAccount } from '@/lib/socket'

/**
 * POST /api/social/comments/[id]/hide  { hidden: true | false }  — supervisor+
 * Hides (or shows again) the comment for everyone except its writer and
 * their friends — Meta's own hide.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePageAccess('/comments', 'supervisor')
    const limit = checkRateLimit(`comment-mod:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = (await req.json().catch(() => null)) as { hidden?: unknown } | null
    if (typeof body?.hidden !== 'boolean') return NextResponse.json({ error: 'Send hidden: true or false.' }, { status: 400 })
    const hidden = body.hidden
    const c = await loadComment(ctx.accountId, id)
    if (!c || c.deleted_at) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
    const auth = await channelAuth(ctx.accountId, c.channel)
    if (!auth) return NextResponse.json({ error: `${c.channel === 'instagram' ? 'Instagram' : 'Messenger'} is not connected.` }, { status: 400 })
    const r = await setHidden(c, auth, hidden)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
    await prisma.$executeRaw`UPDATE social_comments SET is_hidden = ${hidden}, updated_at = now() WHERE id = ${c.id}::uuid AND account_id = ${ctx.accountId}::uuid`
    await audit(auditCtx(req, ctx), { action: 'record.updated', target: { type: 'social_comment', id: c.id, label: null }, meta: { channel: c.channel, hidden } })
    emitToAccount(ctx.accountId, 'social_comment', { id: c.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
