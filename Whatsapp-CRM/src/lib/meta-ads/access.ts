import { NextResponse } from 'next/server'
import { canOpenPath } from '@/lib/auth/page-access'
import type { AccountRole } from '@/lib/auth/roles'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * The gate for the Meta Ads READ routes (dashboard, config, pixel,
 * lead-forms).
 *
 * They used to ask only for the lowest role, so any signed-in member could
 * call them directly: the menu hid the Ads page and that was all. Ad spend
 * and the names and numbers of the leads behind it are for people who were
 * given the Ads page, and every call reaches out to Meta, so a limit stops
 * one person from making the server do that in a loop.
 *
 * Returns a ready response when the caller must be turned away, or null.
 * Kept free of the auth module's error classes so it works in any route.
 */
const READ_LIMIT = { limit: 60, windowMs: 60_000 }

export function adsReadGate(
  ctx: { userId: string; role: AccountRole | string; pageAccess?: unknown },
  bucket: string,
): NextResponse | null {
  if (!canOpenPath(ctx.role as AccountRole, ctx.pageAccess, '/ads')) {
    return NextResponse.json(
      { error: 'You do not have access to this section. An administrator can grant it in Settings → Members.' },
      { status: 403 },
    )
  }
  const limit = checkRateLimit(`meta-ads:${bucket}:${ctx.userId}`, READ_LIMIT)
  if (!limit.success) return rateLimitResponse(limit)
  return null
}
