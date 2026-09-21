import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { suggestCategories } from '@/lib/ai/suggest-categories'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/service-categories/suggest
 *
 * Reads this business's own profile, knowledge base and recent
 * conversations, and proposes the category list.
 *
 * Saves nothing. The suggestion comes back with how often each category
 * actually appeared, and the owner ticks what to keep — a list that
 * installed itself would be a list nobody had read.
 *
 * Rate limited because it reads a couple of hundred conversations and
 * calls a model; it is a setup action somebody does once, not something
 * that should be reachable in a loop.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(`categories:suggest:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const result = await suggestCategories(ctx.accountId)
    if (!result.ok) {
      // The message is written for the person reading it — "there is
      // nothing to read yet" tells them what to do, where a status code
      // would not.
      return NextResponse.json({ error: result.message }, { status: result.error === 'failed' ? 502 : 400 })
    }

    return NextResponse.json({ categories: result.categories, sampled: result.sampled })
  } catch (err) {
    return toErrorResponse(err)
  }
}
