import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * DELETE /api/account/sessions/[id] — log out one specific device
 * (Settings > Profile > Sessions), as opposed to POST
 * /api/account/sign-out-everywhere which revokes all of them at once.
 * Setting revoked_at here is what actually forces that device's next
 * request to be rejected — see the jwt callback in src/auth.ts.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`sessions-revoke:${session.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params

    // Ownership check — a session row can only be revoked by the user it
    // belongs to, never cross-account.
    const row = await prisma.userSession.findFirst({
      where: { id, user_id: session.user.id },
      select: { id: true, revoked_at: true },
    })
    if (!row) return NextResponse.json({ error: "Session not found" }, { status: 404 })

    if (!row.revoked_at) {
      await prisma.userSession.update({
        where: { id: row.id },
        data: { revoked_at: new Date() },
      })
    }

    return NextResponse.json({ success: true, wasCurrent: id === session.sessionId })
  } catch (error) {
    console.error("Error in account/sessions/[id] DELETE:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
