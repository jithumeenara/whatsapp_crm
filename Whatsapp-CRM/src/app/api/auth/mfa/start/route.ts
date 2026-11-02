import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { createChallenge } from "@/lib/auth/mfa"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
import { clientIp, clientIpKey } from "@/lib/net/client-ip"
import { recordLoginFailure, recordRateLimited } from "@/lib/audit/aggregate"

function getClientIp(request: NextRequest): string {
  return clientIpKey(request.headers)
}

/**
 * POST /api/auth/mfa/start
 *
 * Step 1 of a two-step sign-in. Verifies the password (the SAME check
 * auth.ts's authorize() does — duplicated here on purpose, since this
 * route runs BEFORE NextAuth's own flow, to decide whether an MFA step is
 * even needed without creating a session yet). Body: { email, password }.
 *
 * Deliberately public (under /api/auth/, already allowlisted in
 * src/proxy.ts) — this IS the unauthenticated login flow.
 */
export async function POST(req: NextRequest) {
  try {
    const where = { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent"), requestId: req.headers.get("x-request-id") }
    const limit = checkRateLimit(`mfa-start:${getClientIp(req)}`, RATE_LIMITS.mfaStart)
    if (!limit.success) {
      recordRateLimited({ ...where, bucket: "mfa-start" })
      return rateLimitResponse(limit)
    }

    const body = await req.json().catch(() => ({}))
    const emailOrPhone = typeof body?.email === "string" ? body.email : ""
    const password = typeof body?.password === "string" ? body.password : ""
    if (!emailOrPhone || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
    }

    // Mirrors auth.ts's own email/phone resolution exactly, so this
    // pre-check and the real authorize() call always agree on which user
    // (if any) a given input resolves to.
    let user
    if (!emailOrPhone.includes("@")) {
      const digits = emailOrPhone.replace(/\D/g, "")
      user = await prisma.user.findUnique({ where: { email: `${digits}@agent.local` } })
      if (!user && digits.length >= 7) {
        user = await prisma.user.findFirst({ where: { email: { endsWith: `${digits}@agent.local` } } })
      }
    } else {
      user = await prisma.user.findFirst({ where: { email: { equals: emailOrPhone.trim(), mode: "insensitive" } } })
    }

    // Generic failure for both "no such user" and "wrong password" —
    // never reveal which one it was.
    const genericError = NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    // The real reason goes to the audit log only (counted per minute; an
    // unknown email is kept as an HMAC, never as typed).
    const failed = async (reason: string, u?: { id: string } | null) => {
      let known: { id: string; accountId: string | null } | null = null
      if (u) {
        const p = await prisma.profile.findUnique({ where: { user_id: u.id }, select: { account_id: true } }).catch(() => null)
        known = { id: u.id, accountId: p?.account_id ?? null }
      }
      recordLoginFailure({ ...where, reason, typed: emailOrPhone, user: known })
      return genericError
    }
    if (!user) return failed("unknown_user")
    if (!user.password_hash) return failed("no_password", user)
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return failed("bad_password", user)

    if (user.mfa_method === "disabled") {
      return NextResponse.json({ mfaRequired: false })
    }

    const method = user.mfa_method as "sms" | "whatsapp" | "totp"
    try {
      const { challengeId } = await createChallenge({
        userId: user.id,
        purpose: "login",
        method,
        phone: user.mfa_phone,
      })
      return NextResponse.json({
        mfaRequired: true,
        method,
        challengeId,
        // Masked so the login screen can show "code sent to •••1234"
        // without displaying the full number.
        maskedPhone: method === "totp" ? undefined : maskPhone(user.mfa_phone),
      })
    } catch (err) {
      console.error("[auth/mfa/start] failed to send code:", err)
      return NextResponse.json({ error: "Failed to send your login code. Try again in a moment." }, { status: 502 })
    }
  } catch (error) {
    console.error("Error in auth/mfa/start POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

function maskPhone(phone: string | null): string | undefined {
  if (!phone) return undefined
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 4) return undefined
  return `•••${digits.slice(-4)}`
}
