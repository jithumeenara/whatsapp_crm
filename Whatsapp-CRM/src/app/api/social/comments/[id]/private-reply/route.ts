import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import {
  channelAuth, claimPrivateReply, cleanText, loadComment, privateReplyOpen, PRIVATE_REPLY_DAYS, PRIVATE_REPLY_MAX,
  recordPrivateReplyInInbox, releasePrivateReply, sendPrivateReply,
} from '@/lib/meta/social-comments'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { emitToAccount } from '@/lib/socket'

/**
 * POST /api/social/comments/[id]/private-reply  { text }  — agent+
 *
 * One DM to the person who wrote the comment (Meta allows one per comment,
 * within 7 days). Claimed atomically first, so a double click or two people
 * can never send two; released if Meta refuses. The DM then lives in the
 * Inbox, where the customer's answer continues.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePageAccess('/comments', 'agent')
    const limit = checkRateLimit(`comment-dm:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const c = await loadComment(ctx.accountId, id)
    if (!c) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
    if (!privateReplyOpen(c, new Date())) {
      return NextResponse.json({ error: c.private_reply_at ? 'A private reply was already sent for this comment.' : `Private replies are possible only within ${PRIVATE_REPLY_DAYS} days of the comment.` }, { status: 409 })
    }
    const body = (await req.json().catch(() => null)) as { text?: unknown } | null
    const t = cleanText(body?.text, PRIVATE_REPLY_MAX[c.channel])
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: 400 })
    const auth = await channelAuth(ctx.accountId, c.channel)
    if (!auth) return NextResponse.json({ error: `${c.channel === 'instagram' ? 'Instagram' : 'Messenger'} is not connected.` }, { status: 400 })

    if (!(await claimPrivateReply(ctx.accountId, c.id, ctx.userId))) {
      return NextResponse.json({ error: 'A private reply was already sent for this comment.' }, { status: 409 })
    }
    const sent = await sendPrivateReply(c, auth, t.text)
    if (!sent.ok) {
      await releasePrivateReply(ctx.accountId, c.id, ctx.userId)
      return NextResponse.json({ error: sent.error }, { status: 502 })
    }

    let conversationId: string | null = null
    if (sent.recipientId) {
      const thread = await recordPrivateReplyInInbox({
        accountId: ctx.accountId, channel: c.channel, recipientId: sent.recipientId, name: c.from_name,
        userId: ctx.userId, text: t.text, messageId: sent.messageId,
      }).catch((e: unknown) => { console.error('[comments] inbox record failed:', e instanceof Error ? e.message : e); return null })
      conversationId = thread?.conversationId ?? null
      if (thread) {
        await prisma.$executeRaw`UPDATE social_comments SET contact_id = ${thread.contactId}::uuid WHERE id = ${c.id}::uuid AND account_id = ${ctx.accountId}::uuid AND contact_id IS NULL`.catch(() => 0)
      }
    }
    await prisma.$executeRaw`UPDATE social_comments SET status = 'done', updated_at = now() WHERE id = ${c.id}::uuid AND account_id = ${ctx.accountId}::uuid`
    await audit(auditCtx(req, ctx), { action: 'message.sent', target: { type: 'social_comment', id: c.id, label: null }, meta: { channel: c.channel, kind: 'private_reply' } })
    emitToAccount(ctx.accountId, 'social_comment', { id: c.id })
    return NextResponse.json({ ok: true, conversation_id: conversationId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
