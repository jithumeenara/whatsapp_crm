import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/**
 * GET /api/auth/verify-email?token=...
 *
 * Public — reached by clicking the link emailed from
 * /api/account/profile/email/verify/start. No session required: the token
 * itself (32 bytes CSPRNG, only ever shown once, in that email) IS the
 * proof of identity here, same trust model as the account-invitation links.
 * Redirects back to /login with a banner either way.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? ""
  const loginUrl = new URL("/login", req.url)

  if (!token) {
    loginUrl.searchParams.set("emailVerified", "0")
    return NextResponse.redirect(loginUrl)
  }

  const tokenHash = createHash("sha256").update(token).digest("hex")
  const row = await prisma.emailVerificationToken.findUnique({ where: { token_hash: tokenHash } })

  if (!row || row.consumed_at || row.expires_at.getTime() < Date.now()) {
    loginUrl.searchParams.set("emailVerified", "0")
    return NextResponse.redirect(loginUrl)
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: row.user_id }, data: { email_verified: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: row.id }, data: { consumed_at: new Date() } }),
  ])

  loginUrl.searchParams.set("emailVerified", "1")
  return NextResponse.redirect(loginUrl)
}
