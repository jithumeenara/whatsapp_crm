import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

// 5 minutes to 90 days — wide enough to be genuinely useful (someone
// wanting a strict 15-minute policy, or a lenient 60-day one) while
// still ruling out obviously-mistyped values (0, negative, or a number
// of minutes that's actually years).
const MIN_MINUTES = 5
const MAX_MINUTES = 90 * 24 * 60

/**
 * GET/PATCH /api/account/session-settings — the current user's own
 * inactivity auto-logout duration (Settings > Profile > Sessions > gear
 * icon). Stored in minutes; auth.ts's jwt callback and GET
 * /api/account/sessions both read it to decide when a device counts as
 * abandoned.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { session_inactivity_limit_minutes: true },
    })
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ limitMinutes: user.session_inactivity_limit_minutes })
  } catch (error) {
    console.error("Error in account/session-settings GET:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`session-settings:${session.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await req.json().catch(() => null)
    const limitMinutes = Number(body?.limitMinutes)
    if (!Number.isFinite(limitMinutes) || !Number.isInteger(limitMinutes)) {
      return NextResponse.json({ error: "limitMinutes must be a whole number" }, { status: 400 })
    }
    if (limitMinutes < MIN_MINUTES || limitMinutes > MAX_MINUTES) {
      return NextResponse.json(
        { error: `Must be between ${MIN_MINUTES} minutes and ${MAX_MINUTES / (24 * 60)} days` },
        { status: 400 },
      )
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { session_inactivity_limit_minutes: limitMinutes },
    })

    return NextResponse.json({ success: true, limitMinutes })
  } catch (error) {
    console.error("Error in account/session-settings PATCH:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
