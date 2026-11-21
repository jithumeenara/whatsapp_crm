import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { accountTotals, currentCounts, followerHistory, insightAuth, instagramAudience } from '@/lib/meta/social-insights'

/**
 * GET /api/social/insights?channel=instagram|facebook&days=7|30
 *
 * Numbers for the Social screen: today's counts, totals for the period,
 * follower growth from our daily snapshots (90 days) and, for Instagram,
 * the audience by age / gender / city. Supervisor+ with Social access;
 * the caller's own workspace only; counts only — never a list of people,
 * never a token.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requirePageAccess('/social', 'supervisor')
    const limit = checkRateLimit(`social-insights:${ctx.userId}`, RATE_LIMITS.apiRead)
    if (!limit.success) return rateLimitResponse(limit)
    const q = new URL(req.url).searchParams
    const channel = q.get('channel') === 'facebook' ? 'facebook' : q.get('channel') === 'instagram' ? 'instagram' : null
    if (!channel) return NextResponse.json({ error: 'channel must be instagram or facebook' }, { status: 400 })
    const days = q.get('days') === '30' ? 30 : 7

    const auth = await insightAuth(ctx.accountId, channel)
    if (!auth) return NextResponse.json({ error: `${channel === 'instagram' ? 'Instagram' : 'Facebook Page'} is not connected.` }, { status: 404 })

    const [counts, totals, history, audience] = await Promise.all([
      currentCounts(channel, auth),
      accountTotals(ctx.accountId, channel, auth, days),
      followerHistory(ctx.accountId, channel, 90),
      channel === 'instagram' ? instagramAudience(ctx.accountId, auth) : Promise.resolve(null),
    ])
    return NextResponse.json({ channel, days, counts, totals, history, audience })
  } catch (err) {
    return toErrorResponse(err)
  }
}
