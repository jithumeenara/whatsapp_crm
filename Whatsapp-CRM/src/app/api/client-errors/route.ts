import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { recordAppError } from '@/lib/errors/record'

/**
 * POST /api/client-errors   { message: string, where?: string }
 *
 * A browser error from a signed-in person (window.onerror, an unhandled
 * promise, a page that crashed into error.tsx), kept in app_errors with
 * their workspace so its admins can see it. Two fields only, cut short
 * and redacted on the server; anything else in the body is ignored.
 * Rate-limited per person: a page stuck in an error loop must not flood
 * the table. Always answers 204 — the browser has nothing to do with it.
 */

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('viewer')
    const limit = checkRateLimit(`client-errors:${ctx.userId}`, { limit: 30, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await req.json().catch(() => null)) as { message?: unknown; where?: unknown } | null
    const message = typeof body?.message === 'string' ? body.message.slice(0, 1000) : ''
    if (!message.trim()) return new NextResponse(null, { status: 204 })
    // A path only: no query string (it can hold tokens) and no host.
    const rawWhere = typeof body?.where === 'string' ? body.where.slice(0, 300) : ''
    const where = rawWhere.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/i, '').slice(0, 200)

    recordAppError({ source: 'browser', where: where || '(browser)', message, accountId: ctx.accountId })
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
