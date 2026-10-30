import { NextRequest, NextResponse } from "next/server"
import QRCode from "qrcode"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { createChallenge } from "@/lib/auth/mfa"
import { generateTotpSecret, buildOtpauthUri } from "@/lib/auth/totp"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * POST /api/account/mfa/enroll/start
 *
 * Begins setting up a new MFA method for the CURRENT user (Settings >
 * Profile > Security) — does not change anything yet, only
 * /enroll/confirm actually turns MFA on, so a wrong number or a missed QR
 * scan can't lock the user out of their own account.
 *
 * Body: { method: 'sms'|'whatsapp', phone } or { method: 'totp' }.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`mfa-enroll-start:${session.user.id}`, RATE_LIMITS.mfaStart)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await req.json().catch(() => ({}))
    const method = body?.method as "sms" | "whatsapp" | "totp" | undefined
    if (!method || !["sms", "whatsapp", "totp"].includes(method)) {
      return NextResponse.json({ error: "A valid method is required" }, { status: 400 })
    }

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
      const secret = generateTotpSecret()
      const otpauthUri = buildOtpauthUri(secret, current?.email ?? "user")
      const qrDataUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 })
      // The candidate secret is intentionally NOT persisted here — this
      // endpoint is session-protected (only the account owner can call it
      // for themselves), so round-tripping the secret through the client
      // to /enroll/confirm is exactly as trustworthy as storing it
      // server-side would be, with no extra schema needed.
      return NextResponse.json({ method: "totp", secret, otpauthUri, qrDataUrl })
    }

    const phone = typeof body?.phone === "string" ? body.phone.trim() : ""
    if (!phone) return NextResponse.json({ error: "A phone number is required" }, { status: 400 })

    try {
      const { challengeId } = await createChallenge({ userId: session.user.id, purpose: "enroll", method, phone })
      return NextResponse.json({ method, challengeId })
    } catch (err) {
      console.error("[account/mfa/enroll/start] failed to send code:", err)
      const reason = err instanceof Error ? err.message : "Failed to send the code"
      return NextResponse.json({ error: reason }, { status: 502 })
    }
  } catch (error) {
    console.error("Error in account/mfa/enroll/start POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
