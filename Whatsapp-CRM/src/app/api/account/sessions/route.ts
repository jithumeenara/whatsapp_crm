import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

// Same window as the real enforcement in auth.ts's jwt callback — kept
// here too so a device that's been inactive 3+ days disappears from this
// list even if it never makes another request itself to trigger that
// check (nothing else would ever revoke it otherwise).
const INACTIVITY_LIMIT_MS = 3 * 24 * 60 * 60 * 1000

/**
 * GET /api/account/sessions — the current user's real, active login
 * sessions (Settings > Profile > Sessions). Backed by UserSession, one
 * row per device (login reuses an existing row for the same browser) —
 * see the model's doc comment in schema.prisma and the jwt callback in
 * src/auth.ts for how revoking one here actually forces that device to
 * sign in again.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await prisma.userSession.updateMany({
      where: {
        user_id: session.user.id,
        revoked_at: null,
        last_seen_at: { lt: new Date(Date.now() - INACTIVITY_LIMIT_MS) },
      },
      data: { revoked_at: new Date() },
    })

    const rows = await prisma.userSession.findMany({
      where: { user_id: session.user.id, revoked_at: null },
      orderBy: { last_seen_at: "desc" },
      select: {
        id: true,
        device_label: true,
        ip_address: true,
        created_at: true,
        last_seen_at: true,
      },
    })

    return NextResponse.json({
      sessions: rows.map((r) => ({ ...r, isCurrent: r.id === session.sessionId })),
    })
  } catch (error) {
    console.error("Error in account/sessions GET:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
