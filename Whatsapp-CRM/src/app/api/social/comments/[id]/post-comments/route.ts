import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { channelAuth, loadComment, setPostComments } from '@/lib/meta/social-comments'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/social/comments/[id]/post-comments  { enabled: true | false }  — supervisor+
 * Turns comments on or off for the Instagram post this comment is on (one
 * of the workspace's own posts; the post id comes from our saved row, never
 * from the request).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePageAccess('/comments', 'supervisor')
    const limit = checkRateLimit(`comment-mod:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null
    if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'Send enabled: true or false.' }, { status: 400 })
    const c = await loadComment(ctx.accountId, id)
    if (!c) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
    const auth = await channelAuth(ctx.accountId, c.channel)
    if (!auth) return NextResponse.json({ error: 'Instagram is not connected.' }, { status: 400 })
    const r = await setPostComments(c, auth, body.enabled)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: c.channel !== 'instagram' || c.kind !== 'comment' ? 400 : 502 })
    await audit(auditCtx(req, ctx), { action: 'record.updated', target: { type: 'social_post', id: c.post_id, label: null }, meta: { channel: c.channel, comments_enabled: body.enabled } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
