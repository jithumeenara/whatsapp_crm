import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { verifyChallenge } from "@/lib/auth/mfa"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * POST /api/account/profile/phone/verify/confirm
 *
 * Body: { challengeId, code }. Marks Profile.phone_verified_at once the
 * code checks out — but only if the phone the challenge was sent to still
 * matches the profile's CURRENT phone (guards against: send code -> edit
 * number -> submit the old code and have the NEW number marked verified).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`profile-phone-verify-confirm:${session.user.id}`, RATE_LIMITS.profileVerifyConfirm)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await req.json().catch(() => ({}))
    const challengeId = typeof body?.challengeId === "string" ? body.challengeId : ""
    const code = typeof body?.code === "string" ? body.code : ""
    if (!challengeId || !code) return NextResponse.json({ error: "A code is required" }, { status: 400 })

    const result = await verifyChallenge(challengeId, code)
    if (!result.ok || !result.challenge) {
      return NextResponse.json({ error: result.error ?? "Incorrect code" }, { status: 400 })
    }
    if (result.challenge.purpose !== "profile_phone" || result.challenge.user_id !== session.user.id) {
      return NextResponse.json({ error: "Invalid challenge" }, { status: 400 })
    }

    const profile = await prisma.profile.findUnique({ where: { user_id: session.user.id }, select: { phone: true } })
    if (!result.challenge.pending_phone || profile?.phone !== result.challenge.pending_phone) {
      return NextResponse.json({ error: "Your number changed since the code was sent — request a new code." }, { status: 400 })
    }

    await prisma.profile.update({ where: { user_id: session.user.id }, data: { phone_verified_at: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error in account/profile/phone/verify/confirm POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
