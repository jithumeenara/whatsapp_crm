import { NextRequest, NextResponse } from "next/server"
import { verifyChallenge } from "@/lib/auth/mfa"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
import { clientIp, clientIpKey } from "@/lib/net/client-ip"
import { prisma } from "@/lib/db"
import { recordLoginFailure, recordRateLimited } from "@/lib/audit/aggregate"

function getClientIp(request: NextRequest): string {
  return clientIpKey(request.headers)
}

/**
 * POST /api/auth/mfa/verify
 *
 * Step 2 of sign-in — checks the code against the challenge created by
 * /api/auth/mfa/start. On success the challenge is marked verified (but
 * NOT consumed — auth.ts's authorize() consumes it at the moment the
 * session actually gets issued). Body: { challengeId, code }.
 * Public — same reasoning as mfa/start.
 */
export async function POST(req: NextRequest) {
  try {
    const where = { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent"), requestId: req.headers.get("x-request-id") }
    const limit = checkRateLimit(`mfa-verify:${getClientIp(req)}`, RATE_LIMITS.mfaVerify)
    if (!limit.success) {
      recordRateLimited({ ...where, bucket: "mfa-verify" })
      return rateLimitResponse(limit)
    }

    const body = await req.json().catch(() => ({}))
    const challengeId = typeof body?.challengeId === "string" ? body.challengeId : ""
    const code = typeof body?.code === "string" ? body.code : ""
    if (!challengeId || !code) {
      return NextResponse.json({ error: "A code is required" }, { status: 400 })
    }

    const result = await verifyChallenge(challengeId, code)
    if (!result.ok) {
      // Counted per minute for the audit log, against the challenge's user
      // when there is one. The code itself is never kept.
      const ch = await prisma.mfaChallenge
        .findUnique({ where: { id: challengeId }, select: { user_id: true } })
        .catch(() => null)
      const prof = ch
        ? await prisma.profile.findUnique({ where: { user_id: ch.user_id }, select: { account_id: true } }).catch(() => null)
        : null
      recordLoginFailure({
        ...where,
        action: "auth.mfa_fail",
        reason: ch ? "mfa_invalid" : "unknown_challenge",
        user: ch ? { id: ch.user_id, accountId: prof?.account_id ?? null } : null,
      })
      return NextResponse.json({ error: result.error ?? "Invalid code" }, { status: 400 })
    }
    // Only 'login' challenges are meaningful to this endpoint — 'enroll'
    // ones are verified+finalized together by /api/account/mfa/enroll/confirm.
    if (result.challenge?.purpose !== "login") {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error in auth/mfa/verify POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
