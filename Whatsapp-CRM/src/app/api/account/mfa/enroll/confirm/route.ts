import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/whatsapp/encryption"
import { verifyChallenge } from "@/lib/auth/mfa"
import { verifyTotp } from "@/lib/auth/totp"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * POST /api/account/mfa/enroll/confirm
 *
 * Finalizes MFA setup — only this route actually writes User.mfa_method,
 * flipping the account from "unprotected" to "protected". Body, matching
 * whichever method /enroll/start was called with:
 *   sms/whatsapp: { method, challengeId, code }
 *   totp:         { method: 'totp', secret, code }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`mfa-enroll-confirm:${session.user.id}`, RATE_LIMITS.mfaVerify)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await req.json().catch(() => ({}))
    const method = body?.method as "sms" | "whatsapp" | "totp" | undefined
    const code = typeof body?.code === "string" ? body.code : ""
    if (!method || !code) return NextResponse.json({ error: "A code is required" }, { status: 400 })

    // Replacing a method that is already on would skip the password check
    // that turning it off requires (/api/account/mfa/disable): anybody at
    // a signed-in browser could swap in their own authenticator and lock
    // the owner out. Disable first, then set up the new one — which is
    // also the only path the Settings screen offers.
    const current = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, mfa_method: true } })
    if (current?.mfa_method && current.mfa_method !== "disabled") {
      return NextResponse.json(
        { error: "Two-factor authentication is already on. Disable it with your password first, then set up the new method." },
        { status: 409 },
      )
    }

    if (method === "totp") {
      const secret = typeof body?.secret === "string" ? body.secret : ""
      if (!secret) return NextResponse.json({ error: "Missing secret — restart setup" }, { status: 400 })
      if (!verifyTotp(secret, code)) {
        return NextResponse.json({ error: "Incorrect code — check the time on your device and try again." }, { status: 400 })
      }
      await prisma.user.update({
        where: { id: session.user.id },
        data: { mfa_method: "totp", mfa_phone: null, totp_secret: encrypt(secret), mfa_enabled_at: new Date() },
      })
      return NextResponse.json({ ok: true })
    }

    const challengeId = typeof body?.challengeId === "string" ? body.challengeId : ""
    if (!challengeId) return NextResponse.json({ error: "Missing challenge — restart setup" }, { status: 400 })

    const result = await verifyChallenge(challengeId, code)
    if (!result.ok || !result.challenge) {
      return NextResponse.json({ error: result.error ?? "Incorrect code" }, { status: 400 })
    }
    if (result.challenge.purpose !== "enroll" || result.challenge.user_id !== session.user.id) {
      return NextResponse.json({ error: "Invalid challenge" }, { status: 400 })
    }
    if (!result.challenge.pending_phone) {
      return NextResponse.json({ error: "Missing phone number — restart setup" }, { status: 400 })
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        mfa_method: result.challenge.method,
        mfa_phone: result.challenge.pending_phone,
        totp_secret: null,
        mfa_enabled_at: new Date(),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error in account/mfa/enroll/confirm POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
