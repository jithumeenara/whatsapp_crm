import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ensureAiMetaColumn } from '@/lib/ai/reply-sources'

/**
 * GET — where an AI-written reply came from (see lib/ai/reply-sources).
 *
 * Loaded when somebody asks, not with every message: the explanation can
 * run to a few kilobytes and is read for a handful of replies. The same
 * access rule as reading the conversation itself — the caller's account,
 * and for an agent only a conversation assigned to them.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    await ensureAiMetaColumn().catch(() => {})

    const message = await prisma.message.findFirst({
      where: {
        id,
        conversation: {
          account_id: ctx.accountId,
          ...(ctx.role === 'agent' ? { assigned_agent_id: ctx.userId } : {}),
        },
      },
      select: { sender_type: true, bot_source: true, ai_meta: true },
    })
    if (!message) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    return NextResponse.json({
      sender_type: message.sender_type,
      bot_source: message.bot_source,
      meta: message.ai_meta ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
