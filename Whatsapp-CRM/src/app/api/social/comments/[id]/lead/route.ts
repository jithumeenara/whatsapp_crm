import { NextResponse } from 'next/server'
import { assertPageAccess, requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { createLeadFromAutomation } from '@/lib/leads/create-from-automation'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/social/comments/[id]/lead  — agent+, with Comments and Leads access
 *
 * A lead for the person behind a comment. Only when the comment is linked
 * to a contact (they messaged, or got a private reply): a comment alone is
 * a stranger. Uses the same lead path as automations, so an open lead for
 * the same person is not duplicated; it goes to the lead pool.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePageAccess('/comments', 'agent')
    assertPageAccess(ctx, '/leads')
    const limit = checkRateLimit(`comment-lead:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
    const rows = await prisma.$queryRaw<{ id: string; channel: string; contact_id: string | null; text: string | null }[]>`
      SELECT id::text AS id, channel, contact_id::text AS contact_id, text
      FROM social_comments WHERE id = ${id}::uuid AND account_id = ${ctx.accountId}::uuid AND deleted_at IS NULL LIMIT 1`.catch(() => [])
    const c = rows[0]
    if (!c) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
    if (!c.contact_id) {
      return NextResponse.json({ error: 'Send them a private reply first: a lead needs a contact, and a comment alone does not make one.' }, { status: 409 })
    }
    const outcome = await createLeadFromAutomation({
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId: c.contact_id,
      message: '',
      config: { source: c.channel === 'instagram' ? 'instagram' : 'facebook', assign_method: 'pool', skip_if_open_lead: true },
      queueScope: 'comment-lead',
    })
    if (!outcome.created) return NextResponse.json({ error: 'This person already has an open lead.' }, { status: 409 })
    await audit(auditCtx(req, ctx), { action: 'record.created', target: { type: 'lead', id: outcome.leadId ?? null, label: null }, meta: { from: 'social_comment', comment: c.id, channel: c.channel } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
