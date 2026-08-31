import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { createChallenge } from "@/lib/auth/mfa"
import { isValidE164 } from "@/lib/whatsapp/phone-utils"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * POST /api/account/profile/phone/verify/start
 *
 * Sends a 6-digit code to the CURRENT user's own saved Profile.phone —
 * settings > Profile "Verify" button. Tries WhatsApp first, falls back to
 * SMS (see createChallenge's 'auto' method) so the user isn't asked to
 * pick a channel that may not even be connected yet.
 */
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`profile-phone-verify-start:${session.user.id}`, RATE_LIMITS.profileVerifyStart)
    if (!limit.success) return rateLimitResponse(limit)

    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { phone: true, phone_verified_at: true },
    })
    if (!profile?.phone) {
      return NextResponse.json({ error: "Add your WhatsApp number first, then verify it." }, { status: 400 })
    }
    if (profile.phone_verified_at) {
      return NextResponse.json({ ok: true, alreadyVerified: true })
    }
    if (!isValidE164(profile.phone)) {
      return NextResponse.json({ error: "Saved number isn't valid — edit it and save again." }, { status: 400 })
    }

    try {
      const { challengeId, method } = await createChallenge({
        userId: session.user.id,
        purpose: "profile_phone",
        method: "auto",
        phone: profile.phone,
      })
      return NextResponse.json({ challengeId, method })
    } catch (err) {
      console.error("[account/profile/phone/verify/start] failed to send code:", err)
      const reason = err instanceof Error ? err.message : "Failed to send the code"
      return NextResponse.json({ error: reason }, { status: 502 })
    }
  } catch (error) {
    console.error("Error in account/profile/phone/verify/start POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
