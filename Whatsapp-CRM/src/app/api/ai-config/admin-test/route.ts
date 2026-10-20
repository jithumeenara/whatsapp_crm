import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { answerAdminQuestion, AdminAnswerError } from '@/lib/ai/insights/answer'

/**
 * Admin Test — ask questions about this account's own CRM data in plain
 * language and get a real answer computed from the database.
 *
 * How it stays safe:
 *  - 'admin' role floor. This reads across contacts, conversations and
 *    enquiries; an agent's own inbox access is not the same permission.
 *  - The model never writes a query. It can only pick from the fixed
 *    tools in lib/ai/insights/tools.ts, each of which is a hand-written,
 *    read-only, account-scoped Prisma call.
 *  - Every tool result is scoped by accountId taken from the session,
 *    never from anything the model said.
 *
 * Gemini-only, like every other AI feature here — this leans on
 * function calling, and the account already has a Gemini key.
 */

export const dynamic = 'force-dynamic'

interface RequestBody {
  message?: string
  history?: Array<{ role: 'user' | 'model'; text: string }>
}

export async function POST(req: Request) {
  let accountId: string
  try {
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
    const limited = checkRateLimit(`ai-call:${ctx.userId}`, RATE_LIMITS.aiCall)
    if (!limited.success) return rateLimitResponse(limited)
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null
  const message = body?.message?.trim()
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  try {
    const answer = await answerAdminQuestion({ accountId, message, history: body?.history ?? [] })
    return NextResponse.json({
      reply: answer.reply,
      // Shown in the UI so an admin can see which data was actually read
      // to produce the answer, rather than trusting it blindly.
      tools_used: answer.toolsUsed,
      truncated: answer.truncated,
    })
  } catch (err) {
    if (err instanceof AdminAnswerError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[admin-test] failed:', err)
    return NextResponse.json({ error: 'The assistant could not answer. Try again.' }, { status: 500 })
  }
}
