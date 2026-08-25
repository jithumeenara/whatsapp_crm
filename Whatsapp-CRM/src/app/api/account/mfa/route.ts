import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

/** GET /api/account/mfa — current user's own MFA status (Settings > Profile > Security). */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mfa_method: true, mfa_phone: true, mfa_enabled_at: true },
    })
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({
      method: user.mfa_method,
      maskedPhone: user.mfa_phone ? `•••${user.mfa_phone.replace(/\D/g, "").slice(-4)}` : null,
      enabledAt: user.mfa_enabled_at,
    })
  } catch (error) {
    console.error("Error in account/mfa GET:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
