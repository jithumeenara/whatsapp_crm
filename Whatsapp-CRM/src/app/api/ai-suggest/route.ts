import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { suggestReply, type SuggestFailure } from '@/lib/ai/suggest'

/**
 * POST /api/ai-suggest  { conversation_id }
 *
 * Drafts the reply the agent is about to write. Nothing is sent and
 * nothing is stored — the text goes into their composer and they decide.
 *
 * On demand only. There is no version of this that runs as a conversation
 * is opened: that would spend a model call on every glance at the inbox,
 * most of which end with the agent typing their own answer anyway.
 */

export const dynamic = 'force-dynamic'

/** Human-readable, because these all surface as a toast. */
const FAILURE_MESSAGES: Record<SuggestFailure, string> = {
  no_conversation: 'Conversation not found.',
  no_customer_message: 'Nothing from the customer to reply to yet.',
  no_ai_config: 'The assistant is not set up for this account yet.',
  blocked: 'The assistant will not draft a reply to this message.',
  failed: 'Could not draft a reply. Try again.',
}

export async function POST(request: Request) {
  let accountId: string
  let userId: string
  try {
    const session = await requireRole('agent')
    accountId = session.accountId
    userId = session.userId
  } catch (err) {
    return toErrorResponse(err)
  }

  // Per agent, because the cost is a model call and the button is easy to
  // lean on. Generous enough that nobody working normally will meet it.
  const limit = checkRateLimit(`ai-suggest:${userId}`, RATE_LIMITS.send)
  if (!limit.success) return rateLimitResponse(limit)

  const body = (await request.json().catch(() => null)) as {
    conversation_id?: string
  } | null
  const conversationId = body?.conversation_id?.trim()
  if (!conversationId) {
    return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
  }

  const result = await suggestReply({ accountId, conversationId })
  if (!result.ok) {
    return NextResponse.json(
      { error: FAILURE_MESSAGES[result.reason], reason: result.reason },
      { status: result.reason === 'no_conversation' ? 404 : 422 },
    )
  }

  return NextResponse.json({
    suggestion: result.suggestion,
    knowledge_used: result.knowledgeUsed,
    confidence: result.confidence,
    low_confidence: result.lowConfidence,
  })
}
