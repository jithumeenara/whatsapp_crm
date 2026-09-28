import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ensureAiMetaColumn } from '@/lib/ai/reply-sources'

/**
 * GET — where an AI-written reply came from (see lib/ai/reply-sources).
 *
 * Loaded when somebody asks, not with every message: the explanation can
 * run to a few kilobytes and is read for a handful of replies.
 *
 * Owners and admins only: it shows the knowledge base, the AI
 * instructions and the company profile word for word, which agents,
 * supervisors and viewers are not otherwise shown.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    await ensureAiMetaColumn().catch(() => {})

    const message = await prisma.message.findFirst({
      where: { id, conversation: { account_id: ctx.accountId } },
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
