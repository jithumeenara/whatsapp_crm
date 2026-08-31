import { createHash, randomBytes } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { sendEmail } from "@/lib/messaging/channels/email"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

const TOKEN_TTL_MS = 24 * 60 * 60_000 // 24 hours

/**
 * POST /api/account/profile/email/verify/start
 *
 * Emails the CURRENT user a one-click confirmation link (Settings > Profile
 * "Verify" button). Same hashed-token pattern as account invitations — only
 * a SHA-256 of the token is stored, the plaintext exists only in the email.
 * Requires the account's Email (SendGrid) channel to already be connected
 * in Settings, same as every other outbound email this app sends.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`profile-email-verify-start:${session.user.id}`, RATE_LIMITS.profileVerifyStart)
    if (!limit.success) return rateLimitResponse(limit)

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, email_verified: true },
    })
    if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 })
    if (user.email_verified) return NextResponse.json({ ok: true, alreadyVerified: true })

    const profile = await prisma.profile.findUnique({ where: { user_id: session.user.id }, select: { account_id: true } })
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const rawToken = randomBytes(32).toString("base64url")
    const tokenHash = createHash("sha256").update(rawToken).digest("hex")
    await prisma.emailVerificationToken.create({
      data: { user_id: session.user.id, token_hash: tokenHash, expires_at: new Date(Date.now() + TOKEN_TTL_MS) },
    })

    const baseUrl = (process.env.NEXTAUTH_URL || new URL(req.url).origin).replace(/\/+$/, "")
    const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${rawToken}`

    try {
      await sendEmail({
        accountId: profile.account_id,
        to: user.email,
        subject: "Verify your email address",
        text: `Confirm your email address by opening this link:\n${verifyUrl}\n\nThis link expires in 24 hours. If you didn't request this, you can ignore it.`,
        html: `<p>Confirm your email address for your WhatsApp CRM account.</p>` +
          `<p><a href="${verifyUrl}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Verify email address</a></p>` +
          `<p style="color:#64748b;font-size:12px;">Or paste this link into your browser:<br>${verifyUrl}</p>` +
          `<p style="color:#94a3b8;font-size:12px;">This link expires in 24 hours. If you didn't request this, you can ignore it.</p>`,
      })
    } catch (err) {
      console.error("[account/profile/email/verify/start] failed to send email:", err)
      const reason = err instanceof Error ? err.message : "Failed to send the email"
      return NextResponse.json({ error: `${reason} — connect Email (SendGrid) in Settings first.` }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error in account/profile/email/verify/start POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
