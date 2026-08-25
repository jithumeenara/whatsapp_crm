import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * POST /api/account/mfa/disable
 *
 * Requires the current password again — turning off MFA is exactly the
 * kind of action a hijacked, still-logged-in browser tab shouldn't be able
 * to do unattended. Body: { password }.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`mfa-disable:${session.user.id}`, RATE_LIMITS.mfaVerify)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await req.json().catch(() => ({}))
    const password = typeof body?.password === "string" ? body.password : ""
    if (!password) return NextResponse.json({ error: "Your password is required" }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { password_hash: true } })
    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 })
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { mfa_method: "disabled", mfa_phone: null, totp_secret: null, mfa_enabled_at: null },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error in account/mfa/disable POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
