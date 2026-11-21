import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { importConversations } from '@/lib/meta/social-import'

/**
 * POST /api/meta/social-import { channel: 'instagram' | 'facebook' } — owner only.
 * Brings the 50 most recent conversations (25 messages each) into the Inbox.
 * Once per 10 minutes per workspace; idempotent; runs no bot or automation.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('owner')
    const body = (await req.json().catch(() => null)) as { channel?: unknown } | null
    const channel = body?.channel === 'instagram' || body?.channel === 'facebook' ? body.channel : null
    if (!channel) return NextResponse.json({ error: 'channel must be instagram or facebook' }, { status: 400 })
    const limit = checkRateLimit(`social-import:${ctx.accountId}:${channel}`, { limit: 1, windowMs: 10 * 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const r = await importConversations(ctx.accountId, channel)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    await audit(auditCtx(req, ctx), { action: 'import.completed', target: { type: 'conversations', id: null, label: channel }, meta: { channel, conversations: r.conversations, messages: r.messages } })
    return NextResponse.json({ ok: true, ...r })
  } catch (err) {
    return toErrorResponse(err)
  }
}
