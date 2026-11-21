import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { channelAuth, cleanText, COMMENT_TEXT_MAX, loadComment, replyPublicly } from '@/lib/meta/social-comments'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { emitToAccount } from '@/lib/socket'

/**
 * POST /api/social/comments/[id]/reply  { text }  — agent+
 * A public reply under the comment, posted as the Page / Instagram account.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePageAccess('/comments', 'agent')
    const limit = checkRateLimit(`comment-reply:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const c = await loadComment(ctx.accountId, id)
    if (!c || c.deleted_at) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
    const body = (await req.json().catch(() => null)) as { text?: unknown } | null
    const t = cleanText(body?.text, COMMENT_TEXT_MAX[c.channel])
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: 400 })
    const auth = await channelAuth(ctx.accountId, c.channel)
    if (!auth) return NextResponse.json({ error: `${c.channel === 'instagram' ? 'Instagram' : 'Messenger'} is not connected.` }, { status: 400 })

    const r = await replyPublicly(c, auth, t.text)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })

    const entry = JSON.stringify([{ id: r.replyId, text: t.text, by: ctx.userId, at: new Date().toISOString() }])
    await prisma.$executeRaw`
      UPDATE social_comments SET replies = replies || ${entry}::jsonb, status = 'done', updated_at = now()
      WHERE id = ${c.id}::uuid AND account_id = ${ctx.accountId}::uuid`
    await audit(auditCtx(req, ctx), { action: 'message.sent', target: { type: 'social_comment', id: c.id, label: null }, meta: { channel: c.channel, kind: 'public_reply' } })
    emitToAccount(ctx.accountId, 'social_comment', { id: c.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
