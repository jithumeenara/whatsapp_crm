import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadQualitySummary, loadUnansweredQuestions } from '@/lib/ai/quality'

/**
 * GET /api/ai-quality?days=30
 *
 * How the assistant has been doing, and which questions it keeps
 * failing. Read out of messages and flow runs that already exist, so it
 * works on the whole history rather than starting from the day somebody
 * switched it on.
 */

export const dynamic = 'force-dynamic'

const MAX_DAYS = 365
const DEFAULT_DAYS = 30

export async function GET(request: Request) {
  let accountId: string
  try {
    // Everyone who works the inbox should be able to see how the bot is
    // doing — this is their queue it is protecting.
    accountId = (await requireRole('agent')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const url = new URL(request.url)
  const requested = Number(url.searchParams.get('days'))
  const days = Number.isFinite(requested)
    ? Math.min(MAX_DAYS, Math.max(1, Math.round(requested)))
    : DEFAULT_DAYS

  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)
  const window = { accountId, from, to }

  try {
    const [summary, unanswered] = await Promise.all([
      loadQualitySummary(window),
      loadUnansweredQuestions(window),
    ])
    return NextResponse.json({ days, from, to, summary, unanswered })
  } catch (err) {
    console.error('[GET /api/ai-quality]', err)
    return NextResponse.json(
      { error: 'Could not read the assistant’s figures.' },
      { status: 500 },
    )
  }
}
