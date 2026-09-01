import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { invalidateAllSessions } from "@/lib/auth/session-invalidation"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * POST /api/account/sign-out-everywhere
 *
 * Invalidates every existing session for the CURRENT user, on every
 * device — including the one calling this, since there's no per-device
 * session tracking under the JWT strategy to spare it. The frontend
 * should follow this up with a normal client-side signOut() for a clean
 * redirect on this device rather than waiting for the next request to
 * get silently rejected.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const limit = checkRateLimit(`sign-out-everywhere:${session.user.id}`, RATE_LIMITS.mfaStart)
  if (!limit.success) return rateLimitResponse(limit)

  await invalidateAllSessions(session.user.id)
  return NextResponse.json({ success: true })
}
